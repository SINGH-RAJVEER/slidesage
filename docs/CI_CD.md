# CI/CD

- `.github/workflows/checks.yml` runs every application suite on pull requests into `main` and `dev`. This includes TypeScript type checks, card/converter/UI/web tests, Go integration tests against a migrated disposable database and Valkey, `go vet`, and application builds. Pushes to `dev` use path filtering; unresolved comparisons run both application groups. Every run also validates Actions, shell scripts, Compose, Docker Bake, and Nginx with disposable credentials and a temporary certificate.
- `.github/workflows/deploy.yml` runs on pushes to `main` and manual dispatches with `main` selected. PR checks gate merging; deployment does not repeat them. It compiles three Linux amd64 release binaries, bundles the converter, and builds the frontend with the production `VITE_API_URL=https://${API_DOMAIN}` before publishing images. Other branches cannot deploy through this workflow.
- Docker Bake publishes `api`, `worker`, `migrate`, `converter`, and `web` to `ghcr.io/<lowercase-owner>/slidesage/<component>:<commit-sha>`. Deployments use SHA tags; `latest` is only a convenience tag.
- The `web` image contains Nginx and the built React app. GitHub builds and publishes the frontend together with the backend.
- Each image has its own GitHub Actions build cache. The deployment job records releases in the `vps-production` GitHub environment and writes the verified SHA to `/opt/slidesage/.deployed-release`.
- Go module and build caches are restored in checks and builds. Only non-PR checks write daily cache entries. PR builds verify compilation; deployment builds produce the stripped release binaries and frontend with its production API URL.
- Workflows use JSON syntax in `.yml` files, which is valid YAML and supports the repository's tab indentation rule.

- Go integration suites share one disposable database. CI and `bun run test:api` run packages sequentially with `-p 1` so a maintenance sweep cannot consume another package's deletion fixtures.

## Repository setup

| Setting | Type | Purpose |
| --- | --- | --- |
| `VPS_DEPLOY_ENABLED` | Variable | Set to `true` after server setup; otherwise CI builds images without deploying |
| `VPS_HOST` | Secret | VPS IPv4 address or SSH hostname |
| `VPS_USER` | Variable | SSH and timer user, defaults to `slidesage` |
| `VPS_PORT` | Variable | SSH port, defaults to `22` |
| `VPS_SSH_KEY` | Secret | Private key authorized for the deploy user |
| `VPS_KNOWN_HOSTS` | Secret | Pinned SSH host key verified through the VPS console or another trusted channel |
| `WEB_DOMAIN` | Variable | Frontend hostname, defaults to `slidesage.app` |
| `API_DOMAIN` | Variable | API hostname, defaults to `api.slidesage.app` |

- Actions uses `GITHUB_TOKEN` with `packages: write` to publish images. The VPS needs its own GHCR login with `read:packages` if packages are private.
- Match the workflow domains to the server `.env`. Changing `API_DOMAIN` requires a frontend rebuild because Vite embeds the URL.
- Production secrets remain in `/opt/slidesage/.env`. Image bytes remain in the existing `slidesage_objects` Docker volume mounted at `/data/objects`. CI copies neither secrets nor stored objects.
- A release uploads `infra/` into `/opt/slidesage/.releases/<sha>-<run>-<attempt>/`, excluding server state. `activate-release.sh` takes the shared deployment lock, checks the server registry and domains against the build, copies release files, and invokes `deploy.sh` under the same lock. Timers and manual releases cannot use files midway through sync. Failed uploads remain for inspection; successful uploads are removed after public checks.
- Missing SSH settings, unreadable credentials, unavailable Docker, or domain/registry mismatches fail the deployment. `VPS_DEPLOY_ENABLED` controls deployment only; image publishing still runs when it is unset or `false`.
- `main` requires a pull request with successful `test-and-build` and `infrastructure` checks from GitHub Actions. Strict status protection requires the PR branch to include current `main`, and administrators are subject to the same protections. No reviewer approval is required. These repository settings are enforced by GitHub and must be retained when recreating the repository; the workflow alone cannot block merging.
- Releases share one concurrency group with cancellation disabled, so a newer push cannot cancel a migration. The `vps-production` environment is restricted to the `main` branch. GitHub supports [environment restrictions and deployment concurrency](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments). Manual deployment rebuilds the protected `main` commit without rerunning the PR suite.
- After deployment CI checks public API health, frontend HTML, and a frontend client route.

Configure settings with an authenticated GitHub CLI. Keep the private key in a local file; do not paste it into repository files or shell arguments:

```bash
gh secret set VPS_HOST --repo SINGH-RAJVEER/slidesage --env vps-production
gh secret set VPS_SSH_KEY --repo SINGH-RAJVEER/slidesage --env vps-production < /path/to/deploy-key
gh secret set VPS_KNOWN_HOSTS --repo SINGH-RAJVEER/slidesage --env vps-production < /path/to/verified-known-hosts
gh variable set VPS_USER --repo SINGH-RAJVEER/slidesage --body slidesage
gh variable set VPS_PORT --repo SINGH-RAJVEER/slidesage --body 22
# Enable only after completing server setup and the first successful release.
gh variable set VPS_DEPLOY_ENABLED --repo SINGH-RAJVEER/slidesage --body true
```

- Verify the host key through the provider console before saving `VPS_KNOWN_HOSTS`. For a nondefault SSH port, its entry uses `[hostname]:port`. CI enforces `StrictHostKeyChecking=yes` and fails on an unknown or changed key.
- Store SSH secrets in the `vps-production` environment. Configure the deployment toggle, SSH user/port, and domains as repository variables so job conditions and builds can read them. Server application secrets, certificates, backups, and GHCR read credentials stay on the VPS.
- To rerun a failed release, use GitHub's rerun action. To manually build and deploy the current branch tip, select `main` under Actions or run `gh workflow run deploy.yml --repo SINGH-RAJVEER/slidesage --ref main`. The workflow must exist on the default branch for manual dispatch to be available. Pushes to `main` work independently.

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
ssh slidesage@<vps> 'mkdir -p /opt/slidesage/.releases/<commit-sha>'
rsync -a --exclude='.env' --exclude='certs/' --exclude='secrets/' --exclude='backups/' --exclude='.deploy*' infra/ slidesage@<vps>:/opt/slidesage/.releases/<commit-sha>/
ssh slidesage@<vps> '/opt/slidesage/.releases/<commit-sha>/activate-release.sh <commit-sha> ghcr.io/singh-rajveer/slidesage slidesage.app api.slidesage.app'
```

- Set `REGISTRY` when publishing outside the default owner and match `IMAGE_REGISTRY` in the server `.env`.
- Building and pushing images does not deploy them. The server release script performs backup and migration.
- Run `infra/check.sh` locally with Docker, Buildx, Compose, ShellCheck, and OpenSSL available. `infra/check.sh --config-only` validates without starting Nginx when Docker containers cannot run locally.
