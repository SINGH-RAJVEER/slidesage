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

## Datadog on Cloud Run

- Production uses direct intake at `https://otlp.us5.datadoghq.com`. Other sites use their own [serverless OTLP endpoints](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/serverless/).
- Metrics export delta temporality.
- Keep service names unset to retain separate API and worker defaults. GCP detection adds project, region, service, revision, and instance attributes.
- Store the complete header value in Secret Manager:

```bash
gcloud secrets create DATADOG_OTLP_HEADERS --replication-policy=automatic
printf '%s' 'dd-api-key=<api-key>,dd-otlp-source=serverless,compute_stats=true' \
	| gcloud secrets versions add DATADOG_OTLP_HEADERS --data-file=-
```

Configure `infra/prod`:

```hcl
otel_exporter_otlp_endpoint = "https://otlp.us5.datadoghq.com"
otel_service_version        = "<git-sha>"
otel_logs_exporter          = "otlp"
```

- Terraform injects the secret and grants runtime access.
- Set `otel_logs_exporter="none"` when Datadog's GCP integration already ingests stdout, avoiding duplicate logs.
- In GitHub, set `DATADOG_OTLP_ENDPOINT` and optional `OTEL_LOGS_EXPORTER`; deploy forwards them to Terraform and sets service version to the commit SHA.
- Unsetting `DATADOG_OTLP_ENDPOINT` disables export on the next deployment.

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
