package generation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/integrations/ai"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

const providerTraceContentLimit = 256 * 1024

// The generation pipeline reports spans and metrics through the global
// OpenTelemetry providers installed by the observability package during
// process startup. When telemetry is disabled these handles stay no-ops.
var (
	tracer     = otel.Tracer("github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/generation")
	meter      = otel.Meter("github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/generation")
	jobBuckets = []float64{0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300}
)

type jobMetrics struct {
	duration metric.Float64Histogram
	attempts metric.Int64Counter
	tokens   metric.Int64Counter
}

func newJobMetrics() jobMetrics {
	metrics := jobMetrics{}
	if histogram, err := meter.Float64Histogram(
		"generation.job.duration",
		metric.WithDescription("Wall-clock duration of generation job processing"),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(jobBuckets...),
	); err == nil {
		metrics.duration = histogram
	}
	if attempts, err := meter.Int64Counter(
		"generation.job.attempts",
		metric.WithDescription("Generation job processing outcomes per attempt"),
	); err == nil {
		metrics.attempts = attempts
	}
	if tokens, err := meter.Int64Counter(
		"generation.tokens.used",
		metric.WithDescription("Total AI provider tokens consumed by generation jobs"),
	); err == nil {
		metrics.tokens = tokens
	}
	return metrics
}

var jobMetricsOnce = func() func() jobMetrics {
	var once sync.Once
	var metrics jobMetrics
	return func() jobMetrics {
		once.Do(func() { metrics = newJobMetrics() })
		return metrics
	}
}()

func metricsFor() jobMetrics {
	return jobMetricsOnce()
}

func newJobArgs(ctx context.Context, jobID string) JobArgs {
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	return JobArgs{
		JobID:       jobID,
		TraceParent: carrier.Get("traceparent"),
		TraceState:  carrier.Get("tracestate"),
	}
}

// startJobSpan opens the worker-side span covering one processing attempt of a
// durable generation job.
func startJobSpan(ctx context.Context, args JobArgs, attempt int) (context.Context, trace.Span) {
	carrier := propagation.MapCarrier{
		"traceparent": args.TraceParent,
		"tracestate":  args.TraceState,
	}
	ctx = otel.GetTextMapPropagator().Extract(ctx, carrier)
	return tracer.Start(ctx, "generation.job",
		trace.WithAttributes(
			attribute.String("generation.job.id", args.JobID),
			attribute.Int("generation.job.attempt", attempt),
			attribute.String("generation.queue", generationQueue),
		),
	)
}

// finishJobSpan closes the job span and records duration and outcome metrics.
func finishJobSpan(span trace.Span, started time.Time, attempt int, err error) {
	outcome := "succeeded"
	if err != nil {
		outcome = "failed_attempt"
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	attributes := metric.WithAttributeSet(attribute.NewSet(
		attribute.Int("generation.job.attempt", attempt),
		attribute.String("generation.job.outcome", outcome),
	))
	metrics := metricsFor()
	if metrics.duration != nil {
		metrics.duration.Record(context.Background(), time.Since(started).Seconds(), attributes)
	}
	if metrics.attempts != nil {
		metrics.attempts.Add(context.Background(), 1, attributes)
	}
	span.SetAttributes(attribute.String("generation.job.outcome", outcome))
	span.End()
}

// recordTokenUsage counts provider tokens on the active span and the global
// token counter so cost dashboards can aggregate by presentation kind.
func recordTokenUsage(ctx context.Context, kind string, tokens int) {
	if tokens <= 0 {
		return
	}
	trace.SpanFromContext(ctx).SetAttributes(attribute.Int("generation.tokens.used", tokens))
	if metrics := metricsFor(); metrics.tokens != nil {
		metrics.tokens.Add(ctx, int64(tokens), metric.WithAttributes(attribute.String("generation.kind", kind)))
	}
}

func startProviderSpan(ctx context.Context, provider ai.Provider, model, promptName, system, user string, maxOutput int) (context.Context, trace.Span) {
	hash := sha256.Sum256([]byte(promptVersionMaterial(promptName, system)))
	ctx, span := tracer.Start(ctx, "gen_ai.chat",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("gen_ai.operation.name", "chat"),
			attribute.String("gen_ai.provider.name", providerSemanticName(provider)),
			attribute.String("gen_ai.request.model", model),
			attribute.Int("gen_ai.request.max_tokens", maxOutput),
			attribute.String("gen_ai.output.type", "json"),
			attribute.String("gen_ai.prompt.name", promptName),
			attribute.String("slidesage.prompt.sha256", hex.EncodeToString(hash[:])),
		),
	)
	if captureProviderContent() {
		setTraceJSON(span, "gen_ai.input.messages", []map[string]any{
			{"role": "system", "parts": []map[string]string{{"type": "text", "content": system}}},
			{"role": "user", "parts": []map[string]string{{"type": "text", "content": user}}},
		})
	}
	return ctx, span
}

func promptVersionMaterial(name, system string) string {
	switch name {
	case "slot-draft":
		return system + slotBatchPrompt
	case "slot-repair":
		return system + slotRepairPrompt
	default:
		return system
	}
}

func finishProviderSpan(span trace.Span, document map[string]any, tokens int, err error) {
	if tokens > 0 {
		span.SetAttributes(attribute.Int("slidesage.tokens.total", tokens))
	}
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	} else if captureProviderContent() {
		content, _ := json.Marshal(document)
		setTraceJSON(span, "gen_ai.output.messages", []map[string]any{
			{"role": "assistant", "parts": []map[string]string{{"type": "text", "content": string(content)}}},
		})
	}
	span.End()
}

func recordProviderUsage(ctx context.Context, input, output int) {
	attributes := make([]attribute.KeyValue, 0, 2)
	if input > 0 {
		attributes = append(attributes, attribute.Int("gen_ai.usage.input_tokens", input))
	}
	if output > 0 {
		attributes = append(attributes, attribute.Int("gen_ai.usage.output_tokens", output))
	}
	trace.SpanFromContext(ctx).SetAttributes(attributes...)
}

func captureProviderContent() bool {
	enabled, err := strconv.ParseBool(os.Getenv("MLFLOW_CAPTURE_CONTENT"))
	return err == nil && enabled
}

func setTraceJSON(span trace.Span, name string, value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return
	}
	if len(encoded) > providerTraceContentLimit {
		span.SetAttributes(attribute.Bool("slidesage.trace.content_omitted", true))
		return
	}
	span.SetAttributes(attribute.String(name, string(encoded)))
}

func providerSemanticName(provider ai.Provider) string {
	switch provider {
	case ai.OpenAI:
		return "openai"
	case ai.Google:
		return "gcp.gen_ai"
	case ai.Anthropic:
		return "anthropic"
	default:
		return string(provider)
	}
}
