# Production infrastructure

- One x86-64 VPS runs the React frontend, Nginx, Go API, continuous generation worker, card converter, PostgreSQL 18 with pgvector, and Valkey through `infra/compose.json`.
- Nginx serves the frontend baked into the `web` image and proxies `api.slidesage.app` to the private API port. Cloudflare provides DNS and edge TLS. The frontend has no Cloudflare Pages deployment.
- Terraform configuration and its CI jobs have been removed. Provision the VPS, DNS records, origin certificate, and existing GCS bucket access manually.
- GitHub Actions publishes five commit-tagged images to GHCR and deploys over SSH. All application components use the same release tag.

| Resource | Configuration |
| --- | --- |
| Nginx and frontend | Ports 80 and 443, Cloudflare sources only, SPA fallback and static asset caching |
| API | Internal port 8000, 512 MiB limit, `GOMEMLIMIT=400MiB` |
| Generation worker | Continuous River client, 1 GiB limit, no published port |
| Converter | Internal port 8090, no secrets or internet route |
| PostgreSQL | Persistent `postgres-data` volume, no published port |
| Valkey | Password auth, disposable read cache, no published port |
| Migrate | Runs to completion before API and worker start |
| Maintenance | Systemd timer every 15 minutes, shares the release lock |
| Backups | Verified custom-format database dumps before releases and daily |
| Card images | Existing private GCS bucket through a service-account key |

- Database dumps on the VPS need an off-server copy. Keep the existing image bucket and encryption keys when moving production data.
- Setup, DNS cutover, migration, and recovery are in [VPS deployment](VPS_DEPLOYMENT.md). Release configuration is in [CI/CD](CI_CD.md).
