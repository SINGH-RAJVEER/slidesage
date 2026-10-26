package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/auth"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/generation"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/integrations/ai"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/middleware"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/observability"
)

func main() {
	maintenance := flag.Bool("maintenance", false, "run the recovery and cleanup sweep once, then exit")
	flag.Parse()

	telemetry, err := observability.Setup(context.Background(), observability.WorkerConfigFromEnv())
	if err != nil {
		log.Fatal(err)
	}
	logger := telemetry.Logger()
	slog.SetDefault(logger)
	defer func() {
		shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelShutdown()
		if err := telemetry.Shutdown(shutdownContext); err != nil {
			logger.Error("telemetry shutdown failed", slog.Any("error", err))
		}
	}()
	database, err := sql.Open("pgx", env("DATABASE_URL", "postgresql://slidesage:slidesage@localhost:5432/slidesage"))
	if err != nil {
		fatal(logger, err)
	}
	defer database.Close()
	maxWorkers := envInt("WORKER_CONCURRENCY", 2)
	database.SetMaxOpenConns(envInt("WORKER_DATABASE_POOL_MAX", maxWorkers+3))
	database.SetMaxIdleConns(envInt("WORKER_DATABASE_POOL_MAX", maxWorkers+3))
	database.SetConnMaxIdleTime(time.Duration(envInt("DATABASE_IDLE_TIMEOUT", 20)) * time.Second)

	signalContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	pingContext, cancelPing := context.WithTimeout(signalContext, time.Duration(envInt("DATABASE_CONNECT_TIMEOUT", 10))*time.Second)
	defer cancelPing()
	if err := database.PingContext(pingContext); err != nil {
		fatal(logger, err)
	}

	authService, err := auth.NewService(auth.Config{Database: database})
	if err != nil {
		fatal(logger, err)
	}

	// VPS installs may run maintenance separately. Containers opt into the
	// in-process schedule so cleanup does not depend on a VPS application timer.
	if *maintenance {
		runRecovery(signalContext, database)
		runCleanup(signalContext, database, authService)
		slog.Info("maintenance sweep finished")
		return
	}
	var maintenanceInterval time.Duration
	if value := os.Getenv("WORKER_MAINTENANCE_INTERVAL"); value != "" {
		maintenanceInterval, err = time.ParseDuration(value)
		if err != nil || maintenanceInterval < time.Minute {
			fatal(logger, errors.New("WORKER_MAINTENANCE_INTERVAL must be a duration of at least one minute"))
		}
	}

	continuousWorker, err := generation.NewWorkerClient(database, ai.ConnectionService{DB: database}, maxWorkers)
	if err != nil {
		fatal(logger, err)
	}
	if err := continuousWorker.Start(context.Background()); err != nil {
		fatal(logger, err)
	}
	ready := &atomic.Bool{}
	healthServer, healthErrors, err := startHealthServer(database, ready)
	if err != nil {
		fatal(logger, err)
	}
	ready.Store(true)
	maintenanceDone := make(chan struct{})
	maintenanceContext, cancelMaintenance := context.WithCancel(signalContext)
	defer cancelMaintenance()
	go func() {
		defer close(maintenanceDone)
		if maintenanceInterval == 0 {
			return
		}
		ticker := time.NewTicker(maintenanceInterval)
		defer ticker.Stop()
		for {
			select {
			case <-maintenanceContext.Done():
				return
			case <-ticker.C:
				runRecovery(maintenanceContext, database)
				runCleanup(maintenanceContext, database, authService)
			}
		}
	}()
	slog.Info("generation worker started", slog.Int("concurrency", maxWorkers))
	select {
	case <-signalContext.Done():
	case err := <-healthErrors:
		if err != nil {
			log.Printf("worker health server failed: %v", err)
		}
	}

	ready.Store(false)
	cancelMaintenance()
	<-maintenanceDone
	healthDone := make(chan error, 1)
	go func() {
		healthContext, cancelHealth := context.WithTimeout(context.Background(), time.Second)
		defer cancelHealth()
		healthDone <- healthServer.Shutdown(healthContext)
	}()
	if continuousWorker != nil {
		drainContext, cancelDrain := context.WithTimeout(context.Background(), time.Duration(envInt("WORKER_DRAIN_TIMEOUT", 8))*time.Second)
		stopErr := continuousWorker.Stop(drainContext)
		cancelDrain()
		if stopErr != nil {
			slog.Error("generation worker graceful shutdown failed", slog.Any("error", stopErr))
			forceContext, cancelForce := context.WithTimeout(context.Background(), time.Second)
			if err := continuousWorker.StopAndCancel(forceContext); err != nil {
				slog.Error("generation worker forced shutdown failed", slog.Any("error", err))
			}
			cancelForce()
		}
	}
	if err := <-healthDone; err != nil {
		slog.Error("worker health shutdown failed", slog.Any("error", err))
	}
}

func startHealthServer(database *sql.DB, ready *atomic.Bool) (*http.Server, <-chan error, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /live", func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /ready", func(writer http.ResponseWriter, request *http.Request) {
		if !ready.Load() {
			http.Error(writer, "worker is not ready", http.StatusServiceUnavailable)
			return
		}
		ctx, cancel := context.WithTimeout(request.Context(), time.Second)
		defer cancel()
		if err := database.PingContext(ctx); err != nil {
			http.Error(writer, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		writer.WriteHeader(http.StatusNoContent)
	})
	server := &http.Server{
		Addr:              net.JoinHostPort("0.0.0.0", env("WORKER_HEALTH_PORT", "8080")),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return nil, nil, err
	}
	errorChannel := make(chan error, 1)
	go func() {
		err := server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		errorChannel <- err
	}()
	return server, errorChannel, nil
}

func runRecovery(ctx context.Context, database *sql.DB) {
	if err := generation.RecoverTerminatedQueueJobs(ctx, database); err != nil && !errors.Is(err, context.Canceled) {
		slog.Warn("terminated generation recovery failed", slog.Any("error", err))
	}
	if err := generation.RecoverExpired(ctx, database); err != nil && !errors.Is(err, context.Canceled) {
		slog.Warn("expired generation recovery failed", slog.Any("error", err))
	}
}

func runCleanup(ctx context.Context, database *sql.DB, authService *auth.Service) {
	if deleted, err := authService.CleanupExpiredUnverifiedUsers(ctx); err != nil && !errors.Is(err, context.Canceled) {
		slog.Warn("unverified account cleanup failed", slog.Any("error", err))
	} else if deleted > 0 {
		slog.Info("deleted expired unverified accounts", slog.Int64("count", deleted))
	}
	if deleted, err := middleware.CleanupExpired(ctx, database, 500); err != nil && !errors.Is(err, context.Canceled) {
		slog.Warn("rate-limit cleanup failed", slog.Any("error", err))
	} else if deleted > 0 {
		slog.Info("deleted expired rate-limit counters", slog.Int64("count", deleted))
	}
	runImageCleanup(ctx, database)
}

func runImageCleanup(ctx context.Context, database *sql.DB) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	store, err := carddocument.StoreFromEnv()
	if err != nil {
		slog.Warn("image cleanup storage unavailable", slog.Any("error", err))
		return
	}
	if store == nil {
		return
	}
	deleted, err := carddocument.CleanupDeletedAssets(ctx, database, store, 100)
	if err != nil && !errors.Is(err, context.Canceled) {
		slog.Warn("image cleanup failed; pending images will be retried", slog.Any("error", err))
	}
	if deleted > 0 {
		slog.Info("deleted images for removed presentations", slog.Int("count", deleted))
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func fatal(logger *slog.Logger, err error) {
	logger.Error("fatal", slog.Any("error", err))
	os.Exit(1)
}
