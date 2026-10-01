# Production infrastructure

`infra/prod` defines the production Google Cloud and Cloudflare resources. These changes are on `dev` and reach production through a merged `dev`-to-`main` PR. The workflow rejects non-main runs, including manual dispatches. None of it has been applied yet.

The September 7, 2026 read-only audit found the existing infrastructure was created outside Terraform. There was no state bucket in the project and this checkout had no initialized backend. The workflow in this workspace uses Terraform for main deployments so direct `gcloud run deploy` calls cannot overwrite its configuration. Cloudflare Pages continues to build the frontend independently from GitHub.

Terraform does not create secret values. It reads existing Secret Manager secrets and grants the Cloud Run runtime service account access to them. When `otel_exporter_otlp_endpoint` is set, this includes the `DATADOG_OTLP_HEADERS` secret used for direct Datadog intake.

## Cloud SQL connectivity

The API, worker, and migration job connect through the Cloud SQL Unix socket at `/cloudsql/<project>:<region>:<instance>`. `DATABASE_URL` must use that socket path and be stored in Secret Manager. Create the application database role and rotate its password outside Terraform so credentials never enter Terraform state.

## Resources

- Artifact Registry repository `slidesage` in `asia-south1`
- Cloud Run service `api`, public only through the external HTTPS load balancer, with a localhost Bun card converter sidecar
- Cloud Run service `worker`, with its own localhost card converter sidecar, retaining one minimum instance for the first request-lease rollout and capable of scaling from zero to ten after verification. Same-project Cloud Tasks reaches its default URL through internal ingress, and IAM grants invocation only to the runtime service account
- Cloud Tasks queue `worker-wake`, carrying the signal that starts a worker after a submission commits
- Cloud Run job `slidesage-maintenance`, running `cmd/worker --maintenance` on a Cloud Scheduler trigger for recovery and cleanup
- Cloud Run job `slidesage-migrate`, invoked by deployment automation after an image update
- A single-zone Enterprise `db-f1-micro` Cloud SQL PostgreSQL 18 instance with 10 GB SSD storage, automatic disk growth disabled, no automated backups, and no point-in-time recovery
- Global external HTTPS load balancer and serverless NEG for `api`, with an HTTP listener that redirects to HTTPS
- Managed certificate for `api`, attached to the HTTPS proxy
- DNS-only Cloudflare `api` record pointing to the load balancer address
- Existing Cloudflare Pages project `slidesage` and its apex domain. The live Pages API does not list `www`; attaching it is outside this adoption.
- Private GCS bucket for image assets and legacy document backfill; authoritative document bodies are PostgreSQL JSONB

Terraform manages the image/backfill bucket and grants the Cloud Run runtime account bucket-scoped object creator and viewer access. Keep the resource address `google_storage_bucket.presentation_revisions`, its IAM addresses, and its existing name. Override `presentation_gcs_bucket` when its name differs from the default. Both plan and deploy workflows accept the `PRESENTATION_GCS_BUCKET` repository variable and otherwise use `<project-id>-presentation-revisions`. Changing that name would replace a bucket containing images and legacy backfill sources. The existing template-origin bucket is not managed or deleted by this configuration. The URL map no longer routes `/pptx-templates/*` to the CDN backend. If the old backend bucket and bucket IAM grant are in Terraform state, the plan will propose destroying them. If they were never imported, they remain unused outside state and need separate cleanup.

Cloud SQL now holds the document bodies as well as revision metadata. This cutover preserves the existing database settings and relies on the workflow's verified on-demand pre-migration backup. The optional automated-backup, PITR, and disk-growth changes were removed to keep database configuration changes out of this release. Enabling PITR restarts an existing instance. Both the migration-job target and the Terraform maintenance-mode pause include Cloud SQL dependencies, so moving the pause apply earlier would not isolate the database update. Any future restart-producing database change needs a separate rollout that verifies a backup and independently quiesces API, worker, and the maintenance scheduler before applying. Monitor free space on the existing 10 GB disk before backfill. See Google's [PITR configuration](https://cloud.google.com/sql/docs/postgres/backup-recovery/configure-pitr).

Both Cloud Run services receive `CARD_CONVERTER_URL=http://127.0.0.1:8090`. Each converter listens on port 8090 for its startup probe, but only the Go container has an ingress port. Terraform injects `PEXELS_API_KEY` into the API and worker for stock-photo search and drafting. Setting `unsplash_enabled` (the `UNSPLASH_ENABLED` repository variable in the plan workflow) also injects `UNSPLASH_ACCESS_KEY`, which must exist in Secret Manager first. The converter has no secrets, public URL, or Cloud Run invoker binding of its own.

The API has `internal-and-cloud-load-balancing` ingress. Preserve the existing DNS-only API record and load balancer route. The URL map uses the live `api-matcher` name. The HTTPS proxy uses the API certificate.

Pages retains its live build command, `bun install --frozen-lockfile && bun run build`, build cache, and repository name `slide-sage`. That is the name the Pages API reports, while the local Git remote uses `slidesage`. Do not change the Git integration as a side effect of adoption.

## Bootstrap

Create the required Secret Manager secrets before the first plan. The names are listed in `infra/prod/main.tf`, and `data.google_secret_manager_secret` fails the plan for any name that does not exist. Payments are not optional, so the `RAZORPAY_*` secrets are listed alongside the rest. At minimum, production needs the values documented in [Environment variables](ENVIRONMENT_VARIABLES.md). Use a dedicated Terraform service account with permission to manage Cloud Run, Artifact Registry, Compute load balancing, service accounts, Secret Manager IAM bindings, and the enabled services.

To enable Datadog, create `DATADOG_OTLP_HEADERS` before setting `otel_exporter_otlp_endpoint`:

```bash
gcloud secrets create DATADOG_OTLP_HEADERS --replication-policy=automatic
printf '%s' 'dd-api-key=<api-key>,dd-otlp-source=serverless,compute_stats=true' \
	| gcloud secrets versions add DATADOG_OTLP_HEADERS --data-file=-
```

Set `otel_service_version` to the deployed commit SHA, which CI passes as `TF_VAR_otel_service_version`. See [Observability](OBSERVABILITY.md) for endpoint selection, log duplication, and Datadog views.

The Cloudflare token needs Zone Read, DNS Read/Edit for `slidesage.app`, and Pages Read/Edit for the account. The audit token could read Pages and the zone but was denied DNS-record access. The API record is discovered by hostname and imported automatically; do not invent its ID or replace it with a create operation to bypass missing permissions.

After merge and approval to provision infrastructure, create the versioned GCS state bucket outside this configuration using the commands in `infra/prod/backend.hcl.example`. Use `slidesage-504414-tfstate` with prefix `prod` consistently. The configuration cannot create its own backend bucket.

Set up Application Default Credentials for local Terraform, or supply a short-lived `GOOGLE_OAUTH_ACCESS_TOKEN` from an authorized gcloud session. A gcloud login alone does not provide ADC. CI uses the credential file exported by `google-github-actions/auth`.

Before the first production run, configure `TF_STATE_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN` in GitHub, in addition to the existing GCP workload-identity secrets. The CI identity must have Terraform's resource-management permissions and access to the state bucket; the old Cloud Run deploy permissions alone are insufficient.

```bash
cd infra/prod
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
# Replace every <commit-sha> with images already built for the release.
export TF_VAR_cloudflare_api_token="..."
terraform init -backend-config=backend.hcl
terraform validate
terraform plan -out=release.tfplan
# Review the complete plan. Applying is a separate production operation.
```

Keep `terraform.tfvars` out of version control if it includes values that do not belong in the example file.

## Deploying containers

Terraform expects immutable values for `api_image`, `worker_image`, `migrate_image`, and `converter_image`. Pass the commit-tagged Artifact Registry images after CI has pushed them. Update the job, run it, then update the services and their converter sidecars together.

```bash
terraform apply \
	-target=google_cloud_run_v2_job.migrate \
	-var="api_image=asia-south1-docker.pkg.dev/slidesage-504414/slidesage/api:$GITHUB_SHA" \
	-var="worker_image=asia-south1-docker.pkg.dev/slidesage-504414/slidesage/worker:$GITHUB_SHA" \
	-var="migrate_image=asia-south1-docker.pkg.dev/slidesage-504414/slidesage/migrate:$GITHUB_SHA" \
	-var="converter_image=asia-south1-docker.pkg.dev/slidesage-504414/slidesage/converter:$GITHUB_SHA"

gcloud run jobs execute slidesage-migrate \
	--project=slidesage-504414 \
	--region=asia-south1 \
	--wait

terraform apply \
	-var="api_image=asia-south1-docker.pkg.dev/slidesage-504414/slidesage/api:$GITHUB_SHA" \
	-var="worker_image=asia-south1-docker.pkg.dev/slidesage-504414/slidesage/worker:$GITHUB_SHA" \
	-var="migrate_image=asia-south1-docker.pkg.dev/slidesage-504414/slidesage/migrate:$GITHUB_SHA" \
	-var="converter_image=asia-south1-docker.pkg.dev/slidesage-504414/slidesage/converter:$GITHUB_SHA"
```

Run the migration job before releasing API and worker revisions that depend on the new schema.

For migration 33, use the deployment workflow's verified pre-migration backup and maintenance-mode pause of API, worker, and maintenance scheduler. The commands above show image deployment order only; they do not perform that pause. Old writers cannot insert revisions without JSONB bodies once Goose applies migration 33. `slidesage-migrate` receives `PRESENTATION_GCS_BUCKET` and its targeted apply includes bucket viewer IAM. The job allows 1200 seconds per attempt instead of 600 because legacy GCS fetches and database commits are serial. Its existing three retries remain; each resumes at missing bodies. This is extra headroom, not a throughput guarantee for an unmeasured dataset.

`cmd/migrate` runs Goose, imports missing bodies, validates the required-body constraint, and then runs River migrations. Legacy source size, digest, schema version, and card count must match. Missing or invalid objects stop deployment. Keep source objects and image bytes in the existing bucket; backfill deletes neither. A failed backfill leaves services paused. Repair source access or data and rerun the migration command before releasing runtimes. After success, document reads use JSONB without a GCS fallback. See [Card storage](CARD_DOCUMENTS.md#storage).

The main-only workflow first plans the whole configuration, then applies the migration-job target and runs the job. It re-plans the full release after migrations succeed because the targeted apply changed state. Terraform updates the service images and configuration; gcloud only executes the migration job and reads deployment status. Merging to `main` does not remove the bootstrap requirements above.

## Adopting an existing environment

This project's resources were originally created with the `gcloud` CLI, so the resource names in `edge.tf` follow that environment rather than a fresh Terraform naming scheme: the address is `slidesage-api-ip`, the backend service is `slidesage-api-backend`, the URL map is `slidesage-api-map`, the certificate is `slidesage-api-cert`, and the forwarding rules are `slidesage-api-http-rule` and `slidesage-api-https-rule`. Renaming any of these means replacing the resource, so leave them alone.

`infra/prod/imports.tf` adopts those resources into state. Run `terraform plan` and review every import, addition, update, and destroy. The retired template CDN backend and cache-fill IAM grant are the only expected destroys if they are already in state. A replacement or any other destroy means a name or argument may no longer match the live resource; fix the configuration before applying. Keep the import blocks until adoption has been verified.

Cloudflare Pages and apex imports use the configured account ID. The API DNS import looks up the existing A record using the zone and hostname. Import blocks can remain after adoption; Terraform skips addresses already in state.

Adoption is not a no-op release. The image/backfill bucket, runtime bucket permissions, and registry reader binding are additions only where not already managed. If the bucket already exists outside state, import it at `google_storage_bucket.presentation_revisions` before applying; do not replace it. The new application also needs converter sidecars, image storage and Pexels environment variables, migration-job source-bucket access, HTTP startup probes, worker EXA credentials, proxy-header handling, and Razorpay secret references. Those differences from the older live application are intentional and must be reviewed in the release plan. Existing Cloud SQL settings and migration retry settings are preserved.

The audit found `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` absent. Create them and populate their values through an approved secret-management step before release. Terraform deliberately fails planning when required secrets are missing; it does not create empty secret versions or silently disable payments.
