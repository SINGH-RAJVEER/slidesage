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

	// The sweep runs as a scheduled Cloud Run job rather than a ticker inside
	// the worker. A scaled-to-zero worker is not running to hold a ticker, and
	// pinging it often enough to be one would keep an instance alive, which is
	// the cost this whole design removes.
	if *maintenance {
		runRecovery(signalContext, database)
		runCleanup(signalContext, database, authService)
		wakeStrandedWork(signalContext, database)
		slog.Info("maintenance sweep finished")
		return
	}

	client, err := generation.NewWorkerClient(database, ai.ConnectionService{DB: database}, maxWorkers)
	if err != nil {
		fatal(logger, err)
	}
	workerContext, cancelWorker := context.WithCancel(context.Background())
	defer cancelWorker()
	if err := client.Start(workerContext); err != nil {
		fatal(logger, err)
	}
	ready := &atomic.Bool{}
	healthServer, healthErrors, err := startHealthServer(database, ready)
	if err != nil {
		fatal(logger, err)
	}
	ready.Store(true)
	slog.Info("generation worker started", slog.Int("concurrency", maxWorkers))
	select {
	case <-signalContext.Done():
	case err := <-healthErrors:
		if err != nil {
			log.Printf("worker health server failed: %v", err)
		}
	}

	ready.Store(false)
	healthDone := make(chan error, 1)
	go func() {
		healthContext, cancelHealth := context.WithTimeout(context.Background(), time.Second)
		defer cancelHealth()
		healthDone <- healthServer.Shutdown(healthContext)
	}()
	drainContext, cancelDrain := context.WithTimeout(context.Background(), time.Duration(envInt("WORKER_DRAIN_TIMEOUT", 8))*time.Second)
	stopErr := client.Stop(drainContext)
	cancelDrain()
	if stopErr != nil {
		slog.Error("generation worker graceful shutdown failed", slog.Any("error", stopErr))
		cancelWorker()
		forceContext, cancelForce := context.WithTimeout(context.Background(), time.Second)
		if err := client.StopAndCancel(forceContext); err != nil {
			slog.Error("generation worker forced shutdown failed", slog.Any("error", err))
		}
		cancelForce()
	}
	cancelWorker()
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
	mux.HandleFunc("POST /drain", func(writer http.ResponseWriter, request *http.Request) {
		if !ready.Load() {
			http.Error(writer, "worker is not ready", http.StatusServiceUnavailable)
			return
		}
		ctx, cancel := context.WithTimeout(request.Context(), time.Duration(envInt("WORKER_DRAIN_MAX_SECONDS", 1800))*time.Second)
		defer cancel()
		outstanding := func(ctx context.Context) (int, error) {
			return generation.OutstandingGenerationJobs(ctx, database)
		}
		err := drainQueue(ctx, outstanding, drainSettings{
			poll: time.Duration(envInt("WORKER_DRAIN_POLL_SECONDS", 2)) * time.Second,
			idle: time.Duration(envInt("WORKER_DRAIN_IDLE_SECONDS", 30)) * time.Second,
		})
		// A drain that runs out of time has not failed: the queue is simply
		// still busy. Reporting an error would make the caller retry a wake
		// signal the worker is already acting on.
		if err != nil && !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
			slog.Error("drain failed", slog.Any("error", err))
			http.Error(writer, "drain failed", http.StatusInternalServerError)
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

type drainSettings struct {
	poll time.Duration
	idle time.Duration
}

// drainQueue blocks while the generation queue has work, and that blocking is
// the point. Cloud Run decides whether an instance is busy by counting requests
// in flight, so an instance whose only activity is a River job looks idle and
// becomes a scale-down candidate mid-generation. Holding the wake request open
// for the length of the work is what makes the work visible to the autoscaler.
//
// The queue must stay empty for a settle window before the drain returns, so a
// job enqueued moments after the last one finishes does not lose its worker to
// a race between the poller and this check.
func drainQueue(ctx context.Context, count func(context.Context) (int, error), settings drainSettings) error {
	ticker := time.NewTicker(settings.poll)
	defer ticker.Stop()
	var idleSince time.Time
	for {
		outstanding, err := count(ctx)
		if err != nil {
			return err
		}
		switch {
		case outstanding > 0:
			idleSince = time.Time{}
		case idleSince.IsZero():
			idleSince = time.Now()
		case time.Since(idleSince) >= settings.idle:
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// wakeStrandedWork restarts a queue that has work but no worker. River schedules
// a retry for a future time, and a wake signal can be lost while the service is
// paused for a migration; in both cases the row is waiting and nothing is
// polling for it. The sweep is the only thing that runs on a timer now, so it
// is also the only thing that can notice.
func wakeStrandedWork(ctx context.Context, database *sql.DB) {
	outstanding, err := generation.OutstandingGenerationJobs(ctx, database)
	if err != nil {
		slog.Warn("stranded work check failed", slog.Any("error", err))
		return
	}
	if outstanding == 0 {
		return
	}
	waker, err := generation.WakerFromEnv(ctx)
	if err != nil {
		slog.Warn("stranded work waker unavailable", slog.Any("error", err))
		return
	}
	if waker == nil {
		return
	}
	if err := waker.Wake(ctx); err != nil {
		slog.Warn("stranded work wake failed", slog.Any("error", err))
		return
	}
	slog.Info("woke the worker for stranded queue work", slog.Int("outstanding", outstanding))
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
