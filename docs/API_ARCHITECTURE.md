# Architecture

## Workspace

| Path | Responsibility |
| --- | --- |
| `apps/api` | Go HTTP API, River worker, migrations, repositories, and integrations |
| `apps/web` | React application and Vite build |
| `apps/converter` | Private Bun card validation and PPTX export service |
| `libs/cards` | Card schema, layouts, themes, and draft conversion |
| `libs/types` | Shared API contracts |
| `libs/ui` | React components, card renderer, hooks, and client helpers |

- The API owns authentication, submissions, event delivery, presentations, billing, BYOK connections, rate limits, and persistence.
- The worker executes queued provider calls. The converter validates card content and writes PPTX exports.

## Runtime

- `cmd/migrate` applies embedded Goose migrations, River migrations, and the retired-object sweep before runtimes start.
- `cmd/api` serves the application routes listed in [API reference](API_OVERVIEW.md).
- `cmd/worker` consumes River jobs and exposes `/live`, `/ready`, and authenticated `/drain`.
- API and worker use `database/sql` with PostgreSQL.
- Local service ordering and commands are in [Development setup](DEVELOPMENT_SETUP.md).

## Generation

1. The submission transaction reserves points, creates presentation and job state, persists initial events, and inserts the River job with `InsertTx`.
2. The worker resolves OpenRouter or an encrypted BYOK selection, plans and drafts cards, and calls the converter.
3. Success commits the document and settles points together. Failure or cancellation refunds the active reservation transactionally.
4. The API streams persisted events. Disconnecting does not stop generation.

- River retries can repeat external provider calls; SlideSage settles or refunds each reservation once.
- Reviewed Exa sources travel with generation and remain with the deck for attribution.
- Queue operation, replay, limits, and recovery are in [Generation worker](GENERATION_WORKER.md).

## Authentication

- `internal/auth` owns email/password accounts, verification and reset OTPs, Google and GitHub OAuth, JWT cookies, and profile security changes.
- See [Authentication](AUTH_API.md) for tokens, routes, and browser behavior.

## Presentation documents

- `internal/carddocument` stores immutable card revisions in PostgreSQL JSONB and image bytes in GCS.
- The browser renders the saved card revision; the converter derives an editable PPTX from it.
- See [Card documents](CARD_DOCUMENTS.md) for the schema, editing, sharing, and export limits.

## Persistence

- Domain repositories own SQL. Handlers validate HTTP input and translate service results.
- `generation_point_operations` tracks reservations. Transactions and expected revisions protect settlement, refunds, and concurrent writes.
- `generation_jobs` and `generation_job_events` own public status and replay; River's queue tables handle scheduling.
- SSE handlers close database queries before writing to clients. Stream limits bound polling and handler load.
- Scheduled maintenance handles recovery, expired counters, and unverified accounts.
- Optional Valkey caches list summaries and immutable bodies while PostgreSQL retains authorization and invalidation. See [Database cache](DATABASE_CACHE.md).

## Deployment

- Build API, worker, migration, and converter images from the same commit.
- Cloud Run runs a converter sidecar beside each Go service.
- Authenticated Cloud Tasks requests own production River clients so active work has an HTTP lease while the worker scales from zero.
- Run migrations before updating runtimes. See [CI/CD](CI_CD.md) for the release sequence.
