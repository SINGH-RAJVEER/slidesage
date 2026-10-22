package rewards

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// rewardMetrics count session and claim outcomes. A high too_early share is
// the signal that claims are being forged by scripts.
type rewardMetrics struct {
	sessions metric.Int64Counter
	claims   metric.Int64Counter
}

var metricsFor = sync.OnceValue(func() rewardMetrics {
	meter := otel.Meter("github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/rewards")
	metrics := rewardMetrics{}
	if sessions, err := meter.Int64Counter("rewards.ad.sessions", metric.WithDescription("Ad reward session requests by outcome")); err == nil {
		metrics.sessions = sessions
	}
	if claims, err := meter.Int64Counter("rewards.ad.claims", metric.WithDescription("Ad reward claims by outcome")); err == nil {
		metrics.claims = claims
	}
	return metrics
})

func recordSession(ctx context.Context, outcome string) {
	if counter := metricsFor().sessions; counter != nil {
		counter.Add(ctx, 1, metric.WithAttributes(attribute.String("outcome", outcome)))
	}
}

func recordClaim(ctx context.Context, outcome string) {
	if counter := metricsFor().claims; counter != nil {
		counter.Add(ctx, 1, metric.WithAttributes(attribute.String("outcome", outcome)))
	}
}
