# MLflow

SlideSage uses MLflow for generation traces and later evaluation work. PostgreSQL and River remain the source of truth for generation jobs. Datadog remains the operational destination for traces, metrics, logs, dashboards, and alerts.

## Local development

`devenv up` starts MLflow at `http://127.0.0.1:5000`. It stores metadata in `$DEVENV_STATE/mlflow.db`, stores artifacts below `$DEVENV_STATE/mlflow-artifacts`, and points only the generation worker at experiment `0`. The API does not send its request traffic to the local MLflow process.

The local worker records provider metadata but not prompts or generated content. Set `MLFLOW_CAPTURE_CONTENT=true` in `.env` when a local trace needs the full provider exchange. The attributes belong to the shared OpenTelemetry span, so every configured trace destination receives them, including Datadog. Treat the resulting telemetry as private because presentation prompts and generated copy can contain user data.

## Trace structure

One River attempt produces a `generation.job` span. Each call made while drafting or repairing content adds a `gen_ai.chat` child span with these fields:

- `gen_ai.operation.name`
- `gen_ai.provider.name`
- `gen_ai.request.model`
- `gen_ai.request.max_tokens`
- `gen_ai.output.type`
- `gen_ai.prompt.name`
- `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` when available
- `slidesage.prompt.sha256`
- `slidesage.tokens.total`

Prompt names are `slot-draft`, `slot-repair`, `text-revision`, and `structural-revision`. The hash identifies the relevant static prompt instructions compiled into the worker without storing their text.

## Production deployment

Terraform creates an IAM-protected `mlflow` Cloud Run service, a separate `mlflow` database in the existing Cloud SQL instance, and a private GCS artifact bucket. The service runs one instance because MLflow performs database migrations during startup and this deployment does not need horizontal scaling yet.

The database credential stays out of Terraform state. For the first deployment, create the database first, create a PostgreSQL login with schema creation rights on it, then create the `MLFLOW_DATABASE_URL` Secret Manager secret and its first version before running the full plan and apply:

```shell
terraform -chdir=infra/prod apply -target=google_sql_database.mlflow
```

The secret value is a SQLAlchemy connection URI. For a Cloud SQL Unix socket it has this form:

```text
postgresql+psycopg2://USER:PASSWORD@/mlflow?host=/cloudsql/PROJECT:REGION:INSTANCE
```

Do not commit the URI or pass it as a normal Terraform variable. Terraform reads only the secret metadata and maps the latest secret version into the MLflow container.

The worker authenticates to the tracking server with a Google identity token. Terraform grants the SlideSage runtime service account `roles/run.invoker` on MLflow. The MLflow service has no `allUsers` binding. To open the UI from an operator machine, use an authenticated Cloud Run proxy:

```shell
gcloud run services proxy mlflow \
	--project="$PROJECT_ID" \
	--region=asia-south1 \
	--port=5000
```

Then open `http://127.0.0.1:5000`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `MLFLOW_TRACKING_URI` | Tracking server base URI. The exporter appends `/v1/traces`. |
| `MLFLOW_EXPERIMENT_ID` | Numeric experiment ID sent in `x-mlflow-experiment-id`. |
| `MLFLOW_WORKSPACE` | Optional MLflow workspace header. |
| `MLFLOW_GCP_AUDIENCE` | Cloud Run URI used as the identity-token audience. Leave empty for local HTTP. |
| `MLFLOW_CAPTURE_CONTENT` | Stores provider prompts and outputs when true. Defaults to false. |

MLflow export is independent of provider execution. Export happens through a batched OpenTelemetry processor after spans end. An unavailable tracking server can produce exporter errors during flush, but it does not fail or retry a presentation job.

## Validation

After deployment, generate one presentation and open the configured experiment. Confirm that the trace contains a `generation.job` span and at least one `gen_ai.chat` child. Check that the model, provider, prompt name, and token fields are present. Production traces must not contain `gen_ai.input.messages` or `gen_ai.output.messages` while `MLFLOW_CAPTURE_CONTENT=false`.
