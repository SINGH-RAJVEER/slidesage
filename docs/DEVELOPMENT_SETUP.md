# Development Setup

## Requirements

Install Nix with [devenv](https://devenv.sh/getting-started/). The environment provides Go, Bun, PostgreSQL, Goose, `just`, Terraform, and `fake-gcs-server`.

`apps/api` targets Go 1.27.1. The pinned devenv nixpkgs still ships Go 1.26, so the first `go` command in the shell downloads the 1.27.1 toolchain through the default `GOTOOLCHAIN=auto` and caches it under the module cache. That first build needs network access; later builds reuse the cached toolchain.

```bash
cp .env.example .env
devenv shell
bun install
just dev
```

Set `AUTH_SECRET` and `OPEN_ROUTER_API_KEY` in `.env`. Add `PEXELS_API_KEY` or `UNSPLASH_ACCESS_KEY` for stock photos, `EXA_API_KEY` for research, `RESEND_API_KEY` for email delivery, OAuth credentials for social sign-in, and Razorpay credentials for purchases.

## Startup

`just dev`:

1. Starts devenv PostgreSQL with pgvector. Early migrations still create vector tables; migration 35 drops them and, when the role owns it, the extension.
2. Ensures the local role, database, and vector extension exist.
3. Starts `fake-gcs-server` on port `4443` and waits for its health check before migrations. Devenv points the migration command, API, and worker at it with `STORAGE_EMULATOR_HOST` and the bucket name `slidesage-dev-revisions`. Image bytes stay on disk under `.devenv/state/gcs`; document bodies live in PostgreSQL JSONB.
4. Runs `cmd/migrate`, which applies embedded Goose application migrations and River migrations, then deletes objects left in the bucket by retired document formats.
5. Starts the card converter on port `8090` and waits for `/health`.
6. Starts the Go API on port `8000` after the converter and waits for `/health`.
7. Starts the durable generation worker after the converter and waits for `/ready` on port `8080`.
8. Starts the Vite development server on port `5173`, with React Fast Refresh, Tailwind processing, and static assets from `apps/web/public`.

Vite exposes only `VITE_*` variables to browser bundles. If `VITE_API_URL` is absent during local development, browser API requests fall back to port `8000` on the same loopback hostname.

The web entry stylesheet is `apps/web/styles.css`. It imports the shared UI stylesheet, whose global styles live in `libs/ui/styles/base.css`. The web workspace declares both `tailwindcss` and `@tailwindcss/vite`; both are required because the shared stylesheet imports Tailwind's CSS entrypoint and Vite's plugin resolves it at build time.

Stop the foreground process with `Ctrl+C`. Devenv stops managed services with the development stack.

## Commands

Run these from the repository root inside `devenv shell`.

| Command                   | Action                                                        |
| ------------------------- | ------------------------------------------------------------- |
| `just dev`                | Start PostgreSQL, migrations, API, generation worker, and web |
| `just api`                | Start the Go API                                              |
| `bun run dev:worker`      | Start the durable generation worker                           |
| `just web`                | Start Vite web server                                         |
| `just db-shell`           | Open a PostgreSQL shell                                       |
| `just migrate`            | Apply Goose and River migrations, purge retired objects       |
| `just db-generate <name>` | Create a Goose SQL migration                                  |
| `just test`               | Run all tests                                                 |
| `just test-api`           | Run Go API tests                                              |
| `just test-web`           | Run web tests                                                 |
| `just test-ui`            | Run shared UI tests                                           |
| `just lint`               | Run Go vet and Biome checks                                   |
| `just format`             | Format the repository                                         |

The repository uses a Go module for `apps/api` and a Bun workspace for the web, converter, cards, shared types, and UI packages. It does not use a separate monorepo task runner.

## Project Structure

The active application is split into six workspace areas:

- `apps/api`: Go HTTP API, durable River worker, migration command, domain services, and integrations.
- `apps/web`: Browser application shell, router, and route-level screens.
- `apps/converter`: Private Bun service that validates model drafts into card documents.
- `libs/cards`: The card document schema, validation, and draft conversion, shared by the converter and the browser.
- `libs/types`: Shared presentation, outline, draft preview, research source, AI configuration, profile, and billing types.
- `libs/ui`: Shared React components, hooks, UI contexts, and client-side helpers.

Web routes are grouped by domain under `apps/web/src/routes`: `auth`, `landing`, `presentations`, `settings`, and `billing`. Application startup and router infrastructure live under `apps/web/src/app`.

Generation progress and completion appear in-app. Starting generation does not request browser notification permission.

The former TypeScript API has been removed. `apps/api` is the only API implementation and contains the application migration history and River migration runner.

## Database Migrations

`apps/api/migrations` is the canonical embedded Goose application history. River v0.43 maintains a separate migration history for its PostgreSQL queue tables. Create an application migration with:

```bash
just db-generate add_example_table
```

Write the SQL, then apply it with `just migrate`, which runs `go -C apps/api run ./cmd/migrate` directly. The command applies Goose and then River migrations to the database, including an empty one. Application and River migration histories must be advanced together, so only an upward pass is exposed; there is no down or redo entry point. With `PRESENTATION_GCS_BUCKET` set, it then deletes the objects retired document formats left under `presentations/<id>/objects/`, `revisions/`, and `cards/`; image assets are kept. A failed sweep is logged and does not fail the command. `just migrate` does not start services, so start the storage emulator first or unset the bucket to skip the sweep. See [Card storage](CARD_DOCUMENTS.md#storage).

Migration 35 deletes every presentation without a card document and refuses to downgrade. Migration 36 replaces unsalted SHA-256 and PBKDF2 password hashes with a marker, so those accounts must reset their password. See [Card storage](CARD_DOCUMENTS.md#storage) and [Auth API](AUTH_API.md#password-and-email-changes).

Migration `00016_remove_database_sessions.sql` removes the old database-backed session table. Authentication now uses only signed JWTs, carried in the `slidesage_token` HTTP-only cookie or an `Authorization: Bearer` header.

Apply migrations before starting or deploying the API and worker. Production images use the `migrate` target in `apps/api/Dockerfile` as a one-off migration job; runtime startup does not apply schema changes.

## Local URLs

| Service          | URL                            |
| ---------------- | ------------------------------ |
| Web              | `http://localhost:5173`        |
| API              | `http://localhost:8000`        |
| Health           | `http://localhost:8000/health` |
| Worker liveness  | `http://localhost:8080/live`   |
| Worker readiness | `http://localhost:8080/ready`  |
| PostgreSQL       | `postgresql://slidesage:slidesage@127.0.0.1:$PGPORT/slidesage` |

Devenv may move PostgreSQL from `5432` when the port is occupied. Use the active `PGPORT` for direct database commands.

## Mobile Layouts

The primary generation, research, presentation library, and billing flows support phone-sized portrait viewports. Verify changes at 320px and 375px wide. Mobile controls reflow rather than relying on horizontal page scrolling and remain reachable with touch input and safe-area padding.

## Reset PostgreSQL

This permanently deletes local development data:

```bash
devenv processes down
rm -rf .devenv/state/postgres
just dev
```

## Troubleshooting

- Missing tools: enter `devenv shell` first.
- Port collision: use the active `PGPORT`, or stop the process using `5173` or `8000`.
- API exits: inspect `devenv processes logs api` and confirm the configured Go toolchain.
- Worker exits or generation remains queued: inspect `devenv processes logs worker`, check `http://localhost:8080/ready`, and confirm PostgreSQL and provider configuration.
- Failed AI requests: confirm `OPEN_ROUTER_API_KEY` and `OPEN_ROUTER_MODEL`.
- Failed research: confirm `EXA_API_KEY`.
- Failed email: confirm `RESEND_API_KEY` and that `RESEND_FROM_EMAIL` is a valid address on a domain verified in Resend. Provider validation details are written to the API log, while clients receive a stable `503` response.
- Unexpected rate-limit responses: confirm migration `00012` is applied and inspect the API logs for `rate_limit_store_failed`.
