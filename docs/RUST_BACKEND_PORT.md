# Rust backend exploration

Updated 16 October 2026. Reference implementation at `f922c831`; development is isolated in JJ workspace `rust-backend`. [Primary-source research](rust-backend-research.md).

## Implementation status

The Rust files are in [apps/backend-rust](../apps/backend-rust/Cargo.toml). The standalone API implements health, not-found errors and CORS/origin rules. With a database configured it also serves password sign-in, session/profile reads, sign-out, feedback, billing balance, presentation listing, detail and deletion. Optional Valkey list caching and converter health/schema/templates are implemented. Neither binary is wired into application startup or deployment.

The tests reuse Go password/JWT cases and run the existing Go CORS and feedback assertions against a live Axum server. Feedback adapters check actual database rows; PostgreSQL integration tests cover validation, cookies, bearer precedence, insertion failures and the 10-per-hour limit. Go/Rust rate-counter checks verify the same hashing/window behavior. Committed `.sqlx` metadata supports offline builds; `cargo sqlx prepare --check` validates it against a database migrated with the unchanged Goose/River runner. [Development commands](DEVELOPMENT_SETUP.md#rust-port-development).

Balance has 16 request cases that run against both the original Go handler and live Rust API. They cover fractional/maximum balances, user isolation, bearer/cookie authentication, missing users, HEAD, unsupported methods and unchanged stored balances. Rust also checks database-failure responses. Payment checkout, verification and webhooks remain pending.

`GET /auth/get-session`, `GET /profile` and `POST /auth/sign-out` now match Go in comparison cases run in each cookie configuration. They look up the current user, preserve passwordless/legacy credential behavior, and use normal HTTP or Secure/SameSite=None cookies as configured. Session lookup preserves Go's reported expiry of lookup-time + seven days; that is separately validated before comparing responses. Sign-out clears the cookie and leaves bearer tokens valid, matching the reference. Rust tests cover closed-database behavior too.

`POST /auth/sign-in/email` checks existing NFKC/scrypt credentials with at most two concurrent blocking derivations. Go/Rust comparisons cover successful and rejected credentials, unverified accounts, normalization, JSON/body limits, duplicate fields, JWT claims, remembered/session cookies and the persisted IP/email rate limits. Both cookie configurations run. Signup, OTP/OAuth, sign-in options and profile mutations remain pending.

Presentation routes include `GET /presentations`, `GET /presentations/{id}` and `DELETE /presentations/{id}`. Go/Rust comparisons use the same disposable PostgreSQL fixtures and the reference Go cache fixture. They cover pagination and URL query decoding, list order, ownership, committed writes/rollback, legacy summaries, exact timestamps, JSON escaping and large JSONB numbers. Deletion checks reserved generation operations, foreign-key failures, asset/share cascades, the durable cleanup queue and transactional cache-version triggers. No migration changed.

The optional native Valkey client shares Go's hashed keys and cached summary format. A database version lookup remains mandatory on every list request; hits skip the presentation/count queries. Tests exchange entries between Go and Rust while table reads are blocked, check 30-second expiry, and cover invalidation, rollback, late fills, ownership/account deletion and corruption. Outages fall back to PostgreSQL with bounded operations and a five-second bypass. A separate live check verified password authentication over TLS with a custom CA. Card-body caching and cache telemetry remain pending. [Cache details](DATABASE_CACHE.md#isolated-rust-port).

The conversion worker serves `GET /v1/schema` and `POST /v1/templates` from embedded JSON, without invoking Bun or reading runtime files. Existing handler assertions target either implementation through `CONVERTER_UNDER_TEST_URL`. They compare the complete drafting schema and all six curated template documents/assets against the current TypeScript catalog, plus lookup, JSON/body-limit and version-header behavior. Wire-level cases compare against a real Bun HTTP server for header encoding, duplicate headers and path normalization. The full handler suite has ten passing Rust cases and eight failures on pending document/card routes. Document validation, conversion and PPTX writing still need Rust implementations. Unported failures remain required.

The [route inventory](../apps/backend-rust/compatibility/routes.json) records 54 explicit API routes and eight converter routes. Ten API routes and three converter routes are marked ported: 13/62, or 21.0% by route count. This is not a complete behavioral case manifest, effort estimate or compatibility percentage. Other auth/profile/application routes, durable generation, card conversion and PPTX writing remain pending. Additional shared middleware and production configuration still need their own compatibility checks.

`bun apps/backend-rust/compatibility/run.ts` creates disposable PostgreSQL/Valkey services, applies the unchanged migrations and runs native tests, live Go comparisons and implemented converter assertions. Logs and a scoped result file remain available after service cleanup. The result always keeps `release_ready: false`; `--converter-full` exposes the remaining converter handler failures. [Runner requirements and commands](DEVELOPMENT_SETUP.md#rust-port-development).

## Agreed approach

Port the complete API to Axum as one replacement. Keep the current Go backend as the reference implementation while developing Rust in isolation. Use the existing endpoint tests as the compatibility baseline, adapt their execution to target either server, and fix Axum until the full required compatibility suite reaches 100%. Switch the API only after that gate passes. There is no partial route rollout or hybrid Go/Rust API deployment.

The same release also replaces the Bun converter with a dedicated Rust conversion worker. API, generation worker and conversion worker must all pass their compatibility cases before the single cutover. Existing SQL migrations and database history remain unchanged; changing backend languages does not require a schema change.

Rust offers useful query checking and stronger domain types. Faster generation and lower VPS costs need measurements. Go already provides memory safety and a mature concurrent runtime, so those alone do not justify a rewrite.

River now has a native Rust implementation. Its maintainers announced shared schemas and cross-language workers on 9 October 2026. This gives us a credible route to the Rust worker without replacing the queue, but compatibility with this checkout's Go River `v0.43.0` remains untested. Validate existing schema and stored jobs before the complete replacement. [River announcement](https://riverqueue.com/blog/polyglot-queue), [Rust River docs](https://docs.rs/riverqueue/latest/riverqueue/).

## What we would port

| Current responsibility | Proposed Rust replacement | Boundary |
| --- | --- | --- |
| Go HTTP routes and middleware | Axum, Tokio, Tower, tower-http | Preserve paths, status codes, JSON, cookies, CORS and limits |
| `database/sql` with pgx | SQLx `PgPool`, transactions and query macros | Same PostgreSQL schema and authorization predicates |
| Generation submission, accounting and River worker | Native `riverqueue` Rust in the complete backend | Same job kind, payload, locks, retries, cancellation and settlement |
| Goose application migrations | Retain the existing schema/history and migration tooling | One application migration owner per release |
| Provider integrations | reqwest, Serde and bounded Tokio tasks | Preserve streaming, usage accounting, timeouts and BYOK |
| JWT, OAuth, passwords and encryption | jsonwebtoken, oauth2, RustCrypto scrypt/aes-gcm | Match current bytes and behavior before changing formats |
| Traces, metrics and logs | tracing, tracing-subscriber, tracing-opentelemetry, OpenTelemetry | Preserve service names, trace propagation and redaction |
| Optional Valkey cache | redis crate | Keep PostgreSQL authorization and invalidation authoritative |
| Image files | Tokio file I/O with the existing objects volume | Preserve content hashes, paths and deletion retries |
| API contract documentation | utoipa-generated OpenAPI | Compare with existing `libs/types`; generate client types only after parity |
| Card validation, assembly and templates | Shared Rust card module, exposed by the conversion worker | Match the browser's existing card schema and converter responses |
| Editable PPTX export | Dedicated Rust conversion worker with a native PPTX writer | Replace PptxGenJS while preserving editable objects and layout |

Axum uses Tower middleware and supports SSE. SQLx checks literal queries through `query!` and `query_as!`; dynamic `query()` calls do not get that compile-time check. Use checked macros for stable repository queries. [Axum](https://docs.rs/axum/latest/axum/), [SQLx query macros](https://docs.rs/sqlx/latest/sqlx/macro.query.html).

The target runtime removes Go application processes and the Bun converter service. React and its TypeScript card renderer remain; Bun can still build/test the frontend. Utoipa can generate OpenAPI from Rust handlers and data types; it does not verify existing behavior. [Utoipa](https://docs.rs/utoipa/latest/utoipa/).

## Where Rust helps

- A renamed database column or incompatible result type can fail CI through SQLx macros. Commit `.sqlx` metadata and run `cargo sqlx prepare --check` against an ephemeral database migrated to the expected schema. Offline builds alone cannot detect stale schema metadata. [SQLx CLI](https://github.com/transact-rs/sqlx/blob/main/sqlx-cli/README.md).
- Separate `UserId`, `JobId`, `PresentationId` and point-value types make accidental mixing harder. Enums and exhaustive matching make lifecycle changes visible to the compiler. These are proposed design choices, not automatic guarantees about transactions. [Rust enums](https://doc.rust-lang.org/book/ch06-00-enums.html).
- Tokio tasks, bounded channels and semaphores can express provider and stream limits. Rust has no tracing garbage collector, but that does not promise lower RSS or faster responses. CPU-heavy password derivation needs a bounded `spawn_blocking` path. [Rust ownership](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html), [Tokio blocking work](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html).

The cost is rewriting working behavior, learning async ownership, longer builds, and maintaining two implementations during rollout. SQLx cannot prove business correctness or protect a query that omits an ownership check.

## Proposed structure

Start with one Cargo package under `apps/backend-rust`, with API, generation-worker and conversion-worker binaries. Share card logic inside the package.

```text
apps/backend-rust/
	Cargo.toml
	src/bin/api.rs
	src/bin/worker.rs
	src/bin/conversion_worker.rs
	src/http/          routes, auth extraction, errors, SSE
	src/domain/        IDs, lifecycle, points, service rules
	src/postgres/      SQLx repositories and transactions
	src/jobs/          River adapters and worker execution
	src/cards/         schema, validation, assembly, templates, themes
	src/pptx/          editable slide layout and native PPTX writing
	src/conversion/    private worker routes and bounded execution
	src/integrations/  providers, billing, mail, worker client, Valkey
	src/telemetry.rs
	.sqlx/             checked query metadata
```

Handlers validate requests, services own transaction boundaries, repositories accept the caller's transaction, and integrations perform external I/O. Do not keep a database transaction or checked-out connection open while waiting for AI output or a slow SSE client.

## Converter port as a Rust worker

Replace the converter's private HTTP service with a Rust worker process that accepts the same requests and returns the same kinds of results. The API and generation worker call it for validation, conversion and export. Keep the public export endpoint synchronous: callers still receive PPTX bytes, not a new job ID. This worker uses bounded request/reply execution; durable generation continues to use River. No additional export queue or application tables are required.

- Port draft conversion, document validation/assembly, template lookup and draft extraction from `libs/cards` into shared Rust code. Keep browser TypeScript behavior aligned through common fixtures.
- Port layout, themes, images, charts, tables, notes and citations from `pptx.ts`. Replace PptxGenJS with a native writer producing the required ZIP/XML parts and relationships. Select libraries only after demonstrating support for the existing tests; no Rust PPTX library has been validated yet. [PresentationML structure](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document).
- Preserve all private routes, schema-version negotiation, validation issue paths, body limits, errors and file-response headers. Run CPU-heavy layout/ZIP work in a bounded blocking pool, with isolated memory/CPU limits, health checks and graceful drain.
- Reuse converter and relevant shared-card test cases. Adapt direct TypeScript imports to fixtures or HTTP requests while preserving assertions. Check editable PPTX objects, relationships, embedded assets and text fitting, then visually review representative exports in an Office viewer. ZIP metadata can vary; content and relationships must match the expected behavior.

The converter contains 1,649 implementation lines and 558 test lines. `libs/cards` adds 3,221 implementation lines and 844 test lines; port its backend-relevant rules while retaining the browser code. Those counts exclude PptxGenJS internals, so line counts understate the work of replacing its file writer. [Converter](../apps/converter/src/handler.ts), [PPTX writer](../apps/converter/src/pptx.ts), [converter tests](../apps/converter/src/handler.test.ts), [export tests](../apps/converter/src/pptx.test.ts).

## Compatibility is the release gate

The release unit is the API plus both Rust workers. Existing API, converter and relevant shared-card tests define expected behavior; they must not be rewritten to accept Rust differences.

1. Freeze the Go reference. Map every method/path and existing test case into a fixed compatibility manifest. Identify coverage gaps before counting progress.
2. Target either API through `API_UNDER_TEST_URL` and either conversion worker through a test URL. Run identical cases against independently seeded databases, Valkey state, image directories and deterministic provider fixtures. Final full-suite runs use the real replacement conversion worker, not a converter stub.
3. Preserve inputs and assertions. Adapt direct Go handler calls to HTTP and injected identities to seeded users/test tokens. Map relevant parser, crypto and service rules to HTTP cases or cross-language fixtures.
4. Implement all endpoints and rerun until they match. Check status, JSON, headers, cookies, permissions, SSE replay, database effects and provider calls. Normalize only declared variable fields, while checking their format and relationships.
5. Cut over the entire backend after 100% required-case passes across API and converter, complete route/schema/export coverage and credential/job/recovery checks. Retain the prior Go/Bun release as the rollback artifact.

`Compatibility = passed required cases / all required cases`. Failed, skipped, blocked and unimplemented cases stay in the denominator. Missing routes/assertions prevent 100%; deleting failures cannot raise the score. Track endpoint coverage separately. The initial implementation and route inventory exist, but a complete required-case manifest and overall compatibility score are still pending.

Current tests need adapters: [middleware tests](../apps/api/cmd/api/main_test.go) call Go handlers, [document save tests](../apps/api/internal/carddocument/save_test.go) inject identity, and [JWT tests](../apps/api/internal/auth/jwt_test.go) instantiate a service. Unchanged `go test ./...` still tests Go. Preserve the cases and expectations when adapting them to Axum.

Provide database, Valkey and converter dependencies; required skips mean incomplete compatibility. [Existing CI](../.github/workflows/checks.yml), [database fixture](../apps/api/internal/carddocument/carddocument_test.go), [cache tests](../apps/api/internal/cache/cache_test.go).

| Required family | Behavior to preserve |
| --- | --- |
| Health and HTTP middleware | Methods, unknown paths, CORS, trusted origins, body limits, rate limits and errors |
| Auth and profile | Password/OTP/OAuth, cookie and bearer sessions, profile changes and avatars |
| Presentations and cards | Lists, document reads/writes, expected revisions, ownership and deletion |
| Assets, templates, sharing and export | Uploads, stock images, templates, share permissions and editable PPTX |
| Generation and research | Submissions, outlines, previews, idempotency, cancellation, SSE and points |
| AI connections | Provider selection, encryption, validation and enabled/disabled behavior |
| Billing | Balance, checkout, signatures, webhook retries and duplicate-payment protection |
| Feedback | Authentication, validation, response shape and persistence |
| Conversion worker and card rules | Draft conversion, schema negotiation, validation, assembly, templates and draft extraction |
| PPTX worker output | Editable text/charts/tables, layout, images, notes, citations and valid package relationships |

Native Rust River remains the first queue choice. Pin its SQLx-compatible version, validate the existing schema and serialized jobs, and test cancellation, recovery and transactional completion entirely in the replacement environment. Unknown worker kinds and leader rescue behavior need coverage; River documents period-uniqueness differences before Go 0.48, though this checkout does not enable that option. [River compatibility guide](https://docs.rs/riverqueue/latest/riverqueue/guide/mixed_deployments/index.html).

Keep the 39 existing SQL migrations unchanged and retain Goose as release tooling. SQLx can query that schema without owning migrations. API and converter ports require no migration rewrite. [Goose annotations](https://pressly.github.io/goose/documentation/annotations/).

## Behaviors we cannot lose

- Reserve points, create job/events and enqueue atomically. Settle/refund once; cancellation blocks late saves and charges.
- Persist ordered SSE events before delivery. Preserve replay cursors, terminal events and limits. Disconnects must not cancel jobs.
- Preserve cookies, JWT/OTP/OAuth, passwordless accounts and error shapes. Match the existing NFKC/scrypt format exactly; see the research note for parameters.
- Match versioned BYOK AES-GCM encoding and associated data. Preserve Razorpay signatures and duplicate-payment protection.
- Preserve immutable JSONB revisions, expected-revision conflicts and submitted-byte hashes/sizes. Equivalent JSON can serialize to different bytes.

These requirements come from [submission](../apps/api/internal/generation/submit.go), [job lifecycle](../apps/api/internal/generation/jobs.go), [passwords](../apps/api/internal/auth/password.go), [JWT](../apps/api/internal/auth/jwt.go), [BYOK credentials](../apps/api/internal/integrations/ai/credentials.go), and [card revision migration](../apps/api/migrations/00035_purge_legacy.sql).

## Evidence and decision

Compare Go/Rust on identical VPS-class limits and fixtures. Record latency percentiles, throughput, CPU, peak RSS, pool waits, SSE concurrency and build time. For generation, record first-card/deck time, provider calls and points. Separate deterministic backend benchmarks from live-provider checks; report errors and concurrency.

The estimate `total ratio = 1 - backend share + backend share / speedup` illustrates the limit of backend speedups. If backend work is 10% of elapsed generation time and gets 2x faster, total time falls 5%. We have no Go/Rust benchmark results yet.

The cutover criterion is 100% of the required API, conversion and export compatibility suite, with complete coverage and successful release recovery checks. Performance measurements cannot excuse behavior differences. Until then, the existing Go backend and Bun converter remain deployed.

## Repository evidence

The checkout has 14,244 implementation lines across 70 Go files, plus the converter/shared-card scope above. Its 5,237 Go test lines provide the API baseline. The 39 application SQL migrations contain 1,446 lines to preserve. Counts indicate scope, not effort. The vector pipeline is retired and outside this port.

Deployment is VPS Compose with separate API, worker, migration and converter images, a shared objects volume, and systemd maintenance timers. Some architecture/worker prose still refers to Cloud Tasks or Cloud Scheduler; use [Compose](../infra/compose.json), [worker startup](../apps/api/cmd/worker/main.go), [maintenance timer](../infra/slidesage-maintenance.timer) and [release script](../infra/deploy.sh) as the baseline. This exploration did not inspect the live VPS.

Rust images must retain health/readiness/drain behavior and resource limits. The release must still verify backups, pause work, run one migration owner and check readiness/HTTPS. Route rollback is safe only while schemas, stored payloads and job consumers remain compatible. Destructive schema recovery requires the pre-release backup.

