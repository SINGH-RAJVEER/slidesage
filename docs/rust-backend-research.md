# Rust backend research

Reviewed 2026-10-15. This is a design exploration based on repository code and primary documentation. No Rust backend, migration, benchmark or production deployment was run.

Implementation update, 2026-10-16: health/CORS, password/JWT, converter health and SQLx-backed feedback now exist under `apps/backend-rust`. Feedback includes PostgreSQL rate limiting and tests against the original Go behavior. The research below describes the full target; implementation state and verification commands are in the [port plan](RUST_BACKEND_PORT.md#implementation-status) and [development setup](DEVELOPMENT_SETUP.md#rust-port-development). There are still no comparative performance results or production Rust deployment.

## Agreed delivery model

Port the entire API to Axum + Tokio + SQLx as one replacement. Use current endpoint tests and their existing expectations as the compatibility baseline, adapt their transport to run against either implementation, and iterate in isolation until the complete required suite passes at 100%. Production stays on Go until the full cutover. Rust's clearest gains are checked SQL, explicit domain types and shared HTTP middleware; speed and cost benefits need measurements.

The agreed scope also replaces the Bun converter with a Rust conversion worker in that same release. Its tests and relevant `libs/cards` cases join the required compatibility suite. Preserve the existing SQL migrations unchanged.

A Rust worker is feasible for the complete replacement. River has a native Rust client, so changing languages does not require changing queues. Compatibility with this checkout's pinned Go client still needs isolated validation. [River Rust](https://docs.rs/riverqueue/latest/riverqueue/)

## What exists today

| Area | Repository evidence | Consequence for a port |
| --- | --- | --- |
| HTTP and database | [Go dependencies](../apps/api/go.mod), [API startup](../apps/api/cmd/api/main.go) | The starting point is Go HTTP + pgx through existing database plumbing, not an untyped JavaScript backend. |
| Generation | [Queue setup](../apps/api/internal/generation/jobs.go), [billing transaction](../apps/api/internal/generation/billing.go) | Point reservation, domain job creation and River insertion share a transaction. Preserve that boundary. |
| Authentication | [JWT](../apps/api/internal/auth/jwt.go), [password hashing](../apps/api/internal/auth/password.go), [OAuth](../apps/api/internal/auth/oauth.go) | Preserve HS256 JWTs, the existing cookie and custom scrypt representation across cutover. |
| Presentation storage | [Legacy purge](../apps/api/migrations/00035_purge_legacy.sql), [asset cleanup](../apps/api/migrations/00039_card_asset_deletions.sql) | Card documents live in PostgreSQL; asset deletion is coupled to database triggers. |
| Operations | [Compose](../infra/compose.json), [runtime image](../apps/api/Dockerfile), [maintenance timer](../infra/slidesage-maintenance.timer) | Current deployment definitions use separate API, worker, migration and converter processes. These files describe intended runtime; this research did not inspect the live VPS. |

## What Rust adds, and what it costs

| Candidate | Established capability | Proposed SlideSage use and limitation |
| --- | --- | --- |
| Axum, Tokio, Tower | Axum provides extractors, routing and typed responses over Tokio, with Tower middleware. [Axum](https://docs.rs/axum/latest/axum/), [middleware](https://docs.rs/axum/latest/axum/middleware/index.html) | Centralize authentication, request limits, CORS, timeouts and errors. Matching current JSON and streaming behavior still requires contract checks. |
| SQLx | `query!` checks literal SQL, bind types and returned columns against schema metadata. Dynamic SQL does not get the same checking; nullability inference can need overrides. [Query macro](https://docs.rs/sqlx/latest/sqlx/macro.query.html) | Catch a renamed column or wrong bind type before release. It does not prove ownership checks, transaction correctness or query speed. |
| Rust domain types | Ownership checks memory lifetime without a tracing garbage collector. [Rust book](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html) | Use enums for job states and validated constructors for point amounts. Go already has memory safety and types; Rust's stronger compiler checks add learning and compilation costs. |
| Reqwest | Async HTTP, JSON and streaming are available. [Reqwest](https://docs.rs/reqwest/latest/reqwest/) | Port provider adapters against their current protocols, including cancellation and partial streams. A new LLM abstraction library is optional. |
| tracing and OpenTelemetry | `tracing-opentelemetry` exports tracing spans through OpenTelemetry; Tower HTTP can instrument requests. [Tracing bridge](https://docs.rs/tracing-opentelemetry/latest/tracing_opentelemetry/), [HTTP tracing](https://docs.rs/tower-http/latest/tower_http/trace/index.html) | Keep existing trace headers and job correlation. Request metrics and log export need separate configuration; one tracing layer does not replace all existing observability. |

## SQLx builds and existing migrations

Use SQLx for queries while Goose remains the only application-schema migrator. Existing scripts contain both `+goose Up` and `+goose Down` sections, plus PL/pgSQL statement markers. SQLx uses separate reversible files and its own history. Passing the original Goose files to another runner could execute both directions. A runner change requires explicit conversion and a tested baseline, not renaming the folder. [Goose format](https://github.com/pressly/goose#sql-migrations), [SQLx migration format](https://github.com/launchbadge/sqlx/blob/main/sqlx-cli/README.md)

Proposed CI flow:

1. Start disposable PostgreSQL and apply the existing Goose application migrations and River migrations.
2. Run `cargo sqlx prepare --workspace -- --all-targets --all-features` and commit `.sqlx` metadata after query changes.
3. In CI, regenerate/check against the migrated database with `cargo sqlx prepare --check --workspace -- --all-targets --all-features`.
4. Build with `SQLX_OFFLINE=true` using the committed metadata. Offline builds alone cannot detect drift in the deployed database. [SQLx CLI](https://github.com/launchbadge/sqlx/blob/main/sqlx-cli/README.md)

Pin the Rust toolchain, crate versions and matching SQLx CLI before implementation. At review time the River Rust docs show `riverqueue` 0.3.0, SQLx 0.9 and minimum Rust 1.95. These are observed upstream versions, not a validated dependency set for SlideSage. [River dependencies](https://docs.rs/riverqueue/latest/riverqueue/)

## Durable jobs are the main compatibility decision

The Rust replacement must own the entire reservation + domain job + enqueue transaction. Retain the current kind `presentation_generation_v1` and its `job_id`, `traceparent` and `tracestate` payload. Validate the existing persisted jobs in an isolated replacement environment. There is no production bridge or partial generation rollout. [Current implementation](../apps/api/internal/generation/jobs.go)

| Queue option | Evidence | Selection risk |
| --- | --- | --- |
| Native River Rust | Shares the Go schema/protocol; supports SQLx transactions and workers. [River Rust](https://docs.rs/riverqueue/latest/riverqueue/) | Best first candidate. Validate Go 0.43.0 compatibility, domain refunds, cancellation, recovery and graceful shutdown before adoption. |
| Apalis with PostgreSQL | Provides PostgreSQL storage, retries, scheduling and Tower integration. [Apalis](https://github.com/apalis-dev/apalis) | A queue replacement requires new job mapping, migration, draining and recovery rules. It adds more scope than a language port alone. |
| PGMQ | PostgreSQL queue with visibility timeouts and archive/delete operations. Undeleted messages become visible again. [PGMQ](https://github.com/pgmq/pgmq#visibility-timeout-vt) | SlideSage must still implement its job state transitions, retries and billing reconciliation. A visibility timeout does not make provider calls execute exactly once. |

River clients fetch by queue. Unknown kinds can consume retries; a leader can discard stuck jobs whose kinds it does not know. The complete Rust worker must register the required kinds and recover existing jobs correctly. River also documents different period-based uniqueness before Go 0.48. SlideSage does not configure that option, but schema/protocol compatibility with its Go 0.43 pin still needs verification. [Compatibility guide](https://docs.rs/riverqueue/latest/riverqueue/guide/mixed_deployments/index.html)

Regardless of queue choice, retries must not charge twice or apply a revision twice. Provider requests can succeed before a worker crashes, so idempotency and refund reconciliation remain application responsibilities. [Reliable River workers](https://riverqueue.com/docs/reliable-workers)

## Authentication, storage and runtime boundaries

`jsonwebtoken` can sign and validate the existing HS256 claims. `oauth2` supports authorization-code exchanges, state and PKCE. Preserve the current cookie attributes, token validation, callback rules and account linking; fixture-check tokens in both directions. `tower-sessions` is available if a later product decision calls for stored sessions, but adding it now would change the current JWT model. [JWT](https://docs.rs/jsonwebtoken/latest/jsonwebtoken/), [OAuth2](https://docs.rs/oauth2/latest/oauth2/), [sessions](https://docs.rs/tower-sessions/latest/tower_sessions/)

The password format is hex salt + colon + hex scrypt output, with NFKC normalization, N=16384, r=16, p=1 and 64 output bytes. The salt passed to scrypt is the hex text itself. BYOK keys use an existing AES-GCM envelope. Verify byte-level compatibility rather than replacing either format during the port. [Passwords](../apps/api/internal/auth/password.go), [BYOK encryption](../apps/api/internal/integrations/ai/credentials.go)

Replace the Bun converter with a dedicated Rust worker serving the same private request/reply contract. Share Rust card validation/assembly with the backend and run heavy PPTX layout/packaging under bounded concurrency in the conversion worker. Keep public API responses synchronous; durable generation remains on River. This design does not require export-job tables or a database migration. Bound blocking work separately from async requests; Tokio's started blocking tasks cannot generally be aborted, so drain and resource limits need attention. [Tokio blocking tasks](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)

The current converter has 1,649 implementation lines and 558 test lines; `libs/cards` has 3,221 implementation lines and 844 test lines. Relevant schema, conversion, layout, theme and template rules must match the browser after the Rust port. Browser TypeScript remains. [Current converter](../apps/converter/src/handler.ts), [card conversion](../libs/cards/src/convert.ts), [validation](../libs/cards/src/validate.ts).

PptxGenJS is an external JavaScript dependency, not included in those line counts. Replacing it needs a native Rust writer that creates valid PresentationML package parts and relationships, including editable slide objects. No Rust PPTX package has been selected or validated. Use the current export assertions as requirements, compare package contents semantically and visually inspect representative outputs. Treat matching layout, charts and text fitting as acceptance work. [Current writer](../apps/converter/src/pptx.ts), [export tests](../apps/converter/src/pptx.test.ts), [PresentationML structure](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document).

Reuse Compose limits, health checks, local object-volume permissions, backups and migration ordering. The Go backend already ships scratch images with certificates. A small Rust image is therefore not a new architectural capability; validate the chosen target and TLS dependencies before promising a static binary. [Current image](../apps/api/Dockerfile), [deployment](../infra/compose.json)

Vector search is outside this port. Migration 00035 removes the retired tables and attempts to drop the vector extension, retaining it only when ownership or dependencies prevent removal. `pgvector-rust` supports SQLx if a new retrieval feature is later approved; its crate compatibility would need checking then. [Purge](../apps/api/migrations/00035_purge_legacy.sql), [pgvector Rust](https://github.com/pgvector/pgvector-rust#sqlx)

## Evidence needed before a rewrite decision

Compare the same authenticated read workload, database contents, connection limits and deployment resources in Go and Rust. Record correctness, p50/p95/p99 latency, throughput, CPU, peak RSS, cold build time and cached build time. Use mocked providers for repeatable worker tests and separate real-provider runs for end-to-end generation. No performance result exists in this research.

Current tests frequently call Go handlers or internal services directly; converter tests also import TypeScript functions. Adapt their execution while preserving inputs and assertions. Freeze a required-case manifest covering API endpoints, conversion rules and editable PPTX output. Count skipped, blocked and missing cases as incomplete. Run each implementation with independent matching fixtures. Only the complete passing suite, credential/job compatibility and release recovery checks permit cutover. [Middleware tests](../apps/api/cmd/api/main_test.go), [document endpoint tests](../apps/api/internal/carddocument/save_test.go), [converter tests](../apps/converter/src/handler.test.ts), [export tests](../apps/converter/src/pptx.test.ts).
