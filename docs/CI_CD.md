# CI/CD

- `.github/workflows/deploy.yml` builds and deploys API, worker, migration, and converter images.
- Releases run on pushes or manual dispatches to `main`. Other refs are rejected; production runs share one concurrency group.
- Cloudflare Pages builds the frontend independently from GitHub.

## Flow

1. Run checks, compile three Go binaries, and bundle the Bun converter.
2. Build four targets through `docker-bake.hcl` and push full-commit-SHA and `latest` tags.
3. Start an on-demand database backup while planning the complete Terraform configuration.
4. Verify backup completion, then update the migration job through a targeted apply.
5. Pause API, worker, and maintenance scheduler; run migrations and the retired-object sweep.
6. Create a fresh full plan and apply the release images, restoring automatic scaling.
7. Verify ingress and worker invocation restrictions.

- Terraform owns services, jobs, load balancing, and IAM. `gcloud` executes the migration job and reads deployment status.
- Deploy forwards `TF_VAR_api_image`, `TF_VAR_worker_image`, `TF_VAR_migrate_image`, and `TF_VAR_converter_image`.
- Bootstrap secrets, backend, credentials, and imports must exist before planning. See [Production infrastructure](PRODUCTION_INFRASTRUCTURE.md).

## Build caching

| Cache | Writer | Reader | Key |
| --- | --- | --- | --- |
| Go module/build | `checks.yml`, non-PR runs | Checks and deploy build | OS, `go.sum` hash, UTC date, with fallback prefixes |
| Pages build | Cloudflare Pages | Pages builds | Platform-managed |

- Disable `actions/setup-go` caching; explicit restore prefixes retain useful entries after dependency changes.
- Only checks writes Go entries. Daily keys limit churn; branch scope controls which entries are readable.
- PRs restore base-branch caches without saving merge-ref-only entries.
- Docker images copy prebuilt artifacts. `.dockerignore` limits context to `dist/`.
- Docker layers, BuildKit mounts, and Terraform providers are not cached in this workflow.
- Pages pins `BUN_VERSION` and enables `build_caching` in `infra/prod/edge.tf`.

### Path filtering

- API changes run Go checks; web changes run TypeScript checks. Converter, cards, shared contracts, and release-pipeline changes can trigger both.
- Documentation-only changes skip both application suites.
- PR comparison uses the base branch; push comparison uses the previous commit, with checkout depth 50.
- Unresolvable bases or filter failures run the complete suite.
- Filtering stays inside `test-and-build`, preserving the branch-protection check name.

## Artifact Registry layout

```text
asia-south1-docker.pkg.dev/<PROJECT_ID>/slidesage/<target>:<commit-sha>
asia-south1-docker.pkg.dev/<PROJECT_ID>/slidesage/<target>:latest
```

- Targets are `api`, `worker`, `migrate`, and `converter`. Terraform deploys SHA tags.
- Registry and Cloud Run use `asia-south1`; change `REGISTRY_LOCATION` and `RUN_REGION` in deploy configuration to move regions.
- Public API is `https://api.slidesage.app` through the HTTPS load balancer. Keep its DNS-only A record pointed at the reserved address.
- Pages builds with `bun install --frozen-lockfile && bun run build` from `apps/web`, producing `dist`.
- `public/_headers` sets `Cache-Control: no-cache`. Extra Browser TTL or Cache Everything rules can leave stale HTML referencing missing chunks.
- `vite:preloadError` triggers one reload for a removed chunk, then leaves repeated failure to the route error page.

## One-time GCP bootstrap

Set project and repository values before provisioning the CI identity:

```bash
PROJECT_ID=slidesage-504414
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
REPO_URL=SINGH-RAJVEER/slidesage

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

gcloud artifacts repositories create slidesage \
	--repository-format=docker \
	--location=asia-south1 \
	--project="$PROJECT_ID"

gcloud iam service-accounts create slidesage-deploy \
	--display-name="SlideSage CI deploy" \
	--project="$PROJECT_ID"

gcloud iam workload-identity-pools create slidesage \
	--location=global \
	--display-name="SlideSage CI pool" \
	--project="$PROJECT_ID"

gcloud iam workload-identity-pools providers create-oidc github \
	--location=global \
	--workload-identity-pool=slidesage \
	--issuer-uri=https://token.actions.githubusercontent.com \
	--attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.actor=assertion.actor" \
	--attribute-condition="attribute.repository == '$REPO_URL'" \
	--project="$PROJECT_ID"

gcloud iam service-accounts add-iam-policy-binding \
	"slidesage-deploy@$PROJECT_ID.iam.gserviceaccount.com" \
	--role=roles/iam.workloadIdentityUser \
	--member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/slidesage/attribute.repository/$REPO_URL"
```

- CI uses short-lived GitHub OIDC credentials, without service-account keys.
- Authorize the deploy identity for Terraform-managed Cloud Run, Cloud Tasks, Cloud Scheduler, Cloud SQL, Artifact Registry, Compute, service accounts, project services/IAM, Secret Manager IAM, and storage resources.
- Include runtime-account `actAs` and state-bucket object access. Image building requires `roles/artifactregistry.writer`.
- These commands create the identity; they do not grant the complete deployment permissions.
- Keep runtime and deployment accounts separate. Use [Bootstrap](PRODUCTION_INFRASTRUCTURE.md#bootstrap) for backend and resource adoption.

## GitHub repository setup

| Secret | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `slidesage-504414` |
| `GCP_WIF_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/slidesage/providers/github` |
| `GCP_SERVICE_ACCOUNT` | `slidesage-deploy@slidesage-504414.iam.gserviceaccount.com` |
| `TF_STATE_BUCKET` | `slidesage-504414-tfstate` |
| `CLOUDFLARE_ACCOUNT_ID` | Account containing Pages and the zone |
| `CLOUDFLARE_API_TOKEN` | Zone Read, DNS Read/Edit, Pages Read/Edit |

- `PRESENTATION_GCS_BUCKET` optionally overrides the existing image bucket name. Preserve that name.
- `UNSPLASH_ENABLED` defaults to `false`. [Production bootstrap](PRODUCTION_INFRASTRUCTURE.md#bootstrap) describes enabling stock photos.
- Datadog variables are documented in [Observability](OBSERVABILITY.md#datadog-on-cloud-run).

## Secret Manager

- Provision required secret values before planning. `infra/prod/main.tf` lists the names; [Environment variables](ENVIRONMENT_VARIABLES.md) explains their use.
- Required API secrets include database, auth, rate-limit hash, OAuth, Exa, OpenRouter, Resend, and all three Razorpay credentials.
- Missing Razorpay secrets fail planning and API startup.
- Use enabled `latest` versions. BYOK deployments also need encryption keys for API and worker.
- Unsplash and Datadog secrets are conditional on their deployment settings.
- Set provider OAuth callbacks to `https://api.slidesage.app/auth/callback/google` and `/github`.
- Change runtime configuration in Terraform. Direct service deployment can replace sidecars and will drift from the next plan.

## Cloud Run service settings

| Service | Port | Instances | HTTP concurrency | Runtime |
| --- | --- | --- | --- | --- |
| `api` | 8000 | 0 to 10 | 80 | API and private converter |
| `worker` | 8080 | 0 to 10 | 1 | Request-owned River client and private converter |

- Converters listen on localhost `8090` with no public port.
- Worker keeps `cpu_idle=false`; Cloud Tasks holds `/drain` while River owns claims.
- Monitor dispatch, queue latency, provider capacity, and database connections together.

### Ingress and invocation

| Resource | Ingress | Invocation |
| --- | --- | --- |
| `api` | `internal-and-cloud-load-balancing` | Public IAM access; application auth protects private routes |
| `worker` | `internal` | Runtime service account only, no `allUsers` binding |
| `slidesage-migrate` | Job, no service ingress | CI execution |

- API internet traffic passes through the load balancer; direct internet `run.app` traffic is blocked.
- Same-project Cloud Tasks invokes the private worker's default URL.
- Release checks assert ingress and absence of public worker invocation.

## Rollback

- Select earlier Cloud Run revisions only when their binaries support the current schema.
- GCS-only writers are incompatible after migration 33; writers using `object_key` are incompatible after migration 35.
- Migrations 33 and 35 refuse downgrade. Recovery requires a database restore with runtimes paused.
- Restore compatible API, worker, and converter versions together, then reconcile Terraform.

```bash
gcloud run services update-traffic api \
	--region=asia-south1 \
	--to-revisions="<compatible-api-revision>=100"

gcloud run services update-traffic worker \
	--region=asia-south1 \
	--to-revisions="<compatible-worker-revision>=100"
```

## Manual equivalents

Build and push images:

```bash
gcloud auth configure-docker asia-south1-docker.pkg.dev
just binaries
bun install --frozen-lockfile
just converter-bundle
PROJECT_ID=slidesage-504414 IMAGE_VERSION=dev docker buildx bake -f docker-bake.hcl --push
```

- These commands build images only. Use the release workflow for backup, pause, migrations, and runtime updates.

## Troubleshooting

- Registry `403`: configure Docker auth and verify Artifact Registry writer permission.
- `iam.serviceAccounts.actAs` denied: verify deploy identity can use the runtime account.
- WIF failure: verify provider/account paths and repository casing in the binding.
- Missing secret or DNS access: provision the secret or correct Cloudflare token permissions before applying.
- Missing dynamic chunk: remove custom Browser TTL/Cache Everything rules, verify `_headers`, and purge stale zone cache once.

## Migration cutover

- Every release starts an on-demand Cloud SQL backup and verifies its completion/error fields before the first apply.
- Update the migration job, then set API and worker to manual scaling with zero instances and pause the maintenance scheduler.
- Preserve old runtime images while paused. API is unavailable during cutover.
- Run migrations with a 20-minute attempt limit and three retries. The object sweep retains image assets; failures log without failing the release.
- After success, re-plan the full release and restore automatic scaling with new images.
- If migration or release apply fails, leave services paused while investigating. Old binaries may be incompatible with the changed schema.
- Database changes that restart Cloud SQL need a separate rollout with a verified backup and independent runtime/scheduler pause before the database apply.

| Migration | Destructive effect |
| --- | --- |
| 14 | Resets pre-launch user/accounting data |
| 25 | Deletes decks without committed PPTX revisions |
| 26 | Drops retired semantic memory and outline caches |
| 34 | Drops legacy PPTX revision rows; downgrade restores schema only |
| 35 | Deletes decks without card bodies and drops remaining pgvector tables; no downgrade |
| 36 | Replaces legacy password hashes; affected users must reset passwords |

- Recover deleted database data from the pre-release backup. GCS recovery depends on bucket retention.
- Storage details are in [Card storage](CARD_DOCUMENTS.md#storage).
