# Durable Generation Worker

Presentation generation and iteration run as durable PostgreSQL-backed jobs. The HTTP API accepts and accounts for work, River v0.43 schedules it, `cmd/worker` executes it, and clients consume persisted server-sent events (SSE). Generation does not depend on the lifetime of the request that submitted it.

## Components

| Component               | Responsibility                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `cmd/api`               | Validate authenticated requests, reserve points, create application state, insert River jobs, and stream persisted events                 |
| River v0.43             | PostgreSQL-backed queue, retry scheduling, and worker coordination                                                                        |
| `cmd/worker`            | Fetch generation jobs, call the selected provider, normalize output, settle or refund points, persist the presentation, and append events |
| `generation_jobs`       | User-visible job identity, payload, ownership, lifecycle, progress, cancellation, and error state                                         |
| `generation_job_events` | Ordered, replayable SSE events for each application job                                                                                   |
| `cmd/migrate`           | Apply embedded Goose application migrations followed by River migrations                                                                  |

Migration `00015_add_generation_jobs.sql` creates `generation_jobs` and `generation_job_events`. River maintains its own queue tables. The application job ID is the public identifier; the River job ID is an internal scheduling reference.

## Submission Transaction

`POST /presentation-jobs` performs the durable handoff and returns the job identity as JSON (`202` with `job_id`, `presentation_id`, and `status`). In one PostgreSQL transaction, the API:

1. Locks and validates the idempotent point operation.
2. Reserves SlideSage points and records the ledger entry when the server model is used.
3. Creates the generating presentation placeholder for a new deck, or captures the expected revision for iteration or retry. Every submission, including an iteration, retains its client-supplied job ID through the durable job and point-operation records.
4. Creates the `generation_jobs` row and initial `generation_job_events` rows.
5. Calls River `InsertTx`, storing the River queue record in the same transaction.

The transaction is all-or-nothing. A committed point reservation cannot exist without its application job and River queue record, and an enqueue failure does not leave a placeholder or reserved balance behind. The client chooses the job ID, which doubles as the idempotency key: resubmitting it with the same request attaches to the existing job event stream; reusing it with different input returns `409`. Submission responses expose the job and presentation IDs in the JSON body. If a connection fails before the response arrives, the client polls `GET /generation-jobs/{id}` to discover whether submission committed.

A `preview: true` body runs research synchronously with its own reservation accounting and responds with sources without creating a job.

## Worker Lifecycle

The worker polls River's `generation` queue and processes application jobs with these states:

| Status     | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| `queued`   | Submission committed and is waiting for a worker                     |
| `running`  | A worker has started an attempt                                      |
| `retrying` | A temporary provider or network failure will be retried              |
| `succeeded` | Presentation persistence and point settlement completed              |
| `failed`   | Processing reached a terminal error and the reservation was released |
| `cancelled` | A cancellation request was observed and finalized                    |

River permits up to three attempts for the generation job. Each attempt has a seven-minute timeout for the sequential planning and drafting calls, whose HTTP client timeout is three minutes per call. Provider calls reserve a fixed reasoning allowance on top of the requested output bound for reasoning-capable models, so internal thinking never truncates the structured JSON answer. Within a single attempt, provider requests retry transient failures in process: `429` and `5xx` responses are retried up to four total attempts with exponential backoff starting at two seconds and capped at fifteen seconds, and the provider's `Retry-After` header overrides the computed delay when it is longer. Context cancellation stops the backoff immediately. River rescues jobs left running for eight minutes. On process shutdown the continuously running local worker uses a six-second River soft stop so queue state can finalize within the termination window. A production request-owned worker instead reserves up to eight minutes for its claimed attempt before renewing the HTTP lease. The worker retries network errors, provider `429` responses, provider `5xx` responses, and failures the provider reports inside a stream it has already accepted. That last case carries no HTTP status of its own, so it is marked retryable explicitly; treating it as permanent would finalize a job on its first attempt over a transient upstream stall.

A stream that goes silent for 45 seconds is closed and reported as a retryable provider failure rather than being left to the three-minute request timeout. Drafting is split into calls of at most four slides, reassembled by position, so no single completion has to run long enough to be a likely stall target. The split repeats the system prompt and research sources once per batch, which raises input tokens for research-backed decks; charges stay capped at the quoted amount. Events such as `created`, `theme`, `stage`, `retry`, `plan`, `slide`, `complete`, `saved`, and `error` are stored before the API delivers them. `saved` and `error` are terminal stream events.

Cancellation is transactional. `POST /generation-jobs/{id}/cancel` locks the application job, cancels its River job, releases the active reservation, records the terminal event, and marks the application job cancelled in one transaction. River also cancels the context of an in-flight provider request. The provider may still finish work, but the locked terminal state prevents late success settlement.

## Waking a scaled-to-zero worker

Production has no minimum worker instance. Cloud Run starts an instance from zero only for an inbound HTTP request, and a committed `river_job` row is not something its autoscaler can observe, so the API sends a wake signal after the submission transaction commits. Signalling before the commit would wake a worker that finds an empty queue and hands its instance straight back. An idempotent resubmission sends the wake signal again, which gives a committed job another prompt start after a transient Cloud Tasks failure.

The signal carries no payload. The job is already durable in PostgreSQL, and the woken worker still discovers it by polling. The request only has to exist.

Cloud Tasks carries the signal rather than the API calling the worker directly, for two reasons. It retries if the worker was never reached, and it owns the connection for the life of the drain. That second property is what keeps the instance alive: Cloud Run decides whether an instance is busy by counting requests in flight, not by watching CPU or database work, so an instance whose only activity is a River job reads as idle and becomes a scale-down candidate mid-generation. An API instance cannot hold that connection reliably because it is scaled to zero on the same terms.

`POST /drain` owns the River client on its instance. No production River client starts before a drain request exists, so the instance Cloud Run protects is also the instance that can claim the work. Each request stops claiming jobs after 20 minutes and gives its local attempt up to eight more minutes to finish. If pending work remains, including a retry in River backoff, the handler returns `500` before Cloud Tasks' 30-minute deadline, which keeps the task alive for another attempt. It returns `204` only after the pending queue has stayed empty for a settle window and its local client has stopped. Unexpected request cancellation hard-stops that client's work so River can retry it under another lease.

Same-project Cloud Tasks requests to the default `run.app` URL qualify as internal Cloud Run traffic. The worker keeps internal ingress, grants `roles/run.invoker` only to the runtime service account, and has no `allUsers` binding. The release pipeline asserts both restrictions.

Each submission creates its own task so a burst can scale horizontally up to the configured worker limit. Production uses one River execution slot per request-owned instance. River and application state remain the authority; the task carries no job payload.

## Recovery and cleanup

Generation recovery, expired-reservation recovery, unverified-account cleanup, and rate-limit counter cleanup run as the `slidesage-maintenance` Cloud Run job on a Cloud Scheduler trigger, invoked as `cmd/worker --maintenance`. They previously ran on a ticker inside the worker process, which only worked while an instance was pinned. Scheduling pings frequent enough to replace that ticker would keep an instance alive and undo the saving; a job bills only for the seconds it runs.

The sweep also re-wakes the worker when it finds outstanding queue rows that are runnable now. Future `scheduled` and `retryable` rows do not wake an idle service before their `scheduled_at` time. A wake signal can be lost while the service is paused for a migration, and the sweep is the timer-backed reconciliation path that notices. Cloud Scheduler is paused while `maintenance_mode` is set, so a sweep cannot start a worker against a half-migrated schema.

## Job API

All job endpoints require the authenticated owner of the job.

| Method | Path                           | Description                                                                               |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `GET`  | `/generation-jobs/{id}`        | Return status, stage, progress, timestamps, presentation ID, kind, and any terminal error |
| `GET`  | `/generation-jobs/{id}/events` | Stream persisted events and continue tailing until a terminal event                       |
| `POST` | `/generation-jobs/{id}/cancel` | Request cooperative cancellation of a queued, running, or retrying job                    |

Each SSE record has its `generation_job_events.id` as the SSE `id`. Resume after a disconnect with either `Last-Event-ID: <id>` or `?after=<id>`. When both are present, `Last-Event-ID` takes precedence. Only events with an ID greater than the cursor are returned, so clients can replay missed events without restarting generation.

The event endpoint can be consumed through `fetch` stream parsing. Browser `EventSource` is not suitable when application authentication or custom resume headers require request options unavailable to `EventSource`; the `after` query parameter is available for clients that cannot set `Last-Event-ID`.

When generation continues outside the presentation viewer, the web client shows a thinking-orb indicator below the header. Hovering or focusing it expands the indicator to show the submitted prompt. Selecting it returns to the running presentation.

One API instance accepts at most 40 generation event streams and at most three streams per user by default. Event rows are copied from PostgreSQL and the query is closed before bytes are written to the client, so a slow client does not hold a database connection. The API cancels active streams before graceful server shutdown. Configure the limits with `GENERATION_STREAM_LIMIT` and `GENERATION_STREAM_LIMIT_PER_USER`.

Cancellation returns `202` with `{"status":"cancellation_requested"}` when the request is recorded. It returns `409` when the job is already terminal or is not otherwise cancellable.

In the presentation viewer, a new generation can be cancelled only before its first slide arrives. During that skeleton state, the disabled slide-delete control is replaced with **Cancel generation**. The theme selector remains available in this state; changes apply immediately and persist after generation finishes so they do not conflict with the worker's optimistic persistence. A successful cancellation stops the local event consumer, clears its resumable job record, and returns the user to the generation form.

## Delivery and Accounting Guarantees

River provides durable queueing, but calls to OpenRouter or a BYOK provider are outside the PostgreSQL transaction. External provider execution is at-least-once: if a worker loses ownership or exits after sending a provider request but before recording its result, a later attempt may call the provider again. Providers can therefore observe duplicate execution even though SlideSage's database state is idempotent.

Application accounting remains transactional:

- Submission reserves points, records the reservation ledger entry, creates application state, and inserts the River job atomically.
- Success settles the operation, saves the presentation with its expected revision, releases unused authorization, records terminal events, and completes the River job atomically.
- Failure or cancellation finalizes the operation, returns the active reservation with its ledger entry, records the terminal event, and finalizes the queue state atomically.
- The operation status prevents a reservation from being settled or refunded more than once. Recording the failed presentation does not depend on that refund happening, so a reservation already released elsewhere still leaves a deck the user can retry.
- A failed deck stores the settings it was submitted with, template included, under `failure.retry`. The error page reads them back to repopulate the generate page. If the presentation's revision has moved past the one the job expected, the failure is recorded in place against a still-generating deck instead of replacing the document, so the deck never stays stranded in `generating` without retry settings.
- BYOK generation reserves zero SlideSage model points, while the durable job and event behavior remains the same.

These guarantees cover SlideSage balances and persisted state. They cannot make an external provider request transactional or prevent a provider from billing a duplicate attempt.

## Process Configuration

The worker reads the same `DATABASE_URL`, provider, and BYOK encryption settings as the API, plus worker-specific controls:

| Variable               | Default | Purpose                                                                                                            |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `WORKER_CONCURRENCY`   | `2`     | Maximum concurrent River jobs in one worker process                                                                |
| `WORKER_DATABASE_POOL_MAX` | `WORKER_CONCURRENCY + 3` | Maximum open and idle worker database connections                                                                  |
| `WORKER_DRAIN_TIMEOUT` | `8`     | Seconds allowed for graceful River shutdown after `SIGINT` or `SIGTERM`; kept below Cloud Run's termination window |
| `WORKER_HEALTH_PORT`   | `8080`  | Port for worker health probes                                                                                      |
| `WORKER_REQUEST_LEASED` | `false` | Start River only while a `/drain` request is active                                                                |
| `WORKER_DRAIN_ACCEPT_SECONDS` | `1200` | Stop fetching new jobs before the Cloud Tasks deadline                                                         |
| `WORKER_DRAIN_HANDOFF_SECONDS` | `480` | Let locally claimed work finish before requesting another task attempt                                          |

`GET /live` returns `204` while the health server is running. `GET /ready` returns `204` only while the worker accepts work and PostgreSQL responds to a one-second ping. It returns `503` as soon as shutdown starts.

The scheduled maintenance job runs recovery and cleanup every 15 minutes. It processes at most 100 terminated jobs and 100 affected users per sweep, with at most two recovery transactions running concurrently, deletes bounded batches of expired rate-limit counters and unverified accounts, and wakes due queue work that lost its original signal.

The API discovers model catalogs for independent BYOK connections concurrently, with at most three catalog requests per configuration response and one active catalog request per provider in each API process.

## Deployment

Production uses Cloud Run services for the API and generation worker. Terraform configures instance-based billing (`cpu_idle = false`) and no minimum worker instance. The API commits work to PostgreSQL and then creates an authenticated Cloud Task whose request owns the worker's River client.

Cloud Run does not scale on PostgreSQL queue depth. Cloud Tasks request count drives instance creation, while River still owns durable scheduling and exclusive claims. Production uses one River worker per request-owned instance; size the database pool, task concurrency, and provider limits together.

`apps/api/Dockerfile` exposes three targets from the same source.

| Target    | Entrypoint     | Use                   |
| --------- | -------------- | --------------------- |
| `api`     | `/app/api`     | Cloud Run API service |
| `worker`  | `/app/worker`  | Cloud Run service |
| `migrate` | `/app/migrate` | One-off migration job |

Run the `migrate` target successfully before starting or updating either runtime. `cmd/migrate` applies embedded Goose migrations first and River migrations second. It also recognizes the legacy Go API schema and baselines migrations 1-13 before applying migration 14. Migration 14 is an intentional pre-launch accounting reset that removes existing user-owned data, so do not run it against a database containing data that must be retained. Migration 25 is a second intentional deletion: it removes every presentation without a committed PPTX revision, which discards semantic-pipeline decks and any generation that is still in flight when it runs. Migration 26 is a third: it drops the semantic memory and outline cache tables, whose embeddings have had no producer or consumer since the canonical pipeline replaced that path and cannot be rebuilt. The required deployment order is therefore:

```text
PostgreSQL ready -> migrate succeeds -> API and worker start
```

Do not rely on API or worker startup to apply schema changes.

## Local Development

Devenv runs PostgreSQL, migrations, the API, the worker, and the web application. The API and worker both wait for the migration task, and the web process waits for both runtimes to become ready. The worker readiness probe uses `http://localhost:8080/ready`.

See [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) for commands and [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for complete configuration.
