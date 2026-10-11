# Production infrastructure

- `infra/prod` manages Google Cloud and Cloudflare resources. Merged `dev`-to-`main` changes deploy through the main-only workflow.
- Terraform reads existing Secret Manager values and grants runtime access; it does not create application credentials.
- Cloudflare Pages builds the frontend separately from GitHub.

## Cloud SQL connectivity

- API, worker, and migration job connect through `/cloudsql/<project>:<region>:<instance>`.
- Store a socket-based `DATABASE_URL` in Secret Manager.
- Create database roles and rotate passwords outside Terraform so credentials stay out of state.

## Resources

| Resource | Configuration |
| --- | --- |
| Artifact Registry | `slidesage`, `asia-south1` |
| Cloud Run `api` | External load balancer ingress, private converter sidecar |
| Cloud Run `worker` | Internal ingress, runtime-account invocation, private converter, 0 to 10 instances |
| Cloud Tasks `worker-wake` | Authenticated `/drain` signals after submission commits |
| Cloud Run `slidesage-maintenance` | Scheduled recovery and cleanup |
| Cloud Run `slidesage-migrate` | Release migrations and retired-object sweep |
| Cloud SQL | PostgreSQL 18, single-zone Enterprise `db-f1-micro`, 10 GB SSD |
| Load balancer | Global HTTPS, serverless API NEG, managed certificate, HTTP redirect |
| Cloudflare DNS | DNS-only API A record pointing to reserved load-balancer address |
| Cloudflare Pages | Existing `slidesage` project and apex domain |
| GCS | Private image bucket; document bodies remain in PostgreSQL JSONB |

- Cloud SQL automatic disk growth, automated backups, and PITR are disabled in this configuration. Releases take verified on-demand backups.
- Preserve bucket name and address `google_storage_bucket.presentation_revisions`, plus its IAM addresses. Renaming can replace stored images.
- `PRESENTATION_GCS_BUCKET` overrides the default `<project-id>-presentation-revisions` in both workflows.
- Runtime bucket permissions allow creation/reading of assets and deletion only under legacy `objects/`, `revisions/`, and `cards/` prefixes.
- Conditional deletion uses IAM `startsWith()` and `extract()`, not unsupported `matches()`. Validate changes with `gcloud alpha iam policies lint-condition`; Terraform validation does not compile these expressions.
- Optional Memorystore for Valkey and its VPC resources are disabled by default; GitHub `CACHE_ENABLED` controls provisioning. See [Database cache](DATABASE_CACHE.md#production).
- API memory limit is 512 MiB with `GOMEMLIMIT=400MiB`; image decoding uses a separate bounded budget.
- Converters have no secrets, public URLs, or invoker bindings and use localhost `8090`.
- Preserve `api-matcher`, managed API certificate, DNS-only record, and load-balancer routing.
- Pages retains repository name `slide-sage`, build cache, and `bun install --frozen-lockfile && bun run build`.

## Bootstrap

1. Provision required Secret Manager values from [Environment variables](ENVIRONMENT_VARIABLES.md) and names in `infra/prod/main.tf`. All Razorpay credentials are required.
2. Create a versioned state bucket using `infra/prod/backend.hcl.example`; backend is `slidesage-504414-tfstate` with prefix `prod`.
3. Authorize CI for Terraform resource management and backend access. [CI bootstrap](CI_CD.md#one-time-gcp-bootstrap) describes workload identity.
4. Configure GitHub GCP/WIF, state-bucket, and Cloudflare secrets listed in [Repository setup](CI_CD.md#github-repository-setup).
5. Initialize locally and review the complete plan, including imports.

```bash
cd infra/prod
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
# Set image values to already-built commit-tagged images.
export TF_VAR_cloudflare_api_token="..."
terraform init -backend-config=backend.hcl
terraform validate
terraform plan -out=release.tfplan
```

- Local Terraform requires ADC or short-lived `GOOGLE_OAUTH_ACCESS_TOKEN`; a gcloud login alone does not supply ADC. CI uses the exported auth credential file.
- Cloudflare token needs Zone Read, DNS Read/Edit, and Pages Read/Edit. Missing DNS access must be fixed rather than replacing the existing record.
- Keep private `terraform.tfvars` and credentials out of version control.
- Stock photos default to disabled. Provision enabled `UNSPLASH_ACCESS_KEY:latest`, then set GitHub `UNSPLASH_ENABLED=true` and deploy. Disabled plans skip the secret lookup/injection.
- For Datadog, provision `DATADOG_OTLP_HEADERS` before setting the endpoint. See [Observability](OBSERVABILITY.md#datadog-on-cloud-run).

## Deploying containers

1. Build API, worker, migration, and converter images from one commit and push immutable SHA tags.
2. Plan the full configuration and verify the pre-migration backup.
3. Apply the migration-job target and pause runtimes and scheduler.
4. Execute `slidesage-migrate` and wait for success.
5. Re-plan and apply the full release, restoring runtimes with matching images.

- Use [CI/CD](CI_CD.md) for the complete sequence. Image-only applies do not perform a safe migration cutover.
- `cmd/migrate` applies Goose and River, then sweeps legacy bucket objects. Its target includes viewer and conditional deletion IAM.
- The migration job allows 1200 seconds and three retries; failed object sweeps log without failing the job.
- Migrations 35 and 36 remove data recoverable only from backup. See [Migration cutover](CI_CD.md#migration-cutover).
- Database updates that restart Cloud SQL require a separate backup and independent API/worker/scheduler pause before applying. Terraform target dependencies can include Cloud SQL.

## Adopting an existing environment

- `imports.tf` adopts existing resources. Review every import, create, update, replacement, and destroy before applying.
- Preserve load-balancer names: `slidesage-api-ip`, `slidesage-api-backend`, `slidesage-api-map`, `slidesage-api-cert`, and HTTP/HTTPS forwarding rules.
- Cloudflare imports use account ID; API DNS imports discover the existing record by zone and hostname.
- Existing image buckets must import at `google_storage_bucket.presentation_revisions`; never replace them to bypass state or permission issues.
- Keep import blocks until adoption is verified. Terraform skips addresses already imported.
- Adoption can add sidecars, probes, runtime IAM, storage settings, provider credentials, and payment references. Review these against the live environment.
- Retired template CDN resources may be removed if still tracked; investigate every other unexpected destroy or replacement.

## Production verification and cleanup

- Check deployed image tags, service readiness, traffic, migration execution, backup completion, maintenance execution, and frontend deployment.
- Run an authenticated full Terraform plan with deployed images and telemetry settings to check managed drift.
- Test authenticated generation separately; a health response or provider probe does not establish the complete flow.
- Inventory resources outside Terraform state before cleanup. A no-change plan does not prove unmanaged resources are absent.
- Retain backend storage, runtime secret values, database credentials, workload identity, deploy permissions, Datadog integration, email DNS, backups, image history, and managed service infrastructure.
