# Production infrastructure

The prepared deployment puts the React frontend on Cloudflare Pages and the Go API and continuous River worker in Cloudflare Containers. PostgreSQL and pgvector move to Neon. This describes the target configuration; production cutover requires the checks in [Cloudflare deployment](CLOUDFLARE_DEPLOYMENT.md).

| Component | Configuration |
| --- | --- |
| Frontend | Pages project `slidesage`, domain `slidesage.app`, Vite output `apps/web/dist` |
| Public API | Edge Worker custom domain `api.slidesage.app`, fixed API Container on port 8000 |
| Generation | Fixed private generation Container, River jobs stored in PostgreSQL, readiness port 8080 |
| Converter | Separate loopback process in each application Container on port 8090 |
| PostgreSQL | Neon project on PostgreSQL 18 with pgvector, restored from the final VPS dump |
| Database connection | Neon pooler host over TLS (`sslmode=require`), stored only in the `APP_ENV` Worker secret |
| Images | Private R2 bucket `slidesage-objects`, authenticated gateway, existing API authorization |
| Read cache | Disabled for the first cutover; PostgreSQL remains authoritative |
| Lifecycle | On demand: the API sleeps after five idle minutes, the worker exits after five minutes with an empty queue, graceful image replacement |
| Maintenance | Generation worker runs recovery and cleanup on start and every 15 minutes while up; a six-hourly Cron starts it |
| Backups and migrations | Neon point-in-time restore and explicit `infra/migrate.sh` through the direct host |

Both roles use `lite` instances (1/16 vCPU, 256 MiB, 2 GB disk). Measured peaks, converter included, were under 64 MiB of memory and 50 MB of disk on `standard-1`; recheck peak memory from `containersMetricsAdaptiveGroups` after real generations and raise only a role that approaches the limit. Containers are billed resources and their disks are ephemeral. See [Cloudflare limits](https://developers.cloudflare.com/containers/platform/limits/) and [lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/).

The VPS keeps its PostgreSQL volume only as the rollback source until the rollback window closes, and the old image volume until its R2 copies are verified. Keep database backups off-server, preserve all auth/BYOK encryption keys, and retain old configuration for an intentional rollback. [VPS operations](VPS_DEPLOYMENT.md) covers the retained VPS and database recovery; [CI/CD](CI_CD.md) covers releases.
