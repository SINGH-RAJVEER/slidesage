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

The work-in-progress package is `apps/backend-rust`. It provides API health/CORS, password/JWT helpers, converter health/schema and SQLx-backed feedback, billing balance and presentation list/detail/delete. Most application endpoints, generation and PPTX export remain pending. The full backend will switch together after the compatibility gate; these development servers are not part of `just dev` or deployment.

Run from the repository root inside `devenv shell`:

```bash
cargo test --manifest-path apps/backend-rust/Cargo.toml --locked --all-targets
cargo run --manifest-path apps/backend-rust/Cargo.toml --bin api
```

The standalone API defaults to `127.0.0.1:8001`; `HOST` and `PORT` override it. In another terminal, run `cargo run --manifest-path apps/backend-rust/Cargo.toml --bin conversion_worker` for converter health and schema on `127.0.0.1:8091`. It accepts `CARD_CONVERTER_HOST` and `CARD_CONVERTER_PORT` overrides. Both stop on SIGINT/SIGTERM.

Set `DATABASE_URL` to a database migrated with the existing Go runner to enable feedback, billing balance and presentation list/detail/delete. Without it, the standalone server exposes health only. `AUTH_SECRET` signs/verifies tokens; `BASE_URL` selects the existing normal or HTTPS cookie name, and `RATE_LIMIT_HASH_SECRET` defaults to `AUTH_SECRET`. HTTPS rejects short/placeholder auth secrets; production requires an explicit rate-limit hash secret. The current SQLx pool is limited to five connections.

SQLx 0.9 requires a matching CLI for query metadata checks. Install it with `cargo install sqlx-cli --version 0.9.0 --no-default-features --features postgres,rustls`. The repository Cargo configuration defaults to offline query metadata, so builds do not contact the configured database. To refresh/check metadata against a disposable migrated database, run from `apps/backend-rust`:

```bash
DATABASE_URL=postgresql://slidesage@127.0.0.1:5432/slidesage_test cargo sqlx prepare -- --all-targets --all-features
DATABASE_URL=postgresql://slidesage@127.0.0.1:5432/slidesage_test cargo sqlx prepare --check -- --all-targets --all-features
```

The explicit PostgreSQL suite requires a disposable UTF-8 database with the unchanged application and River migrations applied. It fails if `TEST_DATABASE_URL` is absent:

```bash
TEST_DATABASE_URL=postgresql://slidesage@127.0.0.1:5432/slidesage_test cargo test --manifest-path apps/backend-rust/Cargo.toml --locked --all-targets --features postgres-tests
```

The original Go feedback tests can target the Rust server using `API_UNDER_TEST_URL`, `FEEDBACK_TEST_DATABASE_URL` and `TEST_AUTH_SECRET`. Seed a synthetic `users` row with ID `user-1` in that disposable database first. Run `go -C apps/api test -count=1 ./internal/feedback`; the adapter resets only that fixture user's feedback rate counter for each independent validation case and verifies real persisted rows. The separate `go -C apps/api test -count=1 -tags rustcompat -run '^TestFeedbackRateLimitMatchesRust$' ./internal/middleware` compares Go/Rust limits and counter hashes with fresh synthetic identities. If the server uses a separate rate secret, set `TEST_RATE_LIMIT_HASH_SECRET` to the same test value.

For billing balance, set `API_UNDER_TEST_URL`, `TEST_DATABASE_URL` and `TEST_AUTH_SECRET`, then run `go -C apps/api test -count=1 -tags rustcompat -run '^TestBillingBalanceMatchesRust$' ./internal/integrations/billing`. It creates/removes its own fixture users and applies identical requests and assertions to the original Go handler and Rust server. `TEST_COOKIE_NAME` defaults to `slidesage_token`; use `__Secure-slidesage_token` for a server configured with an HTTPS `BASE_URL`. The balance query uses the existing schema; it does not call Razorpay or modify balances.

With the same environment, run `go -C apps/api test -count=1 -tags rustcompat -run '^TestPresentationRoutesMatchRust$' ./internal/presentation` for presentation list/detail/delete comparisons. The suite creates and removes its own users, presentations, operations, assets and share fixtures. It compares original Go routes with live Rust, including active-generation guards, failed-deletion rollback and cleanup/cache triggers. The original Go cache fixture is enabled on the reference server; Rust currently reads PostgreSQL on every list request. The explicit Rust error suite also checks authentication/validation before closed-database failures. Valkey cache query-count and late-fill behavior remain pending for Rust.

The converter handler suite targets Bun by default. Set `CONVERTER_UNDER_TEST_URL` to send every request to a running Rust worker, preserving the existing assertions. The focused command below checks the implemented health/schema subset; ten other handler cases remain required and currently fail against Rust. Running without `-t` exposes those failures. PPTX writer tests still exercise Bun directly and need their own adapter.

```bash
CONVERTER_UNDER_TEST_URL=http://127.0.0.1:8091 bun test --isolate apps/converter/src/handler.test.ts -t 'reports health|serves the drafting schema|preserves schema routing'
```

The Rust drafting descriptor is embedded at `apps/backend-rust/src/cards/drafting-schema.json`. Keep it aligned with `libs/cards/src/draft-format.ts`, `layouts.ts` and `schema.ts`; the schema test compares the full response with the current TypeScript function, so stale metadata fails. This is drafting metadata, not a document validator.

The original Go CORS tests can target the running Rust API. Configure matching origins on that server, then run:

```bash
API_UNDER_TEST_URL=http://127.0.0.1:8001 go -C apps/api test -count=1 -run '^TestSecurity' ./cmd/api
```

Cross-language auth checks use synthetic credentials through stdin and compare the original Go functions with the Rust helpers in both directions:

```bash
cargo build --manifest-path apps/backend-rust/Cargo.toml --locked --example auth_compat
RUST_AUTH_COMPAT_BIN="$PWD/apps/backend-rust/target/debug/examples/auth_compat" go -C apps/api test -count=1 -tags rustcompat -run '^TestRustPasswordAndJWTCompatibility$' ./internal/auth
```

The build-tagged auth check fails if its example executable is unavailable; ordinary Go tests do not include it. Format with `cargo fmt --manifest-path apps/backend-rust/Cargo.toml`, and check with `cargo clippy --manifest-path apps/backend-rust/Cargo.toml --locked --all-targets -- -D warnings`. The [port plan](RUST_BACKEND_PORT.md) distinguishes implemented helpers from application endpoint compatibility.

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
