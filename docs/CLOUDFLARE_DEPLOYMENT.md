# Cloudflare deployment and first cutover

This migration is prepared for review. Do not treat local tests or a Wrangler dry run as a production migration. The frontend belongs on Pages, API and generation worker on Containers, images in private R2, and PostgreSQL on Neon. The current template was used as the starting reference: [Cloudflare Containers starter](https://github.com/cloudflare/templates/tree/main/containers-template). [Research notes](CLOUDFLARE_RESEARCH.md) record the platform constraints.

## Prerequisites

- Workers Paid, Containers, Durable Objects, and enabled R2 on the same Cloudflare account.
- A token that can manage the Worker, Container images, Durable Objects, R2, and the custom API domain. Keep it outside version control as `CLOUDFLARE_API_TOKEN`; set `CLOUDFLARE_ACCOUNT_ID` separately.
- Docker-compatible local builds, Node.js 24, Bun, and the repository's Go toolchain. Wrangler runs under Node.js; use Bun to install and invoke it.
- Verified database backup, original auth/rate-limit secrets, every active and retired BYOK encryption key, provider/payment credentials, original DNS records, and the old Compose configuration.
- A Neon project with an empty `slidesage` database on PostgreSQL 18, matching the VPS major version. Keep its connection URL in a mode `600` file outside the repository, never in Wrangler vars, docs, or command lines. The runtime uses the `-pooler` host; dumps, restores, and migrations use the direct host without `-pooler`.
- PostgreSQL 18 client tools (`pg_restore`, `psql`) on the operator machine.

## Build and prepare secrets

```bash
bun install --frozen-lockfile
just binaries
bun run type-check
bun run --cwd apps/edge test
bun run --cwd apps/edge check
```

Before changing the VPS Compose configuration, capture the running API's effective environment into a protected file on the server:

```bash
umask 077
cd /opt/slidesage
docker inspect "$(docker compose ps -q api)" --format '{{json .Config.Env}}' > api-env.json
cp compose.json compose.vps.json
./backup.sh
```

Transfer `api-env.json` through authenticated SSH to a private local directory. Create the Worker secret payload without printing credentials:

```bash
bun infra/cloudflare/prepare-secrets.ts /private/api-env.json /private/neon-pooler-url
bunx wrangler secret bulk infra/cloudflare/secrets.json --config apps/edge/wrangler.jsonc
```

The helper preserves the runtime's auth, billing, provider, and versioned BYOK settings, replaces only the database URL with the Neon file, which must set `sslmode=require` or stricter, and selects `openrouter/free`. It refuses to overwrite its output. Review variable names and source provenance without publishing secret values. `APP_ENV` and `OBJECT_STORAGE_TOKEN` are Worker secrets. The Cloudflare API token is never forwarded to a Container. Keep generated secret files with mode `600` and remove the temporary environment export after verification.

Do not run migrations or restore anything into Neon yet. The schema arrives with the final dump during the freeze, and an earlier migration would conflict with it.

## Copy images before switching the API

Create the private R2 bucket:

```bash
bunx wrangler r2 bucket create slidesage-objects
```

Deploy the temporary storage-only Worker. It has no database or application secrets, so it cannot consume River jobs or start serving the API:

```bash
bunx wrangler deploy --config apps/edge/wrangler.bootstrap.jsonc
bun -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("infra/cloudflare/secrets.json", "utf8")).OBJECT_STORAGE_TOKEN)' | bunx wrangler secret put OBJECT_STORAGE_TOKEN --config apps/edge/wrangler.bootstrap.jsonc
```

Use the resulting `https://slidesage-storage-bootstrap.<account-subdomain>.workers.dev/__storage` URL as `OBJECT_STORAGE_URL` for `dist/migrate-objects`. Supply the same `OBJECT_STORAGE_TOKEN` from the protected secret payload through an environment loader, never a command-line literal or log. Copy the existing `slidesage_objects` tree to a private migration directory, preserving relative paths. Run:

```bash
dist/migrate-objects --source /private/objects
```

The command creates objects conditionally, verifies size and SHA-256 before upload, then reads every remote object to verify its bytes. Existing identical objects are safe to replay; mismatches fail. It does not delete the source. Include files used by historical revisions, not only currently displayed images.

## Freeze writers, migrate, and cut over

1. Keep a verified backup and record the original `api.slidesage.app` A/AAAA DNS entries. Arrange a short maintenance window.
2. Disable the old application maintenance timer. Stop the old API and worker using `docker compose -f compose.vps.json stop api worker`. Wait for worker drain and confirm no old application writes continue.
3. Take the final database backup on the VPS with `./backup.sh` and transfer the newest dump through authenticated SSH to a private local directory. Restore it into the empty Neon database through the direct host, then run the reviewed migration binary. Neon roles differ from the VPS roles, so ownership and grants are not restored:

   ```bash
   pg_restore --dbname="$(cat /private/neon-direct-url)" --no-owner --no-acl --exit-on-error /private/slidesage-<timestamp>.dump
   infra/migrate.sh "$PWD/dist/migrate" /private/neon-direct-url
   ```

   The command substitution keeps the URL out of shell history, but it is visible in the local process list while `pg_restore` runs; use a single-user machine. Compare row counts for the main tables between the VPS and Neon before continuing. Run a final image delta copy and remote verification after all old writers have stopped. Preserve the image volume.
4. Upload the final Worker secrets. Remove only the conflicting `api.slidesage.app` A/AAAA records before assigning the Worker custom domain. Preserve unrelated records and the Pages frontend domain. Deploy with `just deploy-backend`, or the reviewed manual GitHub workflow. Wrangler's custom-domain setup can create its own DNS record; a conflicting existing record must be handled deliberately. Source: [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
5. Configure Pages project `slidesage` with repository root, build command `bun install --frozen-lockfile && bun run build:web`, and output `apps/web/dist`. Set production `VITE_API_URL=https://api.slidesage.app` and any existing ad variables. Rebuild. Confirm `index.html` and fingerprinted assets were published, and both `/` and `/sign-in` load. Add `www.slidesage.app` as a Pages custom domain or an intentional Cloudflare redirect if it is still used.
6. Complete the runtime checks below before retiring old Nginx, converter, and Valkey containers. Keep VPS PostgreSQL with no writers and its volume intact as the rollback source until the rollback window closes. Delete the temporary storage Worker only after all R2 verification is complete.

## Runtime checks

- `https://api.slidesage.app/health` responds through the edge Worker, and the one-minute heartbeat starts both fixed instances without a browser request.
- Sign-in from Pages sets the existing secure API cookie. Auth callbacks, CORS, account balances, and BYOK credentials still work.
- A real outline request uses `openrouter/free`. A generation job runs in the Cloudflare worker, and progress reconnects correctly over SSE.
- A generated or uploaded image is readable through its authorized API route. It remains readable after replacing both Containers. Direct unauthorized gateway reads, writes, and deletes fail.
- Image migration count and full byte verification pass. Export a deck with images to PPTX, then verify maintenance can delete images for a deleted presentation.
- A Container started with a database URL that lacks `sslmode=require` or overrides its host refuses to start. Neon point-in-time restore to a branch works, and the restored branch accepts a migration run.
- Verify backup and restore procedures and schema compatibility before calling a rollback safe.

Once these pass, stop the retained VPS application containers explicitly and disable their obsolete timers. Keep the original volumes and configuration until the rollback window closes. Never remove volumes as part of the application retirement.

## Lifecycle and operational limits

The two Durable Object names are fixed; request paths cannot allocate additional instances or address the private worker. A one-minute Cloudflare Cron call renews a five-minute inactivity timeout. After a Durable Object restart, its constructor restores timeout and monitoring. Startup probes readiness before proxying. On an image or Worker version change, the controller signals the old supervisor and allows up to 60 seconds to drain before replacement.

The supervisor keeps the converter alive while Go drains in-flight work, and exits when a dependency fails. River's durable PostgreSQL queue supplies recovery after interruption. The generation process schedules maintenance every 15 minutes; a separate VPS application timer is unnecessary. River polls PostgreSQL continuously, so Neon compute does not scale to zero; size the Neon plan for an always-on compute. Platform interruptions and missed heartbeats can still stop an instance, so real restart tests remain a production gate. Source: [Container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/).

## Preparation validation

Local validation on 2026-10-26 passed the full Go suite against migrated disposable PostgreSQL and Valkey, Go vet, TypeScript checks, card/UI/web suites, the production frontend build, seven edge lifecycle/storage tests, workflow and shell validation, database Compose validation, and a Wrangler dry run with actual image builds. The local host used a Podman socket through a Docker-compatible shim that omitted BuildKit-only load/provenance flags; the GitHub workflow uses Docker Buildx directly.

The object migration command uploaded and read back small and 16 MiB objects through the local R2 emulator, safely replayed an upload, and recovered the original bytes after restarting the local Worker. A mismatched stream checksum failed without creating an object. The secrets helper preserved auth and retired BYOK settings, filtered the Cloudflare deployment token, rewrote the database address, and wrote mode `600` output using fixture credentials.

On 2026-11-02 the target database changed from the SSH-forwarded VPS to Neon. The Go driver connected to the empty Neon database through both the pooler and direct hosts, Neon offers the `vector` extension the migrations create, and the container URL checks, edge tests, type checks, and a Wrangler dry run with a real image build passed without SSH.

Production Containers deployment, the Neon restore, image migration, DNS changes, and the public generation/auth/export gates have not run as part of preparation.
