# Development setup

## Requirements

- Install Nix and [devenv](https://devenv.sh/getting-started/). The shell provides Go, Watchexec, Bun, PostgreSQL, Goose, `just`, Terraform, and `fake-gcs-server`.
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
2. GCS emulator on `4443`, using bucket `slidesage-dev-revisions` and disk state in `.devenv/state/gcs`.
3. Goose and River migrations, followed by the retired-object sweep.
4. Card converter on `8090`.
5. API on `8000` and generation worker on `8080`, after converter health checks.
6. Vite on `5173`, after API and worker readiness.

- Stop with `Ctrl+C`; devenv shuts down managed services.
- Document bodies live in PostgreSQL JSONB; the emulator stores image bytes.
- Vite exposes only `VITE_*` variables. Without `VITE_API_URL`, local requests use port `8000` on the same loopback hostname.
- `apps/web/styles.css` imports shared styles from `libs/ui/styles/base.css`. The web workspace needs both `tailwindcss` and `@tailwindcss/vite`.

### Hot reload

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
- It does not start services. Start the emulator first, or unset `PRESENTATION_GCS_BUCKET` to skip the object sweep.
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
