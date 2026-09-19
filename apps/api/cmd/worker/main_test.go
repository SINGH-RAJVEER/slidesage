package main

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDrainQueueWaitsForTheQueueToSettle(t *testing.T) {
	counts := []int{2, 1, 0, 0, 0}
	calls := 0
	count := func(context.Context) (int, error) {
		if calls < len(counts) {
			calls++
			return counts[calls-1], nil
		}
		return 0, nil
	}

	err := drainQueue(context.Background(), count, drainSettings{poll: time.Millisecond, idle: 3 * time.Millisecond})
	if err != nil {
		t.Fatalf("drainQueue returned %v", err)
	}
	// The queue first reads empty on the third call, and the drain may only
	// return once it has stayed empty for the settle window after that.
	if calls < 4 {
		t.Fatalf("drain returned after %d checks, expected it to keep polling through the settle window", calls)
	}
}

func TestDrainQueueKeepsWaitingWhileWorkRemains(t *testing.T) {
	count := func(context.Context) (int, error) { return 1, nil }
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	err := drainQueue(ctx, count, drainSettings{poll: time.Millisecond, idle: time.Millisecond})
	// A busy queue must hold the request open until the caller's deadline, so
	// Cloud Run keeps seeing an in-flight request and leaves the instance alone.
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("drainQueue returned %v, expected the deadline to be what stops it", err)
	}
}

func TestDrainQueueResetsTheSettleWindowWhenWorkArrives(t *testing.T) {
	counts := []int{0, 0, 1, 0, 0, 0, 0}
	calls := 0
	count := func(context.Context) (int, error) {
		if calls < len(counts) {
			calls++
			return counts[calls-1], nil
		}
		return 0, nil
	}

	err := drainQueue(context.Background(), count, drainSettings{poll: time.Millisecond, idle: 2 * time.Millisecond})
	if err != nil {
		t.Fatalf("drainQueue returned %v", err)
	}
	// A job arriving on the third check restarts the window, so the drain
	// cannot have returned on the strength of the first two empty reads.
	if calls <= 3 {
		t.Fatalf("drain returned after %d checks, the arriving job should have reset the settle window", calls)
	}
}

func TestDrainQueueReportsCountingFailures(t *testing.T) {
	failure := errors.New("database unavailable")
	count := func(context.Context) (int, error) { return 0, failure }

	err := drainQueue(context.Background(), count, drainSettings{poll: time.Millisecond, idle: time.Millisecond})
	if !errors.Is(err, failure) {
		t.Fatalf("drainQueue returned %v, expected the counting failure", err)
	}
}
