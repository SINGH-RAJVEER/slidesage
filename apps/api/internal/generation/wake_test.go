package generation

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestWakerFromEnvStaysDisabledWithoutATarget(t *testing.T) {
	t.Setenv("WORKER_WAKE_URL", "")

	waker, err := WakerFromEnv(context.Background())
	if err != nil {
		t.Fatalf("WakerFromEnv returned %v", err)
	}
	// A developer's worker runs continuously, so an unconfigured environment
	// must leave waking off rather than fail to start the API.
	if waker != nil {
		t.Fatalf("waker = %#v, expected none without WORKER_WAKE_URL", waker)
	}
}

func TestWakerFromEnvRequiresAQueueForItsTarget(t *testing.T) {
	t.Setenv("WORKER_WAKE_URL", "https://worker.example.com/drain")
	t.Setenv("WORKER_WAKE_QUEUE", "")

	if _, err := WakerFromEnv(context.Background()); err == nil {
		t.Fatal("expected a configured target without a queue to be rejected")
	}
}

type stubWaker struct {
	calls int
	err   error
}

func (s *stubWaker) Wake(context.Context) error {
	s.calls++
	return s.err
}

func TestWakeReportsSignallingFailures(t *testing.T) {
	failure := errors.New("cloud tasks unavailable")
	waker := &stubWaker{err: failure}
	h := &handler{waker: waker}

	err := h.wake(context.Background())

	if !errors.Is(err, failure) {
		t.Fatalf("wake returned %v, expected signalling failure", err)
	}
	if waker.calls != 1 {
		t.Fatalf("wake calls = %d, expected 1", waker.calls)
	}
}

func TestWakeIsANoOpWhenDisabled(t *testing.T) {
	h := &handler{}

	if err := h.wake(context.Background()); err != nil {
		t.Fatalf("disabled wake returned %v", err)
	}
}

func TestCloudTaskPreservesEachWakeForHorizontalScaling(t *testing.T) {
	waker := &cloudTasksWaker{
		target:         "https://worker.example.com/drain",
		audience:       "https://worker.example.com",
		serviceAccount: "worker@example.iam.gserviceaccount.com",
		deadline:       30 * time.Minute,
	}

	task := waker.task()
	if task.Name != "" {
		t.Fatalf("task name = %q, expected Cloud Tasks to allocate a unique name", task.Name)
	}
	if task.DispatchDeadline != "1800s" {
		t.Fatalf("dispatch deadline = %q", task.DispatchDeadline)
	}
	if task.HttpRequest.Url != waker.target || task.HttpRequest.OidcToken == nil {
		t.Fatalf("task request = %#v", task.HttpRequest)
	}
}
