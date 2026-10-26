# Production infrastructure

The prepared deployment puts the React frontend on Cloudflare Pages and the Go API and continuous River worker in Cloudflare Containers. PostgreSQL and pgvector stay on the existing VPS for the first cutover. This describes the target configuration; production cutover requires the checks in [Cloudflare deployment](CLOUDFLARE_DEPLOYMENT.md).

| Component | Configuration |
| --- | --- |
| Frontend | Pages project `slidesage`, domain `slidesage.app`, Vite output `apps/web/dist` |
| Public API | Edge Worker custom domain `api.slidesage.app`, fixed API Container on port 8000 |
| Generation | Fixed private generation Container, River jobs stored in PostgreSQL, readiness port 8080 |
| Converter | Separate loopback process in each application Container on port 8090 |
| PostgreSQL | Existing VPS volume `slidesage_postgres-data`, published only to VPS `127.0.0.1:15432` |
| Database connection | Dedicated SSH key restricted to forwarding that database port; pinned host key |
| Images | Private R2 bucket `slidesage-objects`, authenticated gateway, existing API authorization |
| Read cache | Disabled for the first cutover; PostgreSQL remains authoritative |
| Lifecycle | One-minute Cloudflare Cron heartbeat, five-minute inactivity timeout, graceful image replacement |
| Maintenance | Generation worker runs recovery and cleanup every 15 minutes |
| Backups and migrations | Retained VPS backup timer and explicit `infra/migrate.sh` |

The current direct Container API uses `standard-1` instances. Each role also runs its own converter, so old Compose memory limits cannot be carried across without measurement. Containers are billed resources and their disks are ephemeral. See [Cloudflare limits](https://developers.cloudflare.com/containers/platform/limits/) and [lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/).

The VPS Compose configuration now declares PostgreSQL only. It retains the original database and image volume names so changing configuration does not delete data. Preserve the old image volume until its contents and the R2 copies are verified. Keep database backups off-server, preserve all auth/BYOK encryption keys, and retain old configuration for an intentional rollback. [VPS operations](VPS_DEPLOYMENT.md) covers the database; [CI/CD](CI_CD.md) covers releases.
