# Environment variables

- Copy `.env.example` to `.env`; devenv loads it for API, worker, and Bun processes.
- Keep `.env` out of version control. Store production secrets in Secret Manager.

## Core

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_SECRET` | Production | Local-only development secret | Signs JWTs; HTTPS deployments require at least 32 characters |
| `BASE_URL` | No | `http://localhost:8000` | Public API and auth callback origin |
| `PORT` | No | `8000` | API listen port |
| `HOST` | No | `0.0.0.0` | API listen host |
| `DATABASE_URL` | No locally | Local devenv database | PostgreSQL connection string |
| `DATABASE_CONNECT_TIMEOUT` | No | `10` | PostgreSQL connection timeout in seconds |
| `DATABASE_IDLE_TIMEOUT` | No | `20` | PostgreSQL idle connection timeout in seconds |
| `DATABASE_POOL_MAX` | No | `5` | Maximum open and idle connections in the Go API pool |
| `RATE_LIMIT_HASH_SECRET` | Production | `AUTH_SECRET` | Independent secret mixed into hashed rate-limit identities |
| `TRUST_PROXY_HEADERS` | No | `false` | Allows Go to use proxy-supplied client-IP headers; enable only behind a proxy that replaces them |
| `CORS_ORIGINS` | No | Local frontend origins, `https://slidesage.pages.dev`, `https://slidesage.app`, and `https://www.slidesage.app` | Comma-separated allowed web origins; trailing slashes are normalized |
| `CORS_ORIGIN` | No | Default CORS origins | Single-origin fallback; trailing slashes are normalized |
| `BETTER_AUTH_TRUSTED_ORIGINS` | No | Local frontend, `https://slidesage.pages.dev`, `https://slidesage.app`, and `https://www.slidesage.app` | Comma-separated auth callback origins; trailing slashes are normalized |
| `VITE_API_URL` | No | `http://localhost:8000` | Browser API origin without a path suffix; set production to `https://api.slidesage.app` |
| `NODE_ENV` | No | `development` in devenv | Controls production auth and email-delivery safeguards; OTP values are never logged |

- Devenv supplies local PostgreSQL credentials, defaulting to `slidesage`, and port `5432`. Use active `PGPORT` when devenv selects another port.
- Managed API and migration commands build `DATABASE_URL` from active `PGPORT` rather than reloading a stale `.env` value.
- The API uses one bounded `database/sql` pool.
- Production web builds ignore loopback `VITE_API_URL` values and fall back to same-origin routes.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GENERATION_STREAM_LIMIT` | No | `40` | Maximum concurrent generation SSE streams in one API process |
| `GENERATION_STREAM_LIMIT_PER_USER` | No | `3` | Maximum concurrent generation SSE streams for one user in one API process |

- Use an independent production `RATE_LIMIT_HASH_SECRET` so auth-secret rotation does not reset identity hashes. See [Rate limiting](RATE_LIMITING.md).

## Database read cache

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `CACHE_REDIS_ADDR` | No | Empty | Redis host:port; empty disables caching |
| `CACHE_REDIS_PASSWORD` | Production cache | Empty | Redis AUTH credential |
| `CACHE_REDIS_CA_PEM` | Production cache | Empty | Trusted TLS CA certificates |
| `CACHE_TIMEOUT_MS` | No | `100` | Operation timeout, 1 to 1,000 milliseconds |

- GitHub `CACHE_ENABLED` controls Terraform provisioning and defaults to `false`.
- See [Database cache](DATABASE_CACHE.md) for read paths, invalidation, fallback, and production setup.

## Generation worker

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `WORKER_CONCURRENCY` | No | `2` | Maximum concurrent River generation jobs in one worker process |
| `WORKER_DATABASE_POOL_MAX` | No | `WORKER_CONCURRENCY + 3` | Maximum open and idle connections in the worker database pool |
| `WORKER_DRAIN_TIMEOUT` | No | `8` | Graceful shutdown timeout in seconds after `SIGINT` or `SIGTERM` |
| `WORKER_HEALTH_PORT` | No | `8080` | Worker `/live`, `/ready`, and `/drain` health server port |
| `WORKER_DRAIN_POLL_SECONDS` | No | `2` | Interval at which `POST /drain` recounts outstanding queue rows |
| `WORKER_DRAIN_IDLE_SECONDS` | No | `30` | How long the queue must stay empty before `POST /drain` returns |
| `WORKER_DRAIN_ACCEPT_SECONDS` | No | `1200` | How long a request-owned River client may claim new jobs |
| `WORKER_DRAIN_HANDOFF_SECONDS` | No | `480` | Time reserved for active work to finish before lease renewal |
| `WORKER_REQUEST_LEASED` | No | `false` | Start River only inside `/drain`; production sets this to `true` |

- Worker needs the same database, provider, and BYOK encryption settings as API.
- Health probes, lease behavior, and shutdown are in [Worker operation](GENERATION_WORKER.md#process-configuration).

## Worker wake signal

- Set wake variables for production scale-to-zero operation. Leave `WORKER_WAKE_URL` unset locally.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `WORKER_WAKE_URL` | No | unset | Worker `/drain` URL. Unset disables waking entirely |
| `WORKER_WAKE_QUEUE` | With URL | none | Cloud Tasks queue path that carries the signal |
| `WORKER_WAKE_SERVICE_ACCOUNT` | No | unset | Service account minted into the task's OIDC token |
| `WORKER_WAKE_DEADLINE_SECONDS` | No | `1800` | How long Cloud Tasks holds the drain request open |

- Scheduled maintenance uses the same wake settings to re-wake due work.
- Size worker slots, instance limits, database pools, and provider capacity together. Production requires instance-based billing with CPU throttling disabled.
- See [Generation worker](GENERATION_WORKER.md) for lease and scaling behavior.

## AI and research

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPEN_ROUTER_API_KEY` | Yes for default generation | None | Server OpenRouter authentication; BYOK replaces only generation calls |
| `OPEN_ROUTER_MODEL` | No | `qwen/qwen3.8-27b:free` | Server-owned OpenRouter generation model |
| `OPEN_ROUTER_API_BASE` | No | OpenRouter chat completions endpoint | Chat endpoint override |
| `PROVIDER_VALIDATION_TIMEOUT_MS` | No | `15000` | Total timeout for listing models from a user-connected BYOK provider |
| `EXA_API_KEY` | For web research | None | Exa search authentication |
| `EXA_REQUEST_TIMEOUT_MS` | No | `10000` | Maximum Exa request duration; caller cancellation can stop it earlier |

- OpenRouter funds default generation; valid BYOK selection replaces those calls. Research always uses Exa.
- `OPEN_ROUTER_MODEL` overrides the server default. Free models still have availability and rate limits.

## Authentication and email

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Production email | None | Sends verification and password-reset OTPs |
| `RESEND_FROM_EMAIL` | No | `onboarding@resend.dev` | Sender address on a Resend-verified domain; prefer plain `email@example.com` syntax because some dotenv loaders preserve quotes |
| `EMAIL_DELIVERY_TIMEOUT_MS` | No | `10000` | Maximum wait for Resend to accept an OTP email |
| `GOOGLE_CLIENT_ID` | For Google OAuth | None | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For Google OAuth | None | Google OAuth client secret |
| `GITHUB_CLIENT_ID` | For GitHub OAuth | None | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | For GitHub OAuth | None | GitHub OAuth client secret |

- Development without a Resend key skips delivery and never logs OTPs. Production delivery failures return `503`.
- OAuth callbacks use `${BASE_URL}/auth/callback/google` and `${BASE_URL}/auth/callback/github`.
- Without explicit `BASE_URL`, auth can use `CF_PAGES_URL` or `VERCEL_URL`.
- See [Authentication](AUTH_API.md) for cookie and email behavior.

## Billing

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RAZORPAY_KEY_ID` | Yes | None | Public checkout key |
| `RAZORPAY_KEY_SECRET` | Yes | None | Creates orders and verifies payments |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | None | Verifies signatures against the exact raw Razorpay webhook body |
| `RAZORPAY_REQUEST_TIMEOUT_MS` | No | `15000` | Maximum Razorpay API request duration |

- API startup requires all three Razorpay credentials. Local `.env.example` includes placeholders.

## Card documents and image storage

| Variable | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `PRESENTATION_GCS_BUCKET` | Stored images | No | Private image bucket and migration sweep target; text-only documents need no bucket |
| `STORAGE_EMULATOR_HOST` | Local image storage | No | GCS emulator URL. Devenv and `.env.example` use `http://127.0.0.1:4443`. Leave unset in production so clients use real GCS |
| `CARD_CONVERTER_URL` | Card generation | No | Base URL of the card converter the worker calls; devenv sets `http://127.0.0.1:8090`. Without it the API refuses generation |
| `CARD_CONVERTER_HOST` | No | No | Converter listen address; defaults to `127.0.0.1` so the service stays private |
| `CARD_CONVERTER_PORT` | No | No | Converter listen port; falls back to `PORT`, then `8090` |
| `UNSPLASH_ACCESS_KEY` | Stock photos | Yes | Unsplash key; without it stock routes return `503` and generation uses text layouts. Uploads remain available |
| `UNSPLASH_API_BASE` | No | No | Unsplash API base URL; defaults to `https://api.unsplash.com`. Only for tests and local stubs |

- `UNSPLASH_ENABLED` is a GitHub repository variable, passed to Terraform as `TF_VAR_unsplash_enabled`, default `false`.
- Enable photos by provisioning an enabled `UNSPLASH_ACCESS_KEY:latest`, setting `UNSPLASH_ENABLED=true`, and deploying. Disabled deployments skip the secret lookup and injection.

## Observability

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Empty | Common OTLP endpoint; telemetry export stays disabled while empty |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | No | `http/protobuf` | Only supported export protocol; other values are rejected when export is enabled |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | Empty | Comma-separated OTLP request headers; treat the value as a secret when it contains an API key |
| `OTEL_SERVICE_NAME` | No | `slidesage-api` or `slidesage-worker` | Resource service name on all signals |
| `OTEL_SERVICE_VERSION` | No | Empty | Resource service version |
| `OTEL_RESOURCE_ENVIRONMENT` | No | `ENVIRONMENT`, then `NODE_ENV`, then `development` | Deployment environment label |
| `OTEL_RESOURCE_ATTRIBUTES` | No | Empty | Extra comma-separated OpenTelemetry resource attributes |
| `OTEL_TRACES_EXPORTER` | No | `otlp` | Set to `none` to disable trace export |
| `OTEL_METRICS_EXPORTER` | No | `otlp` | Set to `none` to disable metric export |
| `OTEL_LOGS_EXPORTER` | No | `otlp` | Set to `none` to disable OTLP logs, for example when another integration collects stdout |
| `OTEL_TRACES_SAMPLING_RATIO` | No | `1` | Head-sampling ratio for root spans between 0 and 1 |
| `OTEL_METRIC_EXPORT_INTERVAL` | No | `60000` | Metric export interval in milliseconds |
| `GEN_AI_CAPTURE_CONTENT` | No | `false` | Capture provider prompts/responses on traces; omit values above 256 KiB |

- `OTEL_SDK_DISABLED=true` disables export regardless of endpoint. See [Observability](OBSERVABILITY.md) for signals and Datadog setup.

## BYOK credential encryption

| Variable | Required | Description |
| --- | --- | --- |
| `BYOK_ENCRYPTION_KEY_CURRENT_VERSION` | For BYOK | Active encryption key version, normally `1` initially |
| `BYOK_ENCRYPTION_KEY` | For BYOK | Base64-encoded 32-byte AES-GCM key (active version `1`) |

- API and worker use these keys to encrypt user credentials. They never reach browser bundles.
- Version 1 uses `BYOK_ENCRYPTION_KEY`; higher versions use `BYOK_ENCRYPTION_KEY_V<n>`. The selector is non-secret; every key value is secret. Retain keys while stored credentials reference them.
