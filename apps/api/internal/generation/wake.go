package generation

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"google.golang.org/api/cloudtasks/v2"
)

// Waker asks the generation worker to start working the queue.
//
// The worker runs on Cloud Run with no minimum instance, and Cloud Run only
// starts an instance in response to an inbound HTTP request. A committed
// river_job row is invisible to the autoscaler, so without a wake signal a
// scaled-to-zero worker never learns that work exists. The signal carries no
// payload: the worker still discovers the job by polling PostgreSQL.
type Waker interface {
	Wake(ctx context.Context) error
}

// cloudTasksWaker enqueues the wake signal through Cloud Tasks rather than
// calling the worker directly. Cloud Tasks owns the connection for the life of
// the drain, which is what keeps Cloud Run from scaling the instance away while
// it generates: the autoscaler counts requests in flight, not database work. An
// API instance cannot hold that connection reliably because it is itself
// scaled to zero.
type cloudTasksWaker struct {
	tasks *cloudtasks.Service

	queue          string
	target         string
	audience       string
	serviceAccount string
	deadline       time.Duration
}

// WakerFromEnv builds the wake signal from the deployment environment. It
// returns nil when WORKER_WAKE_URL is unset, which is the local and test case:
// a developer's worker is always running, so nothing needs waking.
func WakerFromEnv(ctx context.Context) (Waker, error) {
	target := strings.TrimSpace(os.Getenv("WORKER_WAKE_URL"))
	if target == "" {
		return nil, nil
	}
	queue := strings.TrimSpace(os.Getenv("WORKER_WAKE_QUEUE"))
	if queue == "" {
		return nil, fmt.Errorf("WORKER_WAKE_QUEUE is required when WORKER_WAKE_URL is set")
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("parse WORKER_WAKE_URL: %w", err)
	}
	service, err := cloudtasks.NewService(ctx)
	if err != nil {
		return nil, fmt.Errorf("create cloud tasks client: %w", err)
	}
	return &cloudTasksWaker{
		tasks:          service,
		queue:          queue,
		target:         target,
		audience:       parsed.Scheme + "://" + parsed.Host,
		serviceAccount: strings.TrimSpace(os.Getenv("WORKER_WAKE_SERVICE_ACCOUNT")),
		deadline:       time.Duration(positiveEnvInt("WORKER_WAKE_DEADLINE_SECONDS", 1800)) * time.Second,
	}, nil
}

func (w *cloudTasksWaker) task() *cloudtasks.Task {
	task := &cloudtasks.Task{
		DispatchDeadline: strconv.FormatInt(int64(w.deadline.Seconds()), 10) + "s",
		HttpRequest: &cloudtasks.HttpRequest{
			HttpMethod: "POST",
			Url:        w.target,
		},
	}
	if w.serviceAccount != "" {
		task.HttpRequest.OidcToken = &cloudtasks.OidcToken{
			Audience:            w.audience,
			ServiceAccountEmail: w.serviceAccount,
		}
	}
	return task
}

// Wake enqueues one drain task per signal. Cloud Run allows one request per
// worker instance, so preserving every signal lets a burst scale out instead
// of collapsing onto one request-owned River client.
func (w *cloudTasksWaker) Wake(ctx context.Context) error {
	task := w.task()
	request := &cloudtasks.CreateTaskRequest{Task: task}
	if _, err := w.tasks.Projects.Locations.Queues.Tasks.Create(w.queue, request).Context(ctx).Do(); err != nil {
		return err
	}
	return nil
}

// wake signals the worker without letting a signalling failure reach the user.
// The submission is already committed at this point: the deck is durable, and
// the scheduled maintenance sweep picks up anything a lost signal stranded.
func (h *handler) wake(ctx context.Context) error {
	if h.waker == nil {
		return nil
	}
	if err := h.waker.Wake(ctx); err != nil {
		slog.Warn("worker wake signal failed", slog.Any("error", err))
		return err
	}
	return nil
}

// wakeCommitted detaches signalling from the client connection while keeping
// it bounded. Calling it for idempotent reattachments gives a stranded durable
// job another prompt chance to start before the scheduled reconciliation job.
func (h *handler) wakeCommitted(ctx context.Context) {
	wakeContext, cancelWake := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancelWake()
	_ = h.wake(wakeContext)
}
