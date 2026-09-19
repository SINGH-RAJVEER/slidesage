package generation

import (
	"context"
	"errors"
	"testing"
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

func TestWakeSwallowsSignallingFailures(t *testing.T) {
	waker := &stubWaker{err: errors.New("cloud tasks unavailable")}
	h := &handler{waker: waker}

	h.wake(context.Background())

	// The submission is already committed when the signal is sent. A failed
	// signal costs the deck its prompt start, not its existence, so it must
	// never surface as an error to the caller.
	if waker.calls != 1 {
		t.Fatalf("wake calls = %d, expected 1", waker.calls)
	}
}

func TestWakeIsANoOpWhenDisabled(t *testing.T) {
	h := &handler{}

	h.wake(context.Background())
}
