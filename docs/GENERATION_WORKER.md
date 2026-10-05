# Durable generation worker

- PostgreSQL stores generation and AI revision jobs. River schedules work; `cmd/worker` executes it.
- Submission and event-stream lifetimes do not control job execution.

## Components

| Component | Responsibility |
| --- | --- |
| `cmd/api` | Validate, reserve points, create jobs, stream events |
| River | Queue claims and retry scheduling |
| `cmd/worker` | Provider calls, card conversion, document persistence, settlement/refunds |
| `generation_jobs` | Public identity, payload, ownership, lifecycle, cancellation, errors |
| `generation_job_events` | Ordered replayable events |
| `cmd/migrate` | Goose and River migrations, retired-object sweep |

- Migration 15 creates application jobs and events. River owns separate queue tables.
- Public IDs are application job IDs; River IDs are internal.

## Submission transaction

`POST /presentation-jobs` returns `202` with `job_id`, `presentation_id`, and `status`. One transaction:

1. Locks the idempotent point operation and reserves points for server-funded generation.
2. Creates a generating placeholder, or captures the expected revision for an AI revision or retry.
3. Writes the application job and initial events.
4. Inserts the River job with `InsertTx`.

- Enqueue failure leaves no placeholder or reservation.
- The client job ID also identifies the point operation. Repeating it with matching input returns the existing job; changed input returns `409`.
- After a lost response, poll `GET /generation-jobs/{id}` to discover whether submission committed.
- `preview: true` runs research synchronously with separate accounting and creates no generation job.

## Worker lifecycle

| Status | Meaning |
| --- | --- |
| `queued` | Awaiting a worker |
| `running` | Attempt in progress |
| `retrying` | Waiting after a temporary failure |
| `succeeded` | Document saved and points settled |
| `failed` | Terminal failure and reservation released |
| `cancelled` | Cancellation finalized |

- River permits three attempts, each with a seven-minute timeout. Provider HTTP calls have a three-minute timeout; River rescues jobs running for eight minutes.
- Provider requests retry transient failures up to four total attempts, with backoff from two to fifteen seconds. A longer `Retry-After` takes precedence; cancellation stops waiting.
- Network errors, `429`, `5xx`, and provider errors inside an accepted stream are retryable. Credit/quota failures are terminal.
- A stream silent for 45 seconds is closed as retryable.
- Reasoning-capable models receive a 1,024-token allowance above the answer bound. Google uses `thinkingBudget`, Anthropic uses `thinking`, OpenAI reasoning models use `max_completion_tokens`, and OpenRouter uses `reasoning.max_tokens`.
- Inline `<think>` blocks are removed before parsing. Empty answers return a specific provider error.
- Planning precedes batches of four cards. Conversion reports valid cards as they arrive and repairs invalid cards after the batch. See [Card generation](CARD_DOCUMENTS.md#generation).
- Reservations cover planning, card output bounds, repeated prompt context, and repair headroom.
- Persist events before delivery. `saved` and `error` terminate streams.
- Cancellation locks the application job, cancels River work, releases its reservation, and records terminal state in one transaction. Late provider results cannot settle a cancelled job.
- Local shutdown uses a six-second River soft stop. Production leases allow up to eight minutes for claimed work before handoff.

## Waking a scaled-to-zero worker

- After submission commits, the API creates an authenticated Cloud Task to call worker `POST /drain`. Idempotent resubmission sends another wake signal.
- Tasks carry no generation payload; the worker claims durable PostgreSQL jobs.
- The inbound request keeps the instance active. With request leasing, River starts only inside `/drain`, so the protected instance claims the work.
- Each drain stops claiming after 20 minutes and allows eight more minutes for its active attempt.
- Pending work, including delayed retries, returns `500` before the 30-minute task deadline so Cloud Tasks retries. An empty queue returns `204` after its settle window and client shutdown.
- Unexpected request cancellation hard-stops local work for River recovery.
- Each submission creates a task. Production uses one River execution slot per request-owned instance.
- Worker ingress is internal, with invocation granted only to the runtime service account. Same-project tasks call its default `run.app` URL.

## Recovery and cleanup

- `slidesage-maintenance` runs `cmd/worker --maintenance` every 15 minutes through Cloud Scheduler.
- It recovers terminated generation jobs and expired reservations, removes expired rate-limit rows and unverified accounts, and re-wakes due queue work.
- Future scheduled/retryable rows do not wake the worker before `scheduled_at`.
- Each sweep handles at most 100 terminated jobs and 100 affected users, with two concurrent recovery transactions and bounded cleanup batches.
- `maintenance_mode` pauses the scheduler during migrations.

## Job API

All endpoints require the job owner:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/generation-jobs/{id}` | Status, stage, progress, timestamps, presentation ID, kind, terminal error |
| `GET` | `/generation-jobs/{id}/events` | Replay and tail persisted SSE events |
| `POST` | `/generation-jobs/{id}/cancel` | Cancel queued, running, or retrying work |

- Each SSE `id` is a `generation_job_events.id`. Resume with `Last-Event-ID` or `?after=<id>`; the header takes precedence.
- Replay returns events strictly after the cursor and ends at `saved` or `error`.
- Use fetch stream parsing when authentication or headers need custom request options.
- Default stream limits are 40 per API process and three per user. Queries close before client writes, and shutdown cancels streams.
- Cancellation returns `202` with `{"status":"cancellation_requested"}`; terminal or non-cancellable jobs return `409`.
- The browser indicator opens the running deck, where progress and drafted cards appear before the saved revision loads.

## Delivery and accounting guarantees

- External calls are at-least-once. An interrupted attempt can repeat provider work and provider charges.
- Submission atomically reserves points and inserts application and queue state.
- Success atomically saves against the expected revision, settles usage, releases unused authorization, and records terminal state.
- Failure or cancellation refunds the active reservation once. An already-refunded operation still records a failed deck for retry.
- Failed decks retain request settings under `failure.retry`. Revision conflicts cannot leave a deck stranded in `generating` or overwrite newer content.
- BYOK generation reserves zero model points. Research is charged separately.
- Point accounting cannot make external provider calls transactional.

## Process configuration

- API and worker need matching database, provider, and BYOK encryption settings.
- Worker concurrency, pools, lease timing, and wake variables are listed in [Environment variables](ENVIRONMENT_VARIABLES.md#generation-worker).
- `/live` returns `204` while the health server runs. `/ready` returns `204` while accepting work with PostgreSQL reachable, and `503` during shutdown.
- Size the instance limit, River slots, database pools, task dispatch concurrency, and provider limits together.

## Deployment

- API and worker are Cloud Run services; converter sidecars share their network namespace.
- Worker uses instance-based billing with `cpu_idle=false`, no minimum instance, and request-owned River clients.
- Cloud Tasks request count drives scaling; PostgreSQL queue depth does not.
- Run the migration image before updating runtimes. API and worker startup never applies migrations.
- Follow [Migration cutover](CI_CD.md#migration-cutover) for verified backups, service pauses, irreversible migrations, and recovery.

## Local development

- Devenv starts dependencies, migrations, converter, API, worker, and web in order.
- Local worker runs continuously; leave `WORKER_WAKE_URL` unset.
- Commands and readiness checks are in [Development setup](DEVELOPMENT_SETUP.md).
