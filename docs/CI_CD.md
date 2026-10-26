# CI/CD

Pull requests into protected `main` and `dev` run application type checks, card/UI/web tests, edge controller and storage tests, Go integration tests against a migrated disposable PostgreSQL/Valkey pair, Go vet, application builds, workflow validation, database Compose validation, and a Wrangler dry run that builds the Container images. JSON syntax in workflow files preserves tab indentation. Keep the required `test-and-build` and `infrastructure` checks.

## Frontend on Pages

Cloudflare Pages owns the `slidesage` project's Git integration. Use the repository root, build command `bun install --frozen-lockfile && bun run build:web`, and output directory `apps/web/dist`. The root `wrangler.jsonc` declares that output. Set `BUN_VERSION=1.3.13` in Pages and ensure the build image has Node.js 24 for tooling. `apps/web/.env.production` defaults `VITE_API_URL` to `https://api.slidesage.app`; a Pages environment variable overrides it. The React app's `index.html` must be in the output root. A successful empty deployment is still a broken site.

Public Pages build values are declared in root `wrangler.jsonc`, including the production AdSense publisher. Preview variables omit AdSense. Wrangler is authoritative and overrides dashboard environment variables; GitHub repository variables no longer feed frontend builds. Keep secrets out of these public build settings. Keep preview origins out of production auth/CORS allowlists unless deliberately configured with a separate backend. Pages supplies SPA fallback when there is no top-level `404.html`; public `_headers` sets `nosniff` and immutable caching for fingerprinted assets. Sources: [Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).

## Backend on Containers

`apps/edge/wrangler.jsonc` deploys the edge Worker, private R2 binding, and two Container-backed Durable Objects. The same Linux amd64 image runs separate API and continuous generation instances. `cmd/container` starts each instance's restricted SSH database connection and local converter before its application. A one-minute Cron Trigger keeps both instances available and restarts failed instances. The worker performs maintenance every 15 minutes.

`.github/workflows/deploy.yml` is manual while this migration is being introduced. It runs only for `main` when the operator confirms `database_prepared`. It compiles the runtime, then uses Wrangler to build and publish the image and Worker. It does not migrate the production database, copy images, upload runtime secrets, provision SSH, or change Pages settings. Complete [the cutover runbook](CLOUDFLARE_DEPLOYMENT.md) first. There is no push-to-VPS deployment or frontend container build.

Configure the `cloudflare-production` GitHub environment with secret `CLOUDFLARE_API_TOKEN` and variable `CLOUDFLARE_ACCOUNT_ID`. Restrict it to protected `main`. The account needs Workers Paid, Containers, Durable Objects, and enabled R2. Runtime secrets are uploaded directly with Wrangler; the workflow token is never included in an application image.

```bash
bun install --frozen-lockfile
just binaries
bun run --cwd apps/edge check
# After the reviewed backup, migration, storage copy, and SSH preparation:
gh workflow run deploy.yml --ref main -f database_prepared=true
```

Local manual deployment is `just deploy-backend`, after the same prerequisites. Run Wrangler with Node.js on PATH; Bun remains the package manager. A dry run builds locally and does not publish to Cloudflare.

## Schema changes and rollback

Database migrations remain an explicit operation against the retained VPS PostgreSQL. `infra/migrate.sh /absolute/path/to/migrate` takes the database lock, creates a verified backup, and runs the compiled migration binary. Stop application writers before an incompatible migration. Automatic Container startup never races to migrate the schema.

A release is qualified only after public API health, cookie auth from Pages, outline and worker generation, progress streaming, image persistence after container replacement, and PPTX export pass. A green workflow alone does not prove those paths. Container updates drain the old role before starting its replacement; River jobs can resume through PostgreSQL after interruption. A rollback must use code compatible with the database schema and preserve R2 images created since cutover.
