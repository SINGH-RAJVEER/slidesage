# Development setup

## Requirements

- Install Nix and [devenv](https://devenv.sh/getting-started/). The shell provides Go, Rust/Cargo, rustfmt, Clippy, Watchexec, Bun, PostgreSQL, Goose, and `just`.
- `apps/api` targets Go 1.27.1. The pinned shell ships Go 1.26; `GOTOOLCHAIN=auto` downloads and caches the required toolchain on first use. That build needs network access.

```bash
cp .env.example .env
devenv shell
bun install
just dev
```

- Set `AUTH_SECRET` and `OPEN_ROUTER_API_KEY` in `.env`.
- Add credentials for the services you use: Unsplash photos, Exa research, Resend email, OAuth, and Razorpay payments. See [Environment variables](ENVIRONMENT_VARIABLES.md).
- Without an Unsplash key, generation uses text-only layouts and stock routes return `503`; uploads still work.

## Startup

`just dev` starts services in dependency order:

1. PostgreSQL with pgvector for the early migrations, plus the local role and database.
2. Goose and River migrations.
3. Card converter on `8090`.
4. API on `8000` and generation worker on `8080`, after converter health checks. Card images go to `.devenv/state/objects`.
5. Vite on `5173`, after API and worker readiness.

- Stop with `Ctrl+C`; devenv shuts down managed services.
- Document bodies live in PostgreSQL JSONB; the emulator stores image bytes.
- Vite exposes only `VITE_*` variables. Without `VITE_API_URL`, local requests use port `8000` on the same loopback hostname.
- `apps/web/styles.css` imports shared styles from `libs/ui/styles/base.css`. The web workspace needs both `tailwindcss` and `@tailwindcss/vite`.

## Rust port development

The root Cargo workspace contains the API in `apps/backend-rust`, the conversion worker in `apps/converter-rust`, and shared card logic in `libs/cards-rust`. The API provides health/CORS, password sign-in/options, session/profile reads, sign-out, feedback, billing balance, presentation list/detail/delete, saved-document reads with optional Valkey caching, share management and public shared-deck reads. The converter provides health/schema/templates/card conversion/validation/assembly/drafts. It depends on the shared card library and has no backend, database, authentication or cache dependency. The shared library has no HTTP runtime. Most application endpoints, durable generation and PPTX export remain pending. The generation port will get its own package at `apps/worker-rust`; that package is not implemented yet. The full backend will switch together after the compatibility gate; these development servers are not part of `just dev` or deployment.

Run the implemented compatibility subset with one command:

```bash
bun apps/backend-rust/compatibility/run.ts
```

The runner requires Bun, Go, Cargo, SQLx CLI 0.9, PostgreSQL tools with pgvector, and `valkey-server`/`valkey-cli` on PATH. It creates private UTF-8 PostgreSQL and Valkey instances on temporary loopback ports, applies the unchanged Goose/River migrations, runs native Rust tests and Go comparisons against live Rust, then checks the Bun converter reference and implemented Rust handlers. Both normal and secure-cookie configurations run. It supplies synthetic credentials, its own database URL and a private object directory, independently of your application data. A further API instance runs without storage to check configuration-error behavior. Owned services stop on success, failure or interruption; logs and `results.json` remain under the printed temporary directory.

A passing run keeps `release_ready: false`. All converter handler assertions run unconditionally. This runner does not yet cover the complete API, generation or PPTX export contract.

Run from the repository root inside `devenv shell`:

```bash
cargo test --workspace --locked --all-targets
cargo run -p slidesage-backend --bin api
```

The standalone API defaults to `127.0.0.1:8001`; `HOST` and `PORT` override it. In another terminal, run `cargo run -p slidesage-converter --bin conversion_worker` for the implemented converter routes on `127.0.0.1:8091`. It accepts `CARD_CONVERTER_HOST` and `CARD_CONVERTER_PORT` overrides. Both stop on SIGINT/SIGTERM. They can be built separately with `cargo build --locked -p slidesage-backend --bin api` and `cargo build --locked -p slidesage-converter --bin conversion_worker`. All packages share the root `Cargo.lock`, `target/` and formatting configuration; SQLx metadata lives in the root `.sqlx/`.

Set `DATABASE_URL` to a database migrated with the existing Go runner to enable the implemented application routes. Without it, the standalone server exposes health only. `AUTH_SECRET` signs/verifies tokens; `BASE_URL` selects the existing normal or HTTPS cookie name and sign-out policy, and `RATE_LIMIT_HASH_SECRET` defaults to `AUTH_SECRET`. HTTPS rejects short/placeholder auth secrets; production requires an explicit rate-limit hash secret. The current SQLx pool is limited to five connections.

SQLx 0.9 requires a matching CLI for query metadata checks. Install it with `cargo install sqlx-cli --version 0.9.0 --no-default-features --features postgres,rustls`. The repository Cargo configuration defaults to offline query metadata, so builds do not contact the configured database. To refresh/check workspace metadata against a disposable migrated database, run from the repository root:

```bash
DATABASE_URL=postgresql://slidesage@127.0.0.1:5432/slidesage_test cargo sqlx prepare --workspace -- --locked --all-targets --all-features
DATABASE_URL=postgresql://slidesage@127.0.0.1:5432/slidesage_test cargo sqlx prepare --workspace --check -- --locked --all-targets --all-features
```

The explicit PostgreSQL suite requires a disposable UTF-8 database with the unchanged application and River migrations applied. It fails if `TEST_DATABASE_URL` is absent:

```bash
TEST_DATABASE_URL=postgresql://slidesage@127.0.0.1:5432/slidesage_test cargo test --workspace --locked --all-targets --all-features
```

The original Go feedback tests can target the Rust server using `API_UNDER_TEST_URL`, `FEEDBACK_TEST_DATABASE_URL` and `TEST_AUTH_SECRET`. Seed a synthetic `users` row with ID `user-1` in that disposable database first. Run `go -C apps/api test -count=1 ./internal/feedback`; the adapter resets only that fixture user's feedback rate counter for each independent validation case and verifies real persisted rows. The separate `go -C apps/api test -count=1 -tags rustcompat -run '^TestFeedbackRateLimitMatchesRust$' ./internal/middleware` compares Go/Rust limits and counter hashes with fresh synthetic identities. If the server uses a separate rate secret, set `TEST_RATE_LIMIT_HASH_SECRET` to the same test value.

For billing balance, set `API_UNDER_TEST_URL`, `TEST_DATABASE_URL` and `TEST_AUTH_SECRET`, then run `go -C apps/api test -count=1 -tags rustcompat -run '^TestBillingBalanceMatchesRust$' ./internal/integrations/billing`. It creates/removes its own fixture users and applies identical requests and assertions to the original Go handler and Rust server. `TEST_COOKIE_NAME` defaults to `slidesage_token`; use `__Secure-slidesage_token` for a server configured with an HTTPS `BASE_URL`. The balance query uses the existing schema; it does not call Razorpay or modify balances.

With the same environment, run `go -C apps/api test -count=1 -tags rustcompat -run '^TestPresentationRoutesMatchRust$' ./internal/presentation` for presentation list/detail/delete comparisons. The suite creates and removes its own users, presentations, operations, assets and share fixtures. It compares original Go routes with live Rust, including active-generation guards, failed-deletion rollback and cleanup/cache triggers. The explicit Rust error suite also checks authentication/validation before closed-database failures.

Set `CACHE_VALKEY_ADDR` on the Rust API and `TEST_VALKEY_ADDR` on tests to the same disposable no-auth Valkey, then run `TestRustPresentationListSharesGoCache` in that Go package. It fills entries in both directions, blocks presentation-table reads to prove cache hits, checks corruption recovery and verifies the 30-second TTL. Native Rust tests also cover committed invalidation, rollback, ownership changes, account deletion, late fills, size limits, expiry and outages. PostgreSQL still supplies the current cache generation on every list request. See [cache details](DATABASE_CACHE.md#isolated-rust-port).

Owner document reads use `TestCurrentCardDocumentMatchesRust` and `TestRustCurrentCardDocumentSharesGoCache` in `./internal/carddocument`. With the same disposable database/auth/Valkey variables, these compare current revision metadata, referenced assets, raw numeric precision, fresh ownership/head/assets, cache interchange and one-hour TTLs. The runner includes the original Go card-document tests too. Stored documents retain their JSONB values; this read endpoint does not run the converter validator or rewrite stored bytes.

Owner and public image downloads use `TestPresentationAssetsMatchRust` in that package. It requires `TEST_PRESENTATION_STORAGE_DIR` to identify the same disposable directory as the Rust API's `PRESENTATION_STORAGE_DIR`, plus `API_WITHOUT_STORAGE_UNDER_TEST_URL` for an API configured without storage. The runner sets all three. Cases compare bytes, headers, redirects, HEAD, conditional requests, document membership, ownership/share changes and file errors. Rust streams files without buffering complete images; this store currently implements reads only.

Share management uses `TestShareManagementMatchesRust` and `TestShareManagementRustRollbackAndNoRowSemantics` in that package. The oracle checks token/digest/UUID/timestamp relationships before normalizing random fields, plus rotation, privacy and idempotent revocation. Failure cases install fixture-specific triggers and require the runner's disposable-database guard. `TestSharedPresentationMatchesRust` compares public reads, citation privacy, live token checks, current content/ownership, revocation, rotation, deletion and malformed data.

For session/profile reads and sign-out, keep `API_UNDER_TEST_URL`, `TEST_DATABASE_URL` and `TEST_AUTH_SECRET` set, then run `go -C apps/api test -count=1 -tags rustcompat -run '^TestAuthReadRoutesMatchRust$' ./internal/auth`. The suite creates/removes its own user/credential fixtures and compares 25 cases with the original Go routes. Run it again with `TEST_SECURE_COOKIES=true` against a test API configured with `BASE_URL=https://slidesage.app` to check `__Secure-slidesage_token`, Secure and SameSite=None. This tests HTTPS cookie configuration; the local test transport can still use HTTP. Only `session.expiresAt` is normalized, after verifying it falls within the request's lookup-time + seven-day window.

For password sign-in, run `go -C apps/api test -count=1 -tags rustcompat -run '^TestPasswordSignInMatchesRust$' ./internal/auth` with the same database/auth variables. Set `TRUST_PROXY_HEADERS=true` on both the test process and test API for the synthetic proxy/rate-limit cases. Set `TEST_RATE_LIMIT_HASH_SECRET` if the server uses a separate rate secret. Cases compare credentials, JSON parsing, normalization, JWT claims, cookie policy and persisted IP/email counters. Repeat against the secure-cookie API as above. Password checks use a bounded blocking pool; no verification mail is sent by this endpoint in the reference implementation.

The runner also executes `TestSignInOptionsMatchesRust` in both configurations. Its required database-failure assertions briefly rename columns, then restore them, and require `TEST_RUST_DISPOSABLE_DATABASE=true`. Run that oracle through the disposable runner to keep those mutations inside a fresh private database. It checks strict request decoding, credential availability, missing accounts and the shared sign-in rate counters.

The converter tests target Bun by default. Set `CONVERTER_UNDER_TEST_URL` to send requests to a running Rust worker. The runner includes all existing handler assertions plus `cards.compatibility.test.ts`, `assembly.compatibility.test.ts` and `drafts.compatibility.test.ts`. These compare deterministic IDs, node/widget rules, text cleanup, Unicode and JavaScript coercion against the TypeScript reference. Handler workflows convert and assemble cards through the selected worker throughout. These files are test adapters; the Rust worker executes native code. PPTX writer tests still exercise Bun directly and need their own adapter.

```bash
CONVERTER_UNDER_TEST_URL=http://127.0.0.1:8091 bun test --isolate apps/converter/src/handler.test.ts apps/converter/src/cards.compatibility.test.ts apps/converter/src/assembly.compatibility.test.ts apps/converter/src/drafts.compatibility.test.ts
```

The Rust drafting descriptor is embedded at `libs/cards-rust/src/drafting-schema.json`. Keep it aligned with `libs/cards/src/draft-format.ts`, `layouts.ts` and `schema.ts`; the schema test compares the full response with the current TypeScript function, so stale metadata fails. This is drafting metadata, not a document validator.

Curated template documents/assets are embedded in `libs/cards-rust/src/templates.json`. Regenerate them with `bun libs/cards-rust/scripts/templates.ts` after changing the TypeScript catalog. Handler tests compare all six responses with the current catalog; the Rust worker needs no Bun process or runtime catalog files.

The original Go CORS tests can target the running Rust API. Configure matching origins on that server, then run:

```bash
API_UNDER_TEST_URL=http://127.0.0.1:8001 go -C apps/api test -count=1 -run '^TestSecurity' ./cmd/api
```

Cross-language auth checks use synthetic credentials through stdin and compare the original Go functions with the Rust helpers in both directions:

```bash
cargo build -p slidesage-backend --locked --example auth_compat
RUST_AUTH_COMPAT_BIN="$PWD/target/debug/examples/auth_compat" go -C apps/api test -count=1 -tags rustcompat -run '^TestRustPasswordAndJWTCompatibility$' ./internal/auth
```

The build-tagged auth check fails if its example executable is unavailable; ordinary Go tests do not include it. Format with `cargo fmt --all`, and check with `cargo clippy --workspace --locked --all-targets --all-features -- -D warnings`. The [port plan](RUST_BACKEND_PORT.md) distinguishes implemented helpers from application endpoint compatibility.

## Go hot reload

- Watchexec watches `.go`, `go.mod`, and `go.sum` under `apps/api` during `just dev` or `devenv up`.
- Changes debounce for 300 ms, stop API and worker with `SIGTERM`, then rebuild and restart. Shutdown has a 20-second limit.
- Binaries live outside the watched tree in `.devenv/state/go`. Correcting a build error triggers another build.
- Restarts may interrupt active requests and jobs.
- SQL changes require `just migrate`; `.env` and `devenv.nix` changes require restarting the stack.
- `just api` and `bun run dev:worker` run once without watching.

## Commands

Run from the repository root inside `devenv shell`:

| Command | Action |
| --- | --- |
| `just dev` | Start the complete development stack |
| `just api` | Run API once |
| `bun run dev:worker` | Run worker once |
| `just converter` | Run converter |
| `just web` | Start Vite |
| `just db-shell` | Open PostgreSQL shell |
| `just migrate` | Apply Goose and River migrations and sweep retired objects |
| `just db-generate <name>` | Create a Goose SQL migration |
| `just seed` | Add the local test user |
| `just test` | Run all tests |
| `just test-api` | Run Go tests |
| `just test-web` | Run web tests |
| `just test-ui` | Run shared UI tests |
| `just lint` | Run Go vet and Biome |
| `just format` | Format repository |

## Project structure

- Workspace responsibilities are listed in [Architecture](API_ARCHITECTURE.md#workspace).
- Web routes live under `apps/web/src/routes`, grouped by domain. Startup and routing live under `apps/web/src/app`.
- The project uses one Go module and Bun workspaces, with no separate task runner.
- Generation progress appears in-app without requesting notification permission.

## Database migrations

```bash
just db-generate add_example_table
# Write the SQL, then apply it:
just migrate
```

- `apps/api/migrations` is the embedded Goose history. River manages its queue migrations separately.
- `just migrate` runs `go -C apps/api run ./cmd/migrate`, applying Goose then River. Only upward migration is supported.
- It does not start services.
- Migration 35 deletes decks without card documents and refuses downgrade. See [Card storage](CARD_DOCUMENTS.md#storage).
- Migration 36 invalidates legacy password hashes. See [Password and email changes](AUTH_API.md#password-and-email-changes).
- Apply migrations before API and worker startup. Production uses the separate `migrate` image target.

## Test user

`just seed` adds a verified email-and-password user to the local database:

| Field | Value |
| --- | --- |
| Email | `test@slidesage.local` |
| Password | `slidesage-test` |
| Balance | 500 points |

- Run `just migrate` first. The command uses `DATABASE_URL`, defaulting to the local PostgreSQL on `PGPORT`.
- Running it again resets the password and marks the email verified. It does not change the balance of an existing user.
- `just seed --session` also prints a `slidesage_token` cookie for browser automation. It signs with `AUTH_SECRET`, so set the same value the API uses.
- The password is public, so the command refuses any database host other than `localhost`, a loopback address, or a Unix socket.

## Local URLs

| Service | URL |
| --- | --- |
| Web | `http://localhost:5173` |
| API | `http://localhost:8000` |
| API health | `http://localhost:8000/health` |
| Converter health | `http://localhost:8090/health` |
| Worker liveness | `http://localhost:8080/live` |
| Worker readiness | `http://localhost:8080/ready` |
| PostgreSQL | `postgresql://slidesage:slidesage@127.0.0.1:$PGPORT/slidesage` |

Use the active `PGPORT`; devenv may change it when `5432` is occupied.

## Mobile layouts

- Check generation, research, library, and billing changes at 320px and 375px portrait widths.
- Keep controls reachable by touch, respect safe-area padding, and avoid horizontal page scrolling.

## Reset PostgreSQL

This permanently deletes local development data:

```bash
devenv processes down
rm -rf .devenv/state/postgres
just dev
```

## Troubleshooting

- Missing tools: enter `devenv shell`.
- Port conflicts: use active `PGPORT`, or stop the process occupying a service port.
- API exits: inspect `devenv processes logs api` and the Go toolchain.
- Queued generation or worker exits: inspect `devenv processes logs worker`, `/ready`, database access, and provider credentials.
- AI or research failures: check `OPEN_ROUTER_API_KEY`, `OPEN_ROUTER_MODEL`, or `EXA_API_KEY`.
- Email failures: check Resend credentials and a verified sender domain. Provider details go to API logs; clients receive `503`.
- Rate-limit failures: check migrations 12 and 13 and logs for `rate_limit_store_failed`.
