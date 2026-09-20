package main

import (
	"context"
	"errors"
	"testing"
	"time"
)

type stubDrainWorker struct {
	starts    int
	stops     int
	hardStops int
	stopErr   error
}

func (worker *stubDrainWorker) Start(context.Context) error {
	worker.starts++
	return nil
}

func (worker *stubDrainWorker) Stop(context.Context) error {
	worker.stops++
	return worker.stopErr
}

func (worker *stubDrainWorker) StopAndCancel(context.Context) error {
	worker.hardStops++
	return nil
}

func TestDrainQueueOwnsTheWorkerUntilTheQueueSettles(t *testing.T) {
	worker := &stubDrainWorker{}
	counts := []int{2, 1, 0, 0, 0}
	calls := 0
	count := func(context.Context) (int, error) {
		if worker.starts != 1 {
			t.Fatal("queue was counted before the request-owned worker started")
		}
		if calls < len(counts) {
			calls++
			return counts[calls-1], nil
		}
		return 0, nil
	}
	err := drainQueue(context.Background(), worker, count, drainSettings{
		poll:    time.Millisecond,
		idle:    3 * time.Millisecond,
		accept:  100 * time.Millisecond,
		handoff: 10 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("drainQueue returned %v", err)
	}
	if worker.starts != 1 || worker.stops != 1 || worker.hardStops != 0 {
		t.Fatalf("worker lifecycle = start %d, stop %d, hard stop %d", worker.starts, worker.stops, worker.hardStops)
	}
	if calls < 4 {
		t.Fatalf("drain returned after %d checks, expected it to keep polling through the settle window", calls)
	}
}

func TestDrainQueueResetsTheSettleWindowWhenWorkArrives(t *testing.T) {
	worker := &stubDrainWorker{}
	counts := []int{0, 0, 1, 0, 0, 0, 0}
	calls := 0
	count := func(context.Context) (int, error) {
		if calls < len(counts) {
			calls++
			return counts[calls-1], nil
		}
		return 0, nil
	}

	err := drainQueue(context.Background(), worker, count, drainSettings{
		poll:    time.Millisecond,
		idle:    2 * time.Millisecond,
		accept:  100 * time.Millisecond,
		handoff: 10 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("drainQueue returned %v", err)
	}
	if calls <= 3 {
		t.Fatalf("drain returned after %d checks, the arriving job should have reset the settle window", calls)
	}
}

func TestDrainQueueRenewsBeforeAcknowledgingOutstandingWork(t *testing.T) {
	worker := &stubDrainWorker{}
	count := func(context.Context) (int, error) { return 1, nil }

	err := drainQueue(context.Background(), worker, count, drainSettings{
		poll:    time.Millisecond,
		idle:    time.Millisecond,
		accept:  3 * time.Millisecond,
		handoff: 10 * time.Millisecond,
	})
	if !errors.Is(err, errDrainLeaseRenewalRequired) {
		t.Fatalf("drainQueue returned %v, expected Cloud Tasks retry signal", err)
	}
	if worker.stops != 1 {
		t.Fatalf("graceful stops = %d, expected one before renewal", worker.stops)
	}
}

func TestDrainQueueRenewsWhenGracefulHandoffFails(t *testing.T) {
	worker := &stubDrainWorker{stopErr: context.DeadlineExceeded}
	counts := []int{1, 0}
	calls := 0
	count := func(context.Context) (int, error) {
		result := counts[calls]
		calls++
		return result, nil
	}

	err := drainQueue(context.Background(), worker, count, drainSettings{
		poll:    time.Millisecond,
		idle:    time.Millisecond,
		accept:  time.Millisecond,
		handoff: time.Millisecond,
	})
	if !errors.Is(err, errDrainLeaseRenewalRequired) {
		t.Fatalf("drainQueue returned %v, expected renewal after an interrupted handoff", err)
	}
	if worker.hardStops != 1 {
		t.Fatalf("hard stops = %d, expected interrupted work to be cancelled", worker.hardStops)
	}
}

func TestDrainQueueHardStopsWhenTheRequestIsCancelled(t *testing.T) {
	worker := &stubDrainWorker{}
	count := func(context.Context) (int, error) { return 1, nil }
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := drainQueue(ctx, worker, count, drainSettings{
		poll:    time.Millisecond,
		idle:    time.Millisecond,
		accept:  time.Minute,
		handoff: 10 * time.Millisecond,
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("drainQueue returned %v, expected request cancellation", err)
	}
	if worker.hardStops != 1 {
		t.Fatalf("hard stops = %d, expected the unprotected work to be cancelled", worker.hardStops)
	}
}

func TestDrainQueueReportsCountingFailures(t *testing.T) {
	worker := &stubDrainWorker{}
	failure := errors.New("database unavailable")
	count := func(context.Context) (int, error) { return 0, failure }

	err := drainQueue(context.Background(), worker, count, drainSettings{
		poll:    time.Millisecond,
		idle:    time.Millisecond,
		accept:  time.Minute,
		handoff: 10 * time.Millisecond,
	})
	if !errors.Is(err, failure) {
		t.Fatalf("drainQueue returned %v, expected the counting failure", err)
	}
}
