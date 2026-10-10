# VPS deployment

- `infra/compose.json` runs the frontend and backend on one VPS. Nginx serves the React app from the `web` image and proxies the API. Cloudflare provides DNS and edge TLS; Pages and Terraform are absent from the release path.
- The Go binaries and images target Linux amd64. Use an x86-64 Ubuntu or Debian VPS with at least 2 vCPU and 4 GB RAM, persistent disk, Docker Engine with Compose v2 or newer, `rsync`, `curl`, and `flock`. Follow the [Docker Engine installation instructions](https://docs.docker.com/engine/install/).

## Architecture

| Component | Address | Exposure |
| --- | --- | --- |
| React frontend and Nginx | `https://slidesage.app`, `www` redirects to apex | VPS ports 80 and 443 through Cloudflare |
| API | `https://api.slidesage.app` | Nginx proxies to `api:8000` |
| Worker | `worker:8080`, continuous River client | No host port; `/ready` checked on deploy |
| Converter | `converter:8090` | Internal network only |
| PostgreSQL 18 with pgvector | `postgres:5432` | Internal network, persistent volume |
| Valkey | `valkey:6379` | Internal network, password auth, no persistence |
| Migrate and maintenance | One-off containers | No host ports |
| Card images | Existing private GCS bucket | Outbound requests with a service-account key |

- Only Nginx publishes ports. PostgreSQL, Valkey, and converter join the `internal` private network. API, worker, and jobs also join the public network for outbound provider and storage calls.
- `WORKER_REQUEST_LEASED=false` and empty `WORKER_WAKE_URL` make the worker run continuously without Cloud Tasks.
- The frontend, API, worker, migrations, and converter share one immutable release tag.

## Files

| Path | Purpose |
| --- | --- |
| `infra/compose.json` | Production services and networks |
| `infra/env.example` | Server `.env` template |
| `infra/templates/default.conf.template` | Frontend routes, TLS, API proxy, local health endpoint |
| `infra/nginx/cloudflare.conf` | Trusted Cloudflare ranges and source gate |
| `infra/refresh-cloudflare-ips.sh` | Updates those ranges from Cloudflare |
| `infra/deploy.sh` | Validate, back up, migrate, and start a release |
| `infra/backup.sh` | Custom-format database dump, read-back check, retention |
| `infra/maintenance.sh` | Runs maintenance under the release lock; skips failed cutovers |
| `infra/slidesage-*.service`, `infra/slidesage-*.timer` | Daily backup and maintenance every 15 minutes |

- JSON preserves tab indentation. Scripts and systemd set `COMPOSE_FILE=compose.json`; `.env` also sets it for interactive commands.
- `.env`, `certs/`, `secrets/`, `backups/`, and `.deploy.lock`, and `.deploy-incomplete` are server state ignored by version control.

## Server setup

1. Allow SSH, 80, and 443 in the provider firewall. Restrict HTTP/HTTPS to [Cloudflare edge ranges](https://www.cloudflare.com/ips/) when possible. Docker publishes ports around the host firewall; Nginx also rejects non-Cloudflare sources. Use IPv4 origin records, with no origin `AAAA` record.
2. Create the deploy user and stack directory. Docker group membership and the SSH key must work in a fresh login. The included timers use `slidesage`; edit their `User` if choosing another user.

```bash
sudo useradd --create-home --shell /bin/bash slidesage
sudo usermod --append --groups docker slidesage
sudo install -d -o slidesage -g slidesage /opt/slidesage
# Install the deployment public key in the user's .ssh/authorized_keys.
# From the repository checkout:
rsync -a infra/ slidesage@<vps>:/opt/slidesage/
```

3. Log in as `slidesage` for all stack operations. Use the same user for GHCR login, deployment, and timers so file ownership and registry credentials agree.

```bash
ssh slidesage@<vps>
cd /opt/slidesage
cp env.example .env
chmod 600 .env
mkdir -p certs secrets backups
docker login ghcr.io
```

4. Fill in `.env`. Generate database/cache passwords, `AUTH_SECRET`, and `RATE_LIMIT_HASH_SECRET` with `openssl rand -hex 32`. Generate `BYOK_ENCRYPTION_KEY` with `openssl rand -base64 32`. All three Razorpay values are required. Keep database passwords URL-safe.
5. When moving an existing deployment, preserve auth secrets, rate-limit secrets, all BYOK key versions, and the image bucket name. See [Environment variables](ENVIRONMENT_VARIABLES.md).
6. Configure DNS, certificates, and storage below. Build or select a published release SHA, then run:

```bash
docker compose config --quiet
./deploy.sh <commit-sha>
sudo install -m 644 slidesage-*.service slidesage-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now slidesage-maintenance.timer slidesage-backup.timer
```

- Configure [GitHub deployment settings](CI_CD.md#repository-setup) and enable `VPS_DEPLOY_ENABLED` after the first successful deployment.
- Arrange an off-server copy of `backups/` with your backup tool. Local dumps alone do not survive VPS disk loss.

### DNS and TLS

- Create a Cloudflare Origin CA certificate covering `slidesage.app`, `www.slidesage.app`, and `api.slidesage.app`, or the apex and wildcard. Save the certificate as `certs/origin.pem` and key as `certs/origin.key`; use mode `600` for the key.
- Set Full (strict) TLS mode and Always Use HTTPS. Origin CA certificates require Cloudflare proxying and are not trusted directly by browsers. See [Cloudflare Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/).
- Point proxied `A` records for `@`, `www`, and `api` to the VPS IPv4 address. Remove conflicting Pages CNAMEs for the frontend, detach its Pages custom domains, and disable the Pages Git build integration after the VPS frontend is verified. Preserve email and other unrelated DNS records.
- Match `.env` domains and `WEB_ORIGINS` to these records. Set OAuth callbacks to `https://api.slidesage.app/auth/callback/google` and `/github`.
- Nginx rejects unknown hosts and TLS names. Its local frontend health endpoint binds only to loopback inside the container and has no host port.
- To update Cloudflare ranges, run `./refresh-cloudflare-ips.sh`, then `docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload`.
- Cloudflare's default proxy read timeout is 125 seconds. Long synchronous outline requests can exceed it even though Nginx permits 300 seconds. Generation runs in the worker and sends SSE keepalives every 10 seconds. See [Cloudflare connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/).

### Card image storage

- Keep the existing `PRESENTATION_GCS_BUCKET`. Image references in the restored database still point to that bucket.
- Create a VPS service account with bucket-scoped object viewer and object creator permissions, plus conditional object delete permission restricted to legacy `objects/`, `revisions/`, and `cards/` prefixes for the migration sweep. No Terraform is required.
- Save its JSON key to `secrets/gcs-key.json`. Go containers run as UID 65532; set `sudo chown 65532:65532 secrets/gcs-key.json && sudo chmod 400 secrets/gcs-key.json`. Keep the parent directory traversable by that UID.
- Compose mounts the key into API, worker, migrate, and maintenance and sets `GOOGLE_APPLICATION_CREDENTIALS`. Leave `STORAGE_EMULATOR_HOST` unset in production.

## Releases and proxy behavior

- CI publishes all five images and syncs `infra/` to `/opt/slidesage/` without `--delete`, preserving secrets, certificates, and backups. Manual builds are in [CI/CD](CI_CD.md#manual-build).
- `./deploy.sh <commit-sha>` takes the shared lock, pulls images, and validates the rendered Nginx configuration before downtime. It starts dependencies, backs up the database, stops API and worker, and runs a fresh migration container to completion.
- Only after migration succeeds does it recreate Nginx, API, and worker. It waits for frontend health, API health, and worker readiness. A migration failure leaves API and worker stopped. A `.deploy-incomplete` marker keeps maintenance disabled after any failed cutover until a release succeeds or recovery completes.
- Nginx serves client routes through `index.html` with `Cache-Control: no-cache`. Fingerprinted `/assets/` files cache for a year; missing chunks return `404` rather than HTML. The frontend preload-error handler can then reload after a release.
- The API proxy accepts 16 MiB requests and disables buffering/cache for streaming responses. It resolves Docker DNS dynamically so container replacement does not leave a stale API address. See [Nginx proxy settings](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
- Nginx trusts `CF-Connecting-IP` only from Cloudflare ranges and replaces every client-IP header before forwarding. This supports `TRUST_PROXY_HEADERS=true` without accepting client-supplied forwarding addresses.
- Rerun `deploy.sh` after changing a mounted template or certificate; it recreates Nginx even when the tag is unchanged. API calls return `502` while API is stopped during cutover.
- Avoid Cloudflare Cache Everything rules or forced Browser TTL on frontend HTML and API routes.

## Moving the existing database

1. Pause the old API, worker, and maintenance scheduler so nothing writes after the dump. Keep their database and backups until the VPS has served traffic successfully.
2. Dump through a connection authorized for the old database, then restore into the empty PostgreSQL database on the VPS before the first release:

```bash
pg_dump --format=custom --no-owner --no-acl -d "$CLOUD_SQL_URL" > cloudsql.dump
scp cloudsql.dump slidesage@<vps>:/opt/slidesage/
# As slidesage on the VPS:
cd /opt/slidesage
docker compose up --detach --wait postgres
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error' < cloudsql.dump
./deploy.sh <commit-sha>
```

3. Verify frontend routes, auth, generation, image access, and export before changing all DNS records. Existing encryption keys and GCS objects must remain available.
4. Disable the previous release workflow and Pages integration before allowing routine VPS releases. Archive the old Terraform state separately if needed for the migration record; repository removal does not destroy remote resources.

## Operations

| Task | Command from `/opt/slidesage` |
| --- | --- |
| Status | `docker compose ps --all` |
| Logs | `docker compose logs --follow api worker nginx` |
| Backup | `./backup.sh` |
| Maintenance | `./maintenance.sh` |
| Database shell | `docker compose exec postgres psql -U slidesage -d slidesage` |
| Timers | `systemctl list-timers 'slidesage-*'` |
| Nginx validation | `docker compose exec nginx nginx -t` |

- Logs rotate at 10 MB, five files per service. `backup.sh` retains `BACKUP_KEEP` dumps, 14 by default.
- Valkey uses password authentication and `allkeys-lru`, with no RDB/AOF persistence. Restarting it causes cache misses; PostgreSQL remains authoritative.

## Recovery

- Deploy an earlier tag only if all its binaries support the current schema. Otherwise restore a pre-release dump with runtimes and timers paused. Migrations 33 and 35 refuse downgrade.
- Choose a compatible `IMAGE_TAG` in `.env` before starting restored services. Hold the lock during recovery so jobs cannot mutate the restored database.

```bash
sudo systemctl stop slidesage-maintenance.timer slidesage-backup.timer
# Hold this lock in the same shell for the entire restore.
exec 9>.deploy.lock
flock 9
docker compose stop api worker
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl --exit-on-error' < backups/<dump>
# Set IMAGE_TAG to a release compatible with the restored schema.
docker compose up --detach --wait postgres valkey converter
# Restore does not run migrations. Start only the matching runtime images.
docker compose up --detach --no-deps --force-recreate --wait nginx api worker
docker compose exec -T nginx wget -q -O /dev/null http://api:8000/health
docker compose exec -T nginx wget -q -O /dev/null http://worker:8080/ready
# Clear the failed-cutover guard only after restored services are ready.
rm -f .deploy-incomplete
flock --unlock 9
sudo systemctl start slidesage-maintenance.timer slidesage-backup.timer
```

- Restore failures can leave a partly restored database. Keep runtimes stopped and investigate before proceeding.
