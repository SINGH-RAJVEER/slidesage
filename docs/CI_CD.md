# CI/CD

- `.github/workflows/checks.yml` runs application checks. Path filtering selects Go or TypeScript checks, and unresolved comparisons run both. Documentation-only changes skip application suites.
- `.github/workflows/deploy.yml` runs checks on `main`, compiles three Linux amd64 Go binaries, bundles the converter, and builds the frontend with `VITE_API_URL=https://${API_DOMAIN}`.
- Docker Bake publishes `api`, `worker`, `migrate`, `converter`, and `web` to `ghcr.io/<lowercase-owner>/slidesage/<component>:<commit-sha>`. Deployments use SHA tags; `latest` is only a convenience tag.
- The `web` image contains Nginx and the built React app. There is no Pages build or Terraform stage.
- Go module and build caches are restored in checks and builds. Only non-PR checks write daily cache entries.

## Repository setup

| Setting | Type | Purpose |
| --- | --- | --- |
| `VPS_DEPLOY_ENABLED` | Variable | Set to `true` after server setup; otherwise CI builds images without deploying |
| `VPS_HOST` | Secret | VPS IPv4 address or SSH hostname |
| `VPS_USER` | Variable | SSH and timer user, defaults to `slidesage` |
| `VPS_SSH_KEY` | Secret | Private key authorized for the deploy user |
| `VPS_KNOWN_HOSTS` | Secret | Pinned SSH host key verified through the VPS console or another trusted channel |
| `WEB_DOMAIN` | Variable | Frontend hostname, defaults to `slidesage.app` |
| `API_DOMAIN` | Variable | API hostname, defaults to `api.slidesage.app` |

- Actions uses `GITHUB_TOKEN` with `packages: write` to publish images. The VPS needs its own GHCR login with `read:packages` if packages are private.
- Match the workflow domains to the server `.env`. Changing `API_DOMAIN` requires a frontend rebuild because Vite embeds the URL.
- Production secrets remain in `/opt/slidesage/.env` and `secrets/gcs-key.json`. They are not copied by CI.
- A release syncs `infra/` without `--delete`, then invokes `/opt/slidesage/deploy.sh <commit-sha>`. Concurrent releases are serialized.
- After deployment CI checks public API health, frontend HTML, and a frontend client route.

## Migration cutover

1. Take the shared deployment lock. Pull the requested images and validate Nginx with the mounted certificate and templates before stopping application services.
2. Start database, cache, and converter dependencies and take a verified database backup.
3. Record the image tag, stop API and worker, and recreate the migration container. Wait for its exit code.
4. After migration succeeds, recreate Nginx, API, and worker. Check frontend container health, API health, and worker readiness.

- Maintenance and daily backup timers skip runs while the release lock is held.
- Migration failures leave API and worker stopped. `.deploy-incomplete` also blocks scheduled maintenance until a release or recovery succeeds. Inspect logs locally before attempting recovery.
- Migrations 35 and 36 remove data recoverable only from backups. Older binaries may not support the migrated schema.
- Roll back by deploying a compatible earlier tag across all five images. For incompatible schemas, stop runtimes and restore a pre-release dump first. [VPS recovery](VPS_DEPLOYMENT.md#recovery) includes the commands.

## Manual build

Run in the development shell from the release checkout:

```bash
bun install --frozen-lockfile
docker login ghcr.io
just binaries converter-bundle
just web-bundle https://api.slidesage.app
IMAGE_VERSION=<commit-sha> docker buildx bake -f docker-bake.hcl --push
rsync -a infra/ slidesage@<vps>:/opt/slidesage/
ssh slidesage@<vps> '/opt/slidesage/deploy.sh <commit-sha>'
```

- Set `REGISTRY` when publishing outside the default owner and match `IMAGE_REGISTRY` in the server `.env`.
- Building and pushing images does not deploy them. The server release script performs backup and migration.
