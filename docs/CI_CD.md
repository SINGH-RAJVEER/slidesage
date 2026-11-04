# CI/CD

Pull requests into protected `main` and `dev` run application type checks, card/UI/web tests, edge controller and storage tests, Go integration tests against a migrated disposable PostgreSQL/Valkey pair, Go vet, application builds, workflow validation, database Compose validation, and a Wrangler dry run that builds the Container images. JSON syntax in workflow files preserves tab indentation. Keep the required `test-and-build` and `infrastructure` checks.

## Frontend on Pages

Cloudflare Pages owns the `slidesage` project's Git integration. Use the repository root, build command `bun install --frozen-lockfile && bun run build:web`, and output directory `apps/web/dist`. The root `wrangler.jsonc` declares that output. Set `BUN_VERSION=1.3.13` in Pages and ensure the build image has Node.js 24 for tooling. `apps/web/.env.production` defaults `VITE_API_URL` to `https://api.slidesage.app`; a Pages environment variable overrides it. The React app's `index.html` must be in the output root. A successful empty deployment is still a broken site.

Public Pages build values are declared in root `wrangler.jsonc`, including the production AdSense publisher. Preview variables omit AdSense. Wrangler is authoritative and overrides dashboard environment variables; GitHub repository variables no longer feed frontend builds. Keep secrets out of these public build settings. Keep preview origins out of production auth/CORS allowlists unless deliberately configured with a separate backend. Pages supplies SPA fallback when there is no top-level `404.html`; public `_headers` sets `nosniff` and immutable caching for fingerprinted assets. Sources: [Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).

## Backend on Containers

`apps/edge/wrangler.jsonc` deploys the edge Worker at `https://api.slidesage.app`, its private R2 binding, and two Container-backed Durable Objects. The same Linux amd64 image runs separate API and continuous generation instances. Each instance connects to Neon over TLS and runs a local converter. A one-minute Cron Trigger keeps both instances available and restarts failed instances. The worker performs maintenance every 15 minutes.

`.github/workflows/deploy.yml` deploys automatically on pushes to `main`, including merged pull requests. It can also be dispatched manually on `main` after confirming `database_prepared`. After checking out the release, it runs the Goose and River migrations against Neon before installing frontend tooling, building, or deploying. A migration failure stops the job and leaves the existing Worker version in place; earlier migrations may already have committed. After success, the workflow builds and publishes the image and Worker, then checks public health and frontend CORS. It does not upload runtime secrets or change Pages settings. Confirm schema compatibility and runtime secrets before merging; production deployment follows the merge automatically.

Configure the `cloudflare-production` GitHub environment with secrets `CLOUDFLARE_API_TOKEN` and `NEON_DIRECT_DATABASE_URL`, and variable `CLOUDFLARE_ACCOUNT_ID`. The Neon URL must use the direct, non-pooled endpoint and TLS with `sslmode=verify-full`; keep it out of logs and repository files. Restrict the environment to protected `main`. The account needs Workers Paid, Containers, Durable Objects, and enabled R2. Runtime secrets are uploaded directly with Wrangler; neither workflow secret is included in an application image.

```bash
bun install --frozen-lockfile
just binaries
bun run --cwd apps/edge check
# After checking migration compatibility and runtime secrets:
gh workflow run deploy.yml --ref main -f database_prepared=true
```

Local manual deployment is `just deploy-backend`, after the same prerequisites. Run Wrangler with Node.js on PATH; Bun remains the package manager. A dry run builds locally and does not publish to Cloudflare.

## Schema changes and rollback

The release workflow applies migrations once before deploying. The existing API and worker continue running while migrations execute, so automatic migrations must remain backward-compatible with them. Stage incompatible changes across releases, or arrange a maintenance window with application writers stopped before migration and deployment. The workflow concurrency group serializes release jobs, but does not prevent manual migrations or other database writers. Individual migrations may commit before a later migration fails; inspect the schema and restore or repair deliberately before retrying. Use Neon point-in-time recovery or a verified backup as appropriate. For a separate manual migration, `infra/migrate.sh /absolute/path/to/migrate /path/to/database-url` reads the direct URL from a private file. Automatic Container startup never races to migrate the schema.

A release is qualified only after public API health, cookie auth from Pages, outline and worker generation, progress streaming, image persistence after container replacement, and PPTX export pass. A green workflow alone does not prove those paths. Container updates drain the old role before starting its replacement; River jobs can resume through PostgreSQL after interruption. A rollback must use code compatible with the database schema and preserve R2 images created since cutover.
