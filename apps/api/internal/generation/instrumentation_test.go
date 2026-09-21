package generation

import (
	"context"
	"testing"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/integrations/ai"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestJobArgsPropagateSubmissionTraceToWorker(t *testing.T) {
	spanRecorder := tracetest.NewSpanRecorder()
	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(spanRecorder),
	)
	defer func() { _ = tracerProvider.Shutdown(context.Background()) }()
	previousProvider := otel.GetTracerProvider()
	previousPropagator := otel.GetTextMapPropagator()
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	defer otel.SetTracerProvider(previousProvider)
	defer otel.SetTextMapPropagator(previousPropagator)

	submissionContext, submissionSpan := tracerProvider.Tracer("test").Start(context.Background(), "submit")
	args := newJobArgs(submissionContext, "job_1")
	_, jobSpan := startJobSpan(context.Background(), args, 1)
	jobSpan.End()
	submissionSpan.End()

	if args.TraceParent == "" {
		t.Fatal("job arguments did not capture traceparent")
	}
	spans := spanRecorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("ended spans: %d", len(spans))
	}
	var workerTraceID string
	for _, span := range spans {
		if span.Name() == "generation.job" {
			workerTraceID = span.SpanContext().TraceID().String()
		}
	}
	if workerTraceID != submissionSpan.SpanContext().TraceID().String() {
		t.Fatalf("worker trace ID %q does not match submission trace ID %q", workerTraceID, submissionSpan.SpanContext().TraceID())
	}
}

func TestProviderSpanUsesGenAISemanticAttributes(t *testing.T) {
	spanRecorder := tracetest.NewSpanRecorder()
	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(spanRecorder),
	)
	defer func() { _ = tracerProvider.Shutdown(context.Background()) }()
	previousProvider := otel.GetTracerProvider()
	previousTracer := tracer
	otel.SetTracerProvider(tracerProvider)
	tracer = tracerProvider.Tracer("test")
	defer otel.SetTracerProvider(previousProvider)
	defer func() { tracer = previousTracer }()
	t.Setenv("MLFLOW_CAPTURE_CONTENT", "true")

	ctx, span := startProviderSpan(context.Background(), ai.OpenAI, "gpt-5", "slot-draft", "system", "user", 1200)
	recordProviderUsage(ctx, 100, 40)
	finishProviderSpan(span, map[string]any{"title": "Deck"}, 140, nil)

	spans := spanRecorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans: %d", len(spans))
	}
	attributes := map[string]any{}
	for _, value := range spans[0].Attributes() {
		attributes[string(value.Key)] = value.Value.AsInterface()
	}
	for key, want := range map[string]any{
		"gen_ai.operation.name":      "chat",
		"gen_ai.provider.name":       "openai",
		"gen_ai.request.model":       "gpt-5",
		"gen_ai.prompt.name":         "slot-draft",
		"gen_ai.usage.input_tokens":  int64(100),
		"gen_ai.usage.output_tokens": int64(40),
		"slidesage.tokens.total":     int64(140),
	} {
		if got := attributes[key]; got != want {
			t.Errorf("%s = %#v, want %#v", key, got, want)
		}
	}
	if attributes["gen_ai.input.messages"] == nil || attributes["gen_ai.output.messages"] == nil {
		t.Fatalf("content attributes missing: %#v", attributes)
	}
}

func TestProviderSpanOmitsContentByDefault(t *testing.T) {
	spanRecorder := tracetest.NewSpanRecorder()
	tracerProvider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spanRecorder))
	defer func() { _ = tracerProvider.Shutdown(context.Background()) }()
	previousProvider := otel.GetTracerProvider()
	previousTracer := tracer
	otel.SetTracerProvider(tracerProvider)
	tracer = tracerProvider.Tracer("test")
	defer otel.SetTracerProvider(previousProvider)
	defer func() { tracer = previousTracer }()
	t.Setenv("MLFLOW_CAPTURE_CONTENT", "")

	_, span := startProviderSpan(context.Background(), ai.Anthropic, "claude", "slot-draft", "private system", "private user", 100)
	finishProviderSpan(span, map[string]any{"private": "output"}, 10, nil)
	for _, value := range spanRecorder.Ended()[0].Attributes() {
		if value.Key == "gen_ai.input.messages" || value.Key == "gen_ai.output.messages" {
			t.Fatalf("content attribute %s should be disabled", value.Key)
		}
	}
}
