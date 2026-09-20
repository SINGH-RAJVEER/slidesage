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
	"strings"
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

type drainWorker interface {
	Start(context.Context) error
	Stop(context.Context) error
	StopAndCancel(context.Context) error
}

type drainWorkerFactory func() (drainWorker, error)

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

	requestLeased := strings.EqualFold(strings.TrimSpace(os.Getenv("WORKER_REQUEST_LEASED")), "true")
	var continuousWorker drainWorker
	var leasedWorker drainWorkerFactory
	if !requestLeased {
		continuousWorker, err = generation.NewWorkerClient(database, ai.ConnectionService{DB: database}, maxWorkers)
		if err != nil {
			fatal(logger, err)
		}
		if err := continuousWorker.Start(context.Background()); err != nil {
			fatal(logger, err)
		}
	} else {
		leasedWorker = func() (drainWorker, error) {
			return generation.NewLeasedWorkerClient(database, ai.ConnectionService{DB: database}, maxWorkers)
		}
	}
	ready := &atomic.Bool{}
	healthServer, healthErrors, err := startHealthServer(signalContext, database, ready, leasedWorker)
	if err != nil {
		fatal(logger, err)
	}
	ready.Store(true)
	slog.Info("generation worker started", slog.Int("concurrency", maxWorkers), slog.Bool("request_leased", requestLeased))
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

func startHealthServer(processContext context.Context, database *sql.DB, ready *atomic.Bool, workerFactory drainWorkerFactory) (*http.Server, <-chan error, error) {
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
		if workerFactory == nil {
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		worker, err := workerFactory()
		if err != nil {
			slog.Error("create request-owned worker", slog.Any("error", err))
			http.Error(writer, "worker unavailable", http.StatusServiceUnavailable)
			return
		}
		ctx, cancel := context.WithCancel(request.Context())
		stopProcessCancellation := context.AfterFunc(processContext, cancel)
		defer func() {
			stopProcessCancellation()
			cancel()
		}()
		outstanding := func(ctx context.Context) (int, error) {
			return generation.OutstandingGenerationJobs(ctx, database)
		}
		err = drainQueue(ctx, worker, outstanding, drainSettings{
			poll:    time.Duration(envInt("WORKER_DRAIN_POLL_SECONDS", 2)) * time.Second,
			idle:    time.Duration(envInt("WORKER_DRAIN_IDLE_SECONDS", 30)) * time.Second,
			accept:  time.Duration(envInt("WORKER_DRAIN_ACCEPT_SECONDS", 1200)) * time.Second,
			handoff: time.Duration(envInt("WORKER_DRAIN_HANDOFF_SECONDS", 480)) * time.Second,
		})
		if errors.Is(err, errDrainLeaseRenewalRequired) {
			http.Error(writer, "queue still active", http.StatusInternalServerError)
			return
		}
		if err != nil {
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
	poll    time.Duration
	idle    time.Duration
	accept  time.Duration
	handoff time.Duration
}

var errDrainLeaseRenewalRequired = errors.New("drain lease renewal required")

// drainQueue blocks while the generation queue has work, and that blocking is
// the point. Cloud Run decides whether an instance is busy by counting requests
// in flight, so an instance whose only activity is a River job looks idle and
// becomes a scale-down candidate mid-generation. Holding the wake request open
// for the length of the work is what makes the work visible to the autoscaler.
//
// The queue must stay empty for a settle window before the drain returns, so a
// job enqueued moments after the last one finishes does not lose its worker to
// a race between the poller and this check.
func drainQueue(ctx context.Context, worker drainWorker, count func(context.Context) (int, error), settings drainSettings) error {
	workerContext := context.Background()
	if err := worker.Start(workerContext); err != nil {
		return err
	}
	stopped := false
	hardStop := func() {
		forceContext, cancelForce := context.WithTimeout(context.Background(), time.Second)
		defer cancelForce()
		if err := worker.StopAndCancel(forceContext); err != nil && !errors.Is(err, context.Canceled) {
			slog.Error("request-owned worker forced shutdown failed", slog.Any("error", err))
		}
		stopped = true
	}
	defer func() {
		if !stopped {
			hardStop()
		}
	}()

	ticker := time.NewTicker(settings.poll)
	defer ticker.Stop()
	acceptTimer := time.NewTimer(settings.accept)
	defer acceptTimer.Stop()
	var idleSince time.Time
	shouldHandoff := false
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
			shouldHandoff = true
		}
		if shouldHandoff {
			break
		}
		select {
		case <-ctx.Done():
			hardStop()
			return ctx.Err()
		case <-acceptTimer.C:
			shouldHandoff = true
		case <-ticker.C:
		}
		if shouldHandoff {
			break
		}
	}

	stopContext, cancelStop := context.WithTimeout(ctx, settings.handoff)
	stopErr := worker.Stop(stopContext)
	cancelStop()
	if stopErr != nil {
		hardStop()
		return errDrainLeaseRenewalRequired
	}
	stopped = true

	outstanding, err := count(ctx)
	if err != nil {
		return err
	}
	if outstanding == 0 {
		return nil
	}
	return errDrainLeaseRenewalRequired
}

// wakeStrandedWork restarts a queue that has due work but no worker. A wake
// signal can be lost while the service is paused for a migration; the sweep is
// the timer-backed path that notices once a row is runnable.
func wakeStrandedWork(ctx context.Context, database *sql.DB) {
	outstanding, err := generation.RunnableGenerationJobs(ctx, database)
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
