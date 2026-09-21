package observability

import (
	"context"
	"testing"
)

func TestConfigFromEnvDefaultsToDisabledWithoutEndpoint(t *testing.T) {
	t.Setenv("OTEL_SERVICE_NAME", "")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	config := ConfigFromEnv()
	if !config.Disabled {
		t.Fatal("telemetry must be disabled without an OTLP endpoint")
	}
	if config.ServiceName != "slidesage-api" {
		t.Fatalf("service name: %q", config.ServiceName)
	}
	if config.SamplingRatio != 1 || config.MetricInterval != 60000 {
		t.Fatalf("defaults: %#v", config)
	}
	if config.Protocol != protocolHTTPProtobuf {
		t.Fatalf("default protocol: %q", config.Protocol)
	}
}

func TestConfigFromEnvSupportsHTTPProtobuf(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otlp.datadoghq.com")
	t.Setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
	config := ConfigFromEnv()
	if err := config.Validate(); err != nil {
		t.Fatalf("validate HTTP/protobuf config: %v", err)
	}
	if config.Protocol != protocolHTTPProtobuf {
		t.Fatalf("protocol: %q", config.Protocol)
	}
}

func TestConfigFromEnvDisablesIndividualSignals(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "collector:4317")
	t.Setenv("OTEL_TRACES_EXPORTER", "none")
	t.Setenv("OTEL_METRICS_EXPORTER", "none")
	t.Setenv("OTEL_LOGS_EXPORTER", "none")
	config := ConfigFromEnv()
	if !config.TracesDisabled || !config.MetricsDisabled || !config.LogsDisabled {
		t.Fatalf("disabled signals: %#v", config)
	}
}

func TestConfigFromEnvEnablesWithEndpoint(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "collector:4317")
	t.Setenv("OTEL_SERVICE_NAME", "slidesage-test")
	t.Setenv("OTEL_RESOURCE_ENVIRONMENT", "staging")
	config := ConfigFromEnv()
	if config.Disabled {
		t.Fatal("telemetry should be enabled with an endpoint set")
	}
	if config.ServiceName != "slidesage-test" || config.Environment != "staging" {
		t.Fatalf("config: %#v", config)
	}
}

func TestWorkerConfigDefaultsServiceName(t *testing.T) {
	t.Setenv("OTEL_SERVICE_NAME", "")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
	config := WorkerConfigFromEnv()
	if config.ServiceName != "slidesage-worker" {
		t.Fatalf("worker service name: %q", config.ServiceName)
	}
}

func TestWorkerConfigEnablesMLflowWithoutPrimaryOTLP(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("MLFLOW_TRACKING_URI", "http://localhost:5000/")
	t.Setenv("MLFLOW_EXPERIMENT_ID", "7")
	config := WorkerConfigFromEnv()
	if config.Disabled {
		t.Fatal("MLflow should enable worker tracing without a primary OTLP endpoint")
	}
	if config.MLflow.TrackingURI != "http://localhost:5000" || config.MLflow.ExperimentID != "7" {
		t.Fatalf("MLflow config: %#v", config.MLflow)
	}
	if err := config.Validate(); err != nil {
		t.Fatalf("validate MLflow-only config: %v", err)
	}
}

func TestValidateRequiresMLflowExperimentAndAbsoluteURI(t *testing.T) {
	config := Config{
		ServiceName:    "worker",
		Protocol:       protocolHTTPProtobuf,
		SamplingRatio:  1,
		MetricInterval: 60000,
		MLflow:         MLflowConfig{TrackingURI: "localhost:5000"},
	}
	if err := config.Validate(); err == nil {
		t.Fatal("relative MLflow URI should fail validation")
	}
	config.MLflow.TrackingURI = "http://localhost:5000"
	if err := config.Validate(); err == nil {
		t.Fatal("missing MLflow experiment ID should fail validation")
	}
}

func TestConfigFromEnvSurvivesInvalidNumbers(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "collector:4317")
	t.Setenv("OTEL_TRACES_SAMPLING_RATIO", "not-a-number")
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "nope")
	config := ConfigFromEnv()
	if config.SamplingRatio != 1 || config.MetricInterval != 60000 {
		t.Fatalf("invalid values should fall back to defaults: %#v", config)
	}
}

func TestValidateRejectsBadSamplingAndInterval(t *testing.T) {
	config := Config{ServiceName: "x", Protocol: protocolHTTPProtobuf, SamplingRatio: 1.5, MetricInterval: 60000}
	if err := config.Validate(); err == nil {
		t.Fatal("sampling ratio above one should be rejected")
	}
	config = Config{ServiceName: "x", Protocol: protocolHTTPProtobuf, SamplingRatio: 1, MetricInterval: 100}
	if err := config.Validate(); err == nil {
		t.Fatal("metric interval below one second should be rejected")
	}
}

func TestValidateRejectsUnsupportedProtocolAndRelativeEndpoint(t *testing.T) {
	config := Config{ServiceName: "x", Endpoint: "collector:4317", Protocol: "http/json", SamplingRatio: 1, MetricInterval: 60000}
	if err := config.Validate(); err == nil {
		t.Fatal("unsupported protocol should be rejected")
	}
	// gRPC is rejected rather than silently ignored, so an operator following
	// an older runbook gets an error instead of a dead exporter.
	config.Protocol = "grpc"
	if err := config.Validate(); err == nil {
		t.Fatal("grpc should be rejected now that only HTTP/protobuf is built")
	}
	config.Protocol = protocolHTTPProtobuf
	if err := config.Validate(); err == nil {
		t.Fatal("an absolute endpoint URL should be required")
	}
}

func TestSignalEndpointAppendsSignalPath(t *testing.T) {
	endpoint := signalEndpoint("https://otlp.datadoghq.com/", "traces")
	if endpoint != "https://otlp.datadoghq.com/v1/traces" {
		t.Fatalf("signal endpoint: %q", endpoint)
	}
}

func TestSetupDisabledInstallsNoopProviders(t *testing.T) {
	telemetry, err := Setup(context.Background(), Config{ServiceName: "test", Disabled: true})
	if err != nil {
		t.Fatalf("setup disabled: %v", err)
	}
	defer telemetry.Shutdown(context.Background())
	if telemetry.tracerProvider != nil || telemetry.meterProvider != nil || telemetry.loggerProvider != nil {
		t.Fatal("disabled setup must not construct providers")
	}
	if telemetry.Logger() == nil {
		t.Fatal("disabled telemetry still needs a usable logger")
	}
}
