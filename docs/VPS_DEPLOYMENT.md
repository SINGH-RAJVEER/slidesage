# VPS deployment

- `infra/compose` runs the backend on one VPS with Docker Compose. Cloudflare Pages keeps serving the frontend, and Cloudflare proxies `api.slidesage.app` to nginx on the VPS.
- This is an alternative to the Cloud Run stack in [Production infrastructure](PRODUCTION_INFRASTRUCTURE.md). Both cannot own `api.slidesage.app` at once; see [Coexisting with the Cloud Run release](#coexisting-with-the-cloud-run-release).

## Architecture

| Component | Runs on | Reachable from |
| --- | --- | --- |
| React frontend | Cloudflare Pages | Internet |
| DNS, TLS, proxy | Cloudflare | Internet |
| nginx | VPS container, ports 80 and 443 | Cloudflare edge ranges only |
| Go API | VPS container | nginx |
| Generation worker | VPS container, continuous River client | Nothing inbound |
| Card converter | VPS container | API and worker |
| PostgreSQL 18 with pgvector | VPS container, `postgres-data` volume | API, worker, migrate, maintenance |
| Valkey read cache | VPS container, no persistence | API |
| Migrations | One-off `migrate` container on every deploy | Nothing inbound |
| Maintenance sweep | `worker --maintenance` every 15 minutes | Nothing inbound |
| Card images | Existing GCS bucket | API and worker through a service-account key |
| OpenRouter, Exa, Resend, Razorpay, Unsplash | External | Outbound HTTPS |

- The `private` network is `internal`: PostgreSQL, Valkey, and the converter have no route to or from the internet. Only nginx publishes ports.
- API, worker, migrate, and maintenance also join `public` for outbound calls to providers and GCS.
- The worker runs continuously, so the Cloud Tasks wake signal is unused: `WORKER_WAKE_URL` is empty and `WORKER_REQUEST_LEASED=false`.
- Images are the same four `docker-bake.hcl` targets the Cloud Run release builds, pushed to GHCR. The Go binaries are `linux/amd64`, so the VPS must be x86-64.

## Files

| Path | Purpose |
| --- | --- |
| `infra/compose/compose.json` | Services, networks, volume, and the GCS key secret |
| `infra/compose/env.example` | Template for the server's `.env` |
| `infra/compose/nginx/templates/default.conf.template` | TLS, Cloudflare-only gate, header rewriting, proxy to the API |
| `infra/compose/nginx/cloudflare.conf` | Generated Cloudflare ranges for `realip` and the gate |
| `infra/compose/nginx/refresh-cloudflare-ips.sh` | Regenerates `cloudflare.conf` |
| `infra/compose/deploy.sh` | Backup, migrate, and roll to an image tag |
| `infra/compose/backup.sh` | `pg_dump` with read-back check and retention |
| `infra/compose/systemd/` | Timers for the maintenance sweep and daily backup |

- `compose.json` is JSON because YAML cannot be tab-indented. `COMPOSE_FILE=compose.json` in `.env` lets plain `docker compose` find it.
- `certs/`, `secrets/`, `backups/`, and `.env` exist only on the server and are ignored by Git.

## One-time server setup

1. Provision an x86-64 VPS with at least 2 vCPU and 4 GB RAM. Install Docker Engine with the Compose plugin.
2. Allow SSH, 80, and 443 in the provider firewall. Docker-published ports bypass `ufw`, so nginx rejects non-Cloudflare sources itself; a provider firewall limited to [Cloudflare ranges](https://www.cloudflare.com/ips/) adds a second layer.
3. Copy the stack to `/opt/slidesage`. The systemd units assume that path.

```bash
rsync -a infra/compose/ vps:/opt/slidesage/
ssh vps
cd /opt/slidesage
cp env.example .env
chmod 600 .env
```

4. Fill in `.env`. Generate `POSTGRES_PASSWORD`, `VALKEY_PASSWORD`, `AUTH_SECRET`, and `RATE_LIMIT_HASH_SECRET` with `openssl rand -hex 32`, and `BYOK_ENCRYPTION_KEY` with `openssl rand -base64 32`. Reuse the production values from Secret Manager when moving an existing deployment, or existing sessions, rate-limit identities, and stored BYOK credentials break.
5. Log in to GHCR with a token that has `read:packages`: `docker login ghcr.io`.
6. Install the timers:

```bash
sudo cp systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now slidesage-maintenance.timer slidesage-backup.timer
```

### Cloudflare

- Create an Origin CA certificate for `api.slidesage.app` under SSL/TLS, Origin Server. Save it as `certs/origin.pem` and the key as `certs/origin.key`, `chmod 600` the key.
- Set the zone's SSL/TLS mode to Full (strict), and enable Always Use HTTPS.
- Point a proxied `A` record for `api` at the VPS address. Without an `AAAA` record Cloudflare reaches the origin over IPv4, where Docker preserves the client address that the gate checks.
- Rerun `nginx/refresh-cloudflare-ips.sh` when Cloudflare changes its ranges, then `docker compose exec nginx nginx -s reload`.

### Card image storage

- The services read GCS through Application Default Credentials from `secrets/gcs-key.json`.
- Create a service account for the VPS and grant it the bucket roles Terraform grants the Cloud Run runtime account, including the conditional delete on legacy prefixes that `migrate` uses.
- Download a JSON key to `secrets/gcs-key.json`. The images run as UID 65532, so `sudo chown 65532:65532 secrets/gcs-key.json && sudo chmod 400 secrets/gcs-key.json`.
- Set `PRESENTATION_GCS_BUCKET` to the existing bucket name. Never point a new deployment at a fresh bucket while the database still references images in the old one.

## Releasing

Build and push from a checkout of the release commit. This needs Go, Bun, and Docker Buildx:

```bash
bun install --frozen-lockfile
docker login ghcr.io
just vps-images "$(git rev-parse HEAD)"
```

Then deploy on the server:

```bash
cd /opt/slidesage
./deploy.sh <commit-sha>
```

`deploy.sh` follows the same cutover discipline as the [Cloud Run release](CI_CD.md#migration-cutover):

1. Records the tag in `.env` and pulls all images.
2. Starts PostgreSQL and writes a verified dump to `backups/`.
3. Stops the API and worker so no old binary runs during migration.
4. Runs `docker compose up`. `migrate` applies Goose and River migrations and sweeps retired bucket objects; API and worker start only after it exits successfully.
5. Polls the API's `/health` through the compose network for one minute.

- If `migrate` fails, API and worker stay stopped. Inspect `docker compose logs migrate`; do not start an older tag against a partly migrated schema. Restore the pre-release dump instead.
- Rolling back to an older tag is safe only when its binaries support the current schema. See [Rollback](CI_CD.md#rollback).
- nginx returns `502` while the API is stopped.

## Moving data from Cloud SQL

Do this once, before the first `deploy.sh`, with the Cloud Run services paused so nothing writes after the dump:

```bash
# On a machine with access to Cloud SQL, through cloud-sql-proxy or an authorized network
pg_dump --format=custom --no-owner --no-acl -d "$CLOUD_SQL_URL" > cloudsql.dump
scp cloudsql.dump vps:/opt/slidesage/backups/

# On the VPS
docker compose up --detach --wait postgres
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' < backups/cloudsql.dump
./deploy.sh <commit-sha>
```

- Restore into the empty database the first `postgres` start creates. `migrate` then finds the schema current and applies only newer migrations.
- Keep the Cloud SQL instance and its backups until the VPS has served traffic successfully.

## Operations

| Task | Command, from `/opt/slidesage` |
| --- | --- |
| Status | `docker compose ps --all` |
| Logs | `docker compose logs --follow api worker` |
| Manual backup | `./backup.sh` |
| Manual maintenance sweep | `docker compose run --rm maintenance` |
| Database shell | `docker compose exec postgres psql -U slidesage` |
| Timer status | `systemctl list-timers 'slidesage-*'` |

- Container logs rotate at 10 MB, five files per service.
- `backup.sh` keeps `BACKUP_KEEP` dumps, 14 by default. They sit on the same disk as the database, so copy `backups/` off the server, for example with `rclone` or `restic` from a timer.

Restore a dump:

```bash
docker compose stop api worker
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/<dump>
docker compose up --detach
```

### Valkey

- Valkey is a disposable read cache: no RDB or AOF, `VALKEY_MAXMEMORY` with `allkeys-lru` eviction. Restarting it costs only cache misses.
- It requires `VALKEY_PASSWORD`. The API connects with `CACHE_VALKEY_AUTH=password`, which production accepts because the server is reachable only over the internal network. See [Database cache](DATABASE_CACHE.md#production).

### Client addresses

- nginx trusts `CF-Connecting-IP` only from Cloudflare's ranges, and rejects every other source with `444`.
- It overwrites `CF-Connecting-IP`, `X-Forwarded-For`, and `X-Real-IP` with that address before proxying, so `TRUST_PROXY_HEADERS=true` in the API cannot be fed a client-chosen value. See [Rate limiting](RATE_LIMITING.md).
- Server-Sent Events need no special handling. The API sends `X-Accel-Buffering: no` and a keepalive every 10 seconds, inside Cloudflare's 100-second idle limit.

## Coexisting with the Cloud Run release

- `infra/prod/edge.tf` manages the `api` record as DNS-only, pointing at the Google load balancer. A Terraform apply from `.github/workflows/deploy.yml` reverts a hand-made change to the VPS. Remove the record from Terraform, or stop the Cloud Run release, before switching DNS.
- `deploy.yml` still builds and deploys Cloud Run on every push to `main`. Disable it once the VPS is primary, or two deployments will write to the same bucket with different databases.
- Pages keeps building from GitHub as before. Its API address does not change.
