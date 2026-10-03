# Production infrastructure

`infra/prod` defines the production Google Cloud and Cloudflare resources. Changes reach production through a merged `dev`-to-`main` PR. The workflow rejects non-main runs, including manual dispatches. Terraform adoption has been applied; the October 3, 2026 authenticated production plan found no changes using the deployed images and telemetry settings.

The September 7, 2026 read-only audit found the existing infrastructure was created outside Terraform. There was no state bucket in the project and this checkout had no initialized backend. The workflow in this workspace uses Terraform for main deployments so direct `gcloud run deploy` calls cannot overwrite its configuration. Cloudflare Pages continues to build the frontend independently from GitHub.

Terraform does not create secret values. It reads existing Secret Manager secrets and grants the Cloud Run runtime service account access to them. When `otel_exporter_otlp_endpoint` is set, this includes the `DATADOG_OTLP_HEADERS` secret used for direct Datadog intake.

## Cloud SQL connectivity

The API, worker, and migration job connect through the Cloud SQL Unix socket at `/cloudsql/<project>:<region>:<instance>`. `DATABASE_URL` must use that socket path and be stored in Secret Manager. Create the application database role and rotate its password outside Terraform so credentials never enter Terraform state.

## Resources

- Artifact Registry repository `slidesage` in `asia-south1`
- Cloud Run service `api`, public only through the external HTTPS load balancer, with a localhost Bun card converter sidecar
- Cloud Run service `worker`, with its own localhost card converter sidecar, scaling from zero to ten request-owned River clients. Same-project Cloud Tasks reaches its default URL through internal ingress, and IAM grants invocation only to the runtime service account
- Cloud Tasks queue `worker-wake`, carrying the signal that starts a worker after a submission commits
- Cloud Run job `slidesage-maintenance`, running `cmd/worker --maintenance` on a Cloud Scheduler trigger for recovery and cleanup
- Cloud Run job `slidesage-migrate`, invoked by deployment automation after an image update
- A single-zone Enterprise `db-f1-micro` Cloud SQL PostgreSQL 18 instance with 10 GB SSD storage, automatic disk growth disabled, no automated backups, and no point-in-time recovery
- Global external HTTPS load balancer and serverless NEG for `api`, with an HTTP listener that redirects to HTTPS
- Managed certificate for `api`, attached to the HTTPS proxy
- DNS-only Cloudflare `api` record pointing to the load balancer address
- Existing Cloudflare Pages project `slidesage` and its apex domain. The live Pages API does not list `www`; attaching it is outside this adoption.
- Private GCS bucket for card image assets; document bodies are PostgreSQL JSONB

Terraform manages the image bucket and grants the Cloud Run runtime account bucket-scoped object creator and viewer access. A third, conditional grant of `roles/storage.objectUser` lets the same account delete objects only under `presentations/<id>/objects/`, `revisions/`, and `cards/`, the prefixes the retired PPTX and pre-PostgreSQL card formats used. The migration job uses it to delete those objects; image assets stay create-and-read. Keep the resource address `google_storage_bucket.presentation_revisions`, its IAM addresses, and its existing name. Override `presentation_gcs_bucket` when its name differs from the default. Both plan and deploy workflows accept the `PRESENTATION_GCS_BUCKET` repository variable and otherwise use `<project-id>-presentation-revisions`. Changing that name would replace a bucket containing images. The URL map no longer routes `/pptx-templates/*` to the CDN backend. The October 2 deployment deleted the retired `templates` backend bucket. Resources outside Terraform state require an inventory and separate cleanup; a no-change plan alone does not prove that those resources are absent.

Cloud SQL now holds the document bodies as well as revision metadata. This cutover preserves the existing database settings and relies on the workflow's verified on-demand pre-migration backup. The optional automated-backup, PITR, and disk-growth changes were removed to keep database configuration changes out of this release. Enabling PITR restarts an existing instance. Both the migration-job target and the Terraform maintenance-mode pause include Cloud SQL dependencies, so moving the pause apply earlier would not isolate the database update. Any future restart-producing database change needs a separate rollout that verifies a backup and independently quiesces API, worker, and the maintenance scheduler before applying. See Google's [PITR configuration](https://cloud.google.com/sql/docs/postgres/backup-recovery/configure-pitr).

Both Cloud Run services receive `CARD_CONVERTER_URL=http://127.0.0.1:8090`. Each converter listens on port 8090 for its startup probe, but only the Go container has an ingress port. Terraform's `unsplash_enabled` boolean defaults to `false`. Both plan and deploy workflows pass the `UNSPLASH_ENABLED` repository variable as `TF_VAR_unsplash_enabled`, defaulting to `false` when unset. While false, Terraform neither looks up `UNSPLASH_ACCESS_KEY` nor injects it into the API or worker. Without the key, generation drafts text-only decks and stock routes return `503`; image uploads remain available. Unsplash remains the only stock-photo provider. The converter has no secrets, public URL, or Cloud Run invoker binding of its own. The API sets `GOMEMLIMIT=400MiB` under its 512 MiB limit, so the Go runtime collects garbage harder before the container runs out; image decodes are budgeted to fit under it.

The API has `internal-and-cloud-load-balancing` ingress. Preserve the existing DNS-only API record and load balancer route. The URL map uses the live `api-matcher` name. The HTTPS proxy uses the API certificate.

Pages retains its live build command, `bun install --frozen-lockfile && bun run build`, build cache, and repository name `slide-sage`. That is the name the Pages API reports, while the local Git remote uses `slidesage`. Do not change the Git integration as a side effect of adoption.

## Bootstrap

Create the required Secret Manager secrets before the first plan. The names are listed in `infra/prod/main.tf`, and `data.google_secret_manager_secret` fails the plan for any name that does not exist. Payments are not optional, so the `RAZORPAY_*` secrets are listed alongside the rest. At minimum, production needs the values documented in [Environment variables](ENVIRONMENT_VARIABLES.md). Use a dedicated Terraform service account with permission to manage Cloud Run, Artifact Registry, Compute load balancing, service accounts, Secret Manager IAM bindings, and the enabled services.

Leave `UNSPLASH_ACCESS_KEY` out and `unsplash_enabled=false` for now; the secret is not required for planning or deployment while disabled. To enable stock photos later, first provision `UNSPLASH_ACCESS_KEY` with an enabled Secret Manager version available as `latest`. Then set the `UNSPLASH_ENABLED` repository variable to `true` and deploy. Terraform then looks up the secret, grants runtime access, and injects it into both services.

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

Use the deployment workflow's verified pre-migration backup and maintenance-mode pause of API, worker, and maintenance scheduler. The commands above show image deployment order only; they do not perform that pause.

`cmd/migrate` runs Goose and River migrations, then deletes the retired objects from `PRESENTATION_GCS_BUCKET`. `slidesage-migrate` receives the bucket name, and its targeted apply includes the viewer and conditional delete grants. A failed sweep is logged without failing the job, and the next run deletes whatever is left. The job allows 1200 seconds per attempt and three retries.

The conditional bucket grant uses IAM-supported `startsWith()` and `extract()` comparisons, not regular-expression `matches()`, which IAM rejects at apply time. The condition anchors the bucket's presentation prefix and checks that `objects/`, `revisions/`, or `cards/` immediately follows one nonempty presentation ID. Paths under `assets/`, including names containing a later legacy directory, do not receive deletion access. Validate condition changes with `gcloud alpha iam policies lint-condition`; Terraform validation alone does not compile IAM expressions.

Migrations 35 and 36 delete data that only the pre-migration backup holds. Migration 35 deletes every presentation without a card document, which in production is every deck made before card documents, and drops the pgvector tables and extension. Migration 36 overwrites unsalted SHA-256 and PBKDF2 password hashes, so those users must reset their password. Deleted bucket objects are recoverable only within the bucket's soft-delete retention. See [Card storage](CARD_DOCUMENTS.md#storage).

The main-only workflow first plans the whole configuration, then applies the migration-job target and runs the job. It re-plans the full release after migrations succeed because the targeted apply changed state. Terraform updates the service images and configuration; gcloud only executes the migration job and reads deployment status. Merging to `main` does not remove the bootstrap requirements above.

## Adopting an existing environment

This project's resources were originally created with the `gcloud` CLI, so the resource names in `edge.tf` follow that environment rather than a fresh Terraform naming scheme: the address is `slidesage-api-ip`, the backend service is `slidesage-api-backend`, the URL map is `slidesage-api-map`, the certificate is `slidesage-api-cert`, and the forwarding rules are `slidesage-api-http-rule` and `slidesage-api-https-rule`. Renaming any of these means replacing the resource, so leave them alone.

`infra/prod/imports.tf` adopts those resources into state. Run `terraform plan` and review every import, addition, update, and destroy. The retired template CDN backend and cache-fill IAM grant are the only expected destroys if they are already in state. A replacement or any other destroy means a name or argument may no longer match the live resource; fix the configuration before applying. Keep the import blocks until adoption has been verified.

Cloudflare Pages and apex imports use the configured account ID. The API DNS import looks up the existing A record using the zone and hostname. Import blocks can remain after adoption; Terraform skips addresses already in state.

Adoption is not a no-op release. The image bucket, runtime bucket permissions, and registry reader binding are additions only where not already managed. If the bucket already exists outside state, import it at `google_storage_bucket.presentation_revisions` before applying; do not replace it. The new application also needs converter sidecars, image storage environment variables, migration-job bucket access, HTTP startup probes, worker EXA credentials, proxy-header handling, and Razorpay secret references. Leave Unsplash disabled for adoption; no Unsplash key lookup or injection is required with `unsplash_enabled=false`. Those differences from the older live application are intentional and must be reviewed in the release plan. Existing Cloud SQL settings and migration retry settings are preserved.

The September 7 audit found `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` absent. The October 3 production audit confirmed that all three now exist and are referenced by the deployed API. Terraform deliberately fails planning when required secrets are missing; it does not create empty secret versions or silently disable payments.

## Production verification and cleanup, October 3, 2026

[Deployment run 37049162276](https://github.com/SINGH-RAJVEER/slidesage/actions/runs/37049162276) successfully deployed commit `d1b22db42ff535fd832acb2e0b177679aeae15ce` on October 2. Both Go services and their converter sidecars use that commit's images. API revision `api-00061-d57` and worker revision `worker-00068-5wp` are ready and receive all traffic. Cloudflare Pages production deployment `0dd6acdf-40d5-42e5-8b1d-e7a8327337fc` built the same commit successfully. The public API health endpoint and frontend both returned HTTP 200 during verification.

Migration execution `slidesage-migrate-tv7f7` completed successfully at Goose schema version 36 and logged `deleted 0 legacy objects`. Pre-release Cloud SQL backup `1790967204343` completed successfully. The two most recent scheduled maintenance executions also completed successfully. An authenticated full Terraform plan using the deployed image tags, telemetry endpoint, exporter mode, and service version reported no changes both before and after cleanup.

The deployment removed the retired `templates` CDN backend. The separate inventory and cleanup removed these unused resources outside the current configuration:

- GCS bucket `slidesage-504414-templates` and its retired template objects.
- Unattached certificate `slidesage-cdn-cert` and the `api.slidesage.app` Cloud Run domain mapping in `europe-west1`, which pointed to the retired `slidesage-api` service. The active API uses its Terraform-managed load balancer in `asia-south1`.
- Cloud Build connection `slidesage` and its `slidesage-github-oauthtoken-692a54` secret. It had no repositories or global/regional build triggers; production builds use GitHub Actions and Cloudflare Pages.
- Empty Artifact Registry repository `cloud-run-source-deploy` and retired `mlflow`, `preview`, and `slidesage-api` packages from the active registry. The `api`, `worker`, `migrate`, and `converter` packages remain.
- Secret Manager secrets `CDN_SIGNING_KEY_SECRET` and `MLFLOW_DATABASE_URL`, the obsolete Cloud SQL user `mlflow`, plus GitHub repository secret `CDN_SIGNING_KEY_SECRET` and variables `CDN_URL` and `CDN_SIGNING_KEY_NAME`.
The owner also confirmed Gemini-restricted Google API key `main` is legacy. The delete operation reported it was already deleted, so no active key was removed. Cloud Asset Inventory can still include retained deletion metadata.

Terraform's resource list is not the complete list of required project resources. Keep the backend state bucket, externally provisioned runtime secret values and database credentials, GitHub workload identity and deploy permissions, Datadog integration, email DNS, recovery backups, release-image history, and Google-managed service infrastructure. These support the deployment even though this configuration does not create them.

Deployment health does not establish successful AI generation. At `2026-10-02T19:00:35Z`, an outline request returned HTTP 502. Correlated application logs showed OpenRouter selecting `inclusionai/ling-3.0-flash-sante` through Novita and rejecting the request because that model does not support structured outputs. This was an application/provider issue, not Terraform drift. A subsequent model-selection check pinned `qwen/qwen3.8-27b:free` in the server default, Terraform, and local environment example. Its streaming JSON probe using the production credential returned a valid three-slide outline and reported zero cost. The initial NVIDIA candidate was rejected by the account's zero-data-retention setting; that policy was preserved. This probe verifies the provider request contract, not a complete authenticated presentation-generation flow. No paid generation request was submitted during this audit.

The model-only Terraform apply completed with two service updates and no creates or deletes. API revision `api-00062-wrr` and worker revision `worker-00069-jlt` became ready with `OPEN_ROUTER_MODEL=qwen/qwen3.8-27b:free`; the existing application and converter images were preserved. Repository changes remain local until committed and merged, so a deployment from unchanged `main` can restore the old default.
