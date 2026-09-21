package observability

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestHTTPProtobufExportsAllSignalsWithConfiguredHeaders(t *testing.T) {
	var mutex sync.Mutex
	received := map[string]string{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = io.Copy(io.Discard, request.Body)
		mutex.Lock()
		received[request.URL.Path] = request.Header.Get("dd-api-key")
		mutex.Unlock()
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "dd-api-key=test-key")

	previousTracerProvider := otel.GetTracerProvider()
	previousMeterProvider := otel.GetMeterProvider()
	previousLoggerProvider := global.GetLoggerProvider()
	defer otel.SetTracerProvider(previousTracerProvider)
	defer otel.SetMeterProvider(previousMeterProvider)
	defer global.SetLoggerProvider(previousLoggerProvider)

	telemetry, err := Setup(context.Background(), Config{
		ServiceName:    "slidesage-test",
		Environment:    "test",
		Endpoint:       server.URL,
		Protocol:       protocolHTTPProtobuf,
		SamplingRatio:  1,
		MetricInterval: 1000,
	})
	if err != nil {
		t.Fatalf("setup telemetry: %v", err)
	}

	ctx, span := otel.Tracer("test").Start(context.Background(), "operation")
	counter, err := otel.Meter("test").Int64Counter("test.counter")
	if err != nil {
		t.Fatalf("create counter: %v", err)
	}
	counter.Add(ctx, 1)
	telemetry.Logger().InfoContext(ctx, "test log")
	span.End()
	if err := telemetry.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown telemetry: %v", err)
	}

	mutex.Lock()
	defer mutex.Unlock()
	for _, path := range []string{"/v1/traces", "/v1/metrics", "/v1/logs"} {
		if received[path] != "test-key" {
			t.Errorf("%s header: %q", path, received[path])
		}
	}
}

func TestHTTPMetricTemporalityIsDelta(t *testing.T) {
	for _, kind := range []metric.InstrumentKind{
		metric.InstrumentKindCounter,
		metric.InstrumentKindHistogram,
		metric.InstrumentKindObservableCounter,
	} {
		if got := deltaTemporality(kind); got != metricdata.DeltaTemporality {
			t.Errorf("instrument kind %v temporality: %v", kind, got)
		}
	}
}

func TestMLflowReceivesSecondTraceWithoutPrimaryHeaders(t *testing.T) {
	var mutex sync.Mutex
	primaryRequests := 0
	mlflowHeaders := http.Header{}
	primary := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = io.Copy(io.Discard, request.Body)
		mutex.Lock()
		primaryRequests++
		mutex.Unlock()
		writer.WriteHeader(http.StatusOK)
	}))
	defer primary.Close()
	mlflow := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = io.Copy(io.Discard, request.Body)
		mutex.Lock()
		mlflowHeaders = request.Header.Clone()
		mutex.Unlock()
		writer.WriteHeader(http.StatusOK)
	}))
	defer mlflow.Close()
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "dd-api-key=datadog-secret")

	previousTracerProvider := otel.GetTracerProvider()
	defer otel.SetTracerProvider(previousTracerProvider)
	telemetry, err := Setup(context.Background(), Config{
		ServiceName:     "slidesage-worker",
		Environment:     "test",
		Endpoint:        primary.URL,
		Protocol:        protocolHTTPProtobuf,
		SamplingRatio:   1,
		MetricInterval:  60000,
		MetricsDisabled: true,
		LogsDisabled:    true,
		MLflow: MLflowConfig{
			TrackingURI:  mlflow.URL,
			ExperimentID: "42",
		},
	})
	if err != nil {
		t.Fatalf("setup dual trace export: %v", err)
	}
	_, span := otel.Tracer("test").Start(context.Background(), "generation")
	span.End()
	if err := telemetry.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown telemetry: %v", err)
	}

	mutex.Lock()
	defer mutex.Unlock()
	if primaryRequests != 1 {
		t.Fatalf("primary trace requests: %d", primaryRequests)
	}
	if got := mlflowHeaders.Get("x-mlflow-experiment-id"); got != "42" {
		t.Fatalf("MLflow experiment header: %q", got)
	}
	if leaked := mlflowHeaders.Get("dd-api-key"); leaked != "" {
		t.Fatalf("Datadog API key leaked to MLflow: %q", leaked)
	}
}

func TestMLflowOTLPIntegration(t *testing.T) {
	trackingURI := os.Getenv("MLFLOW_INTEGRATION_URI")
	if trackingURI == "" {
		t.Skip("set MLFLOW_INTEGRATION_URI to test a real MLflow server")
	}
	previousTracerProvider := otel.GetTracerProvider()
	defer otel.SetTracerProvider(previousTracerProvider)
	telemetry, err := Setup(context.Background(), Config{
		ServiceName:    "slidesage-integration-test",
		Environment:    "test",
		Protocol:       protocolGRPC,
		SamplingRatio:  1,
		MetricInterval: 60000,
		MLflow: MLflowConfig{
			TrackingURI:  trackingURI,
			ExperimentID: "0",
		},
	})
	if err != nil {
		t.Fatalf("setup MLflow integration exporter: %v", err)
	}
	_, span := otel.Tracer("test").Start(context.Background(), "mlflow.integration")
	span.SetAttributes(attribute.String("gen_ai.operation.name", "chat"))
	span.End()
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := telemetry.Shutdown(shutdownContext); err != nil {
		t.Fatalf("flush MLflow trace: %v", err)
	}
}
