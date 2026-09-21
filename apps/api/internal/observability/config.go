// Package observability wires OpenTelemetry signals (traces, metrics, and
// logs) into the SlideSage API and generation worker processes. Everything
// is configured through standard OTEL_* environment variables and exported
// over OTLP HTTP/protobuf. When no endpoint is configured, the SDK stays
// disabled and processes run with local-only logging.
package observability

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// protocolHTTPProtobuf is the only OTLP transport this package speaks.
// Datadog's direct intake does not accept gRPC, and the MLflow exporter is
// HTTP-only, so nothing needed the gRPC exporters.
const protocolHTTPProtobuf = "http/protobuf"

// Config controls which telemetry providers Setup installs. The zero value
// yields a fully disabled telemetry instance that still returns usable loggers.
type Config struct {
	ServiceName     string  // OTEL_SERVICE_NAME
	ServiceVersion  string  // OTEL_SERVICE_VERSION
	Environment     string  // OTEL_RESOURCE_ENVIRONMENT (deployment.environment)
	Endpoint        string  // OTEL_EXPORTER_OTLP_ENDPOINT
	Protocol        string  // OTEL_EXPORTER_OTLP_PROTOCOL
	SamplingRatio   float64 // OTEL_TRACES_SAMPLING_RATIO
	MetricInterval  int     // OTEL_METRIC_EXPORT_INTERVAL in milliseconds
	TracesDisabled  bool    // OTEL_TRACES_EXPORTER=none
	MetricsDisabled bool    // OTEL_METRICS_EXPORTER=none
	LogsDisabled    bool    // OTEL_LOGS_EXPORTER=none
	Disabled        bool    // true when OTEL_SDK_DISABLED or no trace destination is set
	MLflow          MLflowConfig
}

// MLflowConfig controls the optional second trace exporter. Metrics and logs
// continue to use the primary OTLP endpoint because MLflow ingests traces only.
type MLflowConfig struct {
	TrackingURI  string // MLFLOW_TRACKING_URI
	ExperimentID string // MLFLOW_EXPERIMENT_ID
	Workspace    string // MLFLOW_WORKSPACE
	GCPAudience  string // MLFLOW_GCP_AUDIENCE
}

// ConfigFromEnv reads standard OpenTelemetry environment variables. It never
// fails: invalid numeric values fall back to their defaults so a mistyped env
// var cannot prevent an API process from starting.
func ConfigFromEnv() Config {
	return configFromEnv("slidesage-api")
}

// WorkerConfigFromEnv behaves like ConfigFromEnv but tags records with the
// worker service name so API and worker traces stay distinguishable.
func WorkerConfigFromEnv() Config {
	return configFromEnv("slidesage-worker")
}

func configFromEnv(defaultServiceName string) Config {
	config := Config{
		ServiceName:     strings.TrimSpace(os.Getenv("OTEL_SERVICE_NAME")),
		ServiceVersion:  strings.TrimSpace(os.Getenv("OTEL_SERVICE_VERSION")),
		Environment:     strings.TrimSpace(os.Getenv("OTEL_RESOURCE_ENVIRONMENT")),
		Endpoint:        strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")),
		Protocol:        strings.ToLower(strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_PROTOCOL"))),
		SamplingRatio:   floatFromEnv("OTEL_TRACES_SAMPLING_RATIO", 1),
		MetricInterval:  intFromEnv("OTEL_METRIC_EXPORT_INTERVAL", 60000),
		TracesDisabled:  exporterDisabled("OTEL_TRACES_EXPORTER"),
		MetricsDisabled: exporterDisabled("OTEL_METRICS_EXPORTER"),
		LogsDisabled:    exporterDisabled("OTEL_LOGS_EXPORTER"),
		MLflow: MLflowConfig{
			TrackingURI:  strings.TrimRight(strings.TrimSpace(os.Getenv("MLFLOW_TRACKING_URI")), "/"),
			ExperimentID: strings.TrimSpace(os.Getenv("MLFLOW_EXPERIMENT_ID")),
			Workspace:    strings.TrimSpace(os.Getenv("MLFLOW_WORKSPACE")),
			GCPAudience:  strings.TrimSpace(os.Getenv("MLFLOW_GCP_AUDIENCE")),
		},
	}
	if config.ServiceName == "" {
		config.ServiceName = defaultServiceName
	}
	if config.Environment == "" {
		config.Environment = firstNonEmpty(os.Getenv("ENVIRONMENT"), os.Getenv("NODE_ENV"), "development")
	}
	if config.Protocol == "" {
		config.Protocol = protocolHTTPProtobuf
	}
	disabled := boolFromEnv("OTEL_SDK_DISABLED", false)
	if disabled || (config.Endpoint == "" && config.MLflow.TrackingURI == "") {
		config.Disabled = true
	}
	return config
}

// Validate rejects configurations that would silently drop telemetry, such as
// an enabled endpoint combined with an out-of-range sampling ratio. Export
// settings are ignored while the SDK is disabled.
func (config Config) Validate() error {
	if config.ServiceName == "" {
		return fmt.Errorf("service name must not be empty")
	}
	if config.Disabled {
		return nil
	}
	if !config.TracesDisabled && (config.SamplingRatio < 0 || config.SamplingRatio > 1) {
		return fmt.Errorf("sampling ratio %g must be between 0 and 1", config.SamplingRatio)
	}
	if config.Endpoint != "" && config.Protocol != protocolHTTPProtobuf {
		return fmt.Errorf("OTLP protocol %q is not supported, only %q is", config.Protocol, protocolHTTPProtobuf)
	}
	if config.Endpoint != "" {
		endpoint, err := url.Parse(config.Endpoint)
		if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
			return fmt.Errorf("OTLP endpoint %q must be an absolute URL", config.Endpoint)
		}
	}
	if !config.MetricsDisabled && config.MetricInterval < 1000 {
		return fmt.Errorf("metric export interval %dms must be at least 1000ms", config.MetricInterval)
	}
	if config.MLflow.TrackingURI != "" {
		endpoint, err := url.Parse(config.MLflow.TrackingURI)
		if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
			return fmt.Errorf("MLflow tracking URI %q must be an absolute URL", config.MLflow.TrackingURI)
		}
		if config.MLflow.ExperimentID == "" {
			return fmt.Errorf("MLflow experiment ID must not be empty when MLflow export is enabled")
		}
	}
	return nil
}

func boolFromEnv(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func floatFromEnv(name string, fallback float64) float64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func intFromEnv(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func exporterDisabled(name string) bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv(name)), "none")
}
