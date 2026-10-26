# Observability

- `apps/api/internal/observability` exports API and worker traces, metrics, and logs through OTLP HTTP/protobuf.
- Export starts only with `OTEL_EXPORTER_OTLP_ENDPOINT`; otherwise processes write local text logs.

## Signals

### Traces

- API requests create server spans. River jobs persist W3C context; worker attempts and provider HTTP calls continue the trace.
- Job attributes include ID, attempt, outcome, and token usage.
- `gen_ai.chat` spans record provider, model, prompt name/hash, output bound, reported usage, and sanitized errors.
- `GEN_AI_CAPTURE_CONTENT=true` adds prompts and structured responses. Default is false; serialized values above 256 KiB are omitted.
- HTTP span names use `HTTP <method>`. `http.route` carries the resolved ServeMux pattern or `unmatched`, preventing unbounded path tags.

### Metrics

| Instrument | Type | Purpose |
| --- | --- | --- |
| `http.server.request.duration` | Histogram, seconds | Duration by method, route, status, scheme |
| `http.server.requests` | Counter | Request count |
| `http.server.active_requests` | UpDownCounter | In-flight requests |
| `http.server.panics` | Counter | Recovered panics |
| `generation.job.duration` | Histogram, seconds | Attempt duration |
| `generation.job.attempts` | Counter | Attempt outcomes |
| `generation.tokens.used` | Counter | Provider tokens by presentation kind |

### Logs

- `log/slog` writes stdout text and mirrors records to OTLP.
- Active-span logs include `trace_id` and `span_id`.
- Recovered panics log errors, record span exceptions, and increment the panic counter.

## Configuration

- Variables and defaults are listed in [Environment variables](ENVIRONMENT_VARIABLES.md#observability).
- Endpoint must be an absolute URL with a scheme. Export supports only `http/protobuf`.
- `OTEL_SDK_DISABLED=true` disables export. Individual signal exporters accept `none`.
- Invalid numeric settings fall back to defaults.
- `GEN_AI_CAPTURE_CONTENT` is documented under [Traces](#traces); enable it only when prompt/response capture is needed.

## Local development

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.us5.datadoghq.com
OTEL_EXPORTER_OTLP_HEADERS=dd-api-key=<api-key>
```

- Filter Datadog on `env:development` for local runs.
- Local telemetry is billed. Leave the endpoint empty when unused or reduce `OTEL_TRACES_SAMPLING_RATIO`.

## Datadog in Containers

- API and worker export directly to the OTLP endpoint configured in the Worker `APP_ENV` secret. Metrics use delta temporality.
- Set `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, and `OTEL_EXPORTER_OTLP_HEADERS=dd-api-key=<api-key>,compute_stats=true` in that secret. Keep credentials out of the repository.
- Service names default to `slidesage-api` and `slidesage-worker`. The edge controller sets `OTEL_SERVICE_VERSION` to the Worker version ID and `NODE_ENV` to `production`.
- Upload the updated secret and deploy a new Worker version so the controller drains and restarts the application instances with the new environment. Keep `OTEL_LOGS_EXPORTER=otlp` for direct log intake, or `none` when logs are collected separately.
- An empty endpoint disables export.

### Check ingestion

1. Send an API request and run a presentation job.
2. In Trace Explorer, filter `service:slidesage-api env:production`; inspect worker/provider spans and `service:slidesage-worker` separately.
3. In Metrics Explorer, select request and generation instruments. Use the picker because Datadog may normalize names.
4. In Logs Explorer, open an active-request log and follow its trace link.
5. In Service Catalog, verify production environment and deployed version.

- Useful dashboard metrics are request/error rate, p95 request duration, generation outcomes/p95 duration, and token use.
- Missing data: inspect exporter logs. `403` usually means incorrect credentials or site; protocol errors require `http/protobuf`.
- Datadog may return `202 Accepted`; Go exporters can report it as an error despite accepted traces.

## Lifecycle

- `observability.Setup` installs trace, metric, log, and W3C propagation providers.
- API and worker defer `Shutdown` with a five-second flush budget during graceful termination.
