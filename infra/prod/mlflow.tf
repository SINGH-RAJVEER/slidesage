locals {
  mlflow_artifacts_bucket = coalesce(var.mlflow_artifacts_bucket, "${var.gcp_project_id}-mlflow-artifacts")
}

resource "google_sql_database" "mlflow" {
  name     = "mlflow"
  instance = google_sql_database_instance.primary.name
}

resource "google_storage_bucket" "mlflow_artifacts" {
  project                     = var.gcp_project_id
  name                        = local.mlflow_artifacts_bucket
  location                    = var.gcp_region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  depends_on = [google_project_service.required]
}

resource "google_service_account" "mlflow" {
  project      = var.gcp_project_id
  account_id   = "slidesage-mlflow"
  display_name = "SlideSage MLflow tracking server"
}

data "google_secret_manager_secret" "mlflow_database_url" {
  project   = var.gcp_project_id
  secret_id = "MLFLOW_DATABASE_URL"

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "mlflow_database_url" {
  project   = var.gcp_project_id
  secret_id = data.google_secret_manager_secret.mlflow_database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.mlflow.email}"
}

resource "google_project_iam_member" "mlflow_cloud_sql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.mlflow.email}"
}

resource "google_storage_bucket_iam_member" "mlflow_artifact_admin" {
  bucket = google_storage_bucket.mlflow_artifacts.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.mlflow.email}"
}

resource "google_cloud_run_v2_service" "mlflow" {
  name     = "mlflow"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_ALL"

  scaling {
    min_instance_count = 1
  }

  template {
    service_account                  = google_service_account.mlflow.email
    timeout                          = "300s"
    max_instance_request_concurrency = 20

    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = var.mlflow_image
      args = [
        "--host", "0.0.0.0",
        "--port", "5000",
        "--workers", "2",
        "--allowed-hosts", "*.run.app,localhost,127.0.0.1",
      ]

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      ports {
        container_port = 5000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "2Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "MLFLOW_ARTIFACTS_DESTINATION"
        value = "gs://${google_storage_bucket.mlflow_artifacts.name}"
      }
      env {
        name  = "MLFLOW_DISABLE_AGENT_HINT"
        value = "1"
      }
      env {
        name = "MLFLOW_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.mlflow_database_url.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 5000
        }
        failure_threshold     = 20
        period_seconds        = 5
        timeout_seconds       = 2
        initial_delay_seconds = 5
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.primary.connection_name]
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [
    google_project_iam_member.mlflow_cloud_sql_client,
    google_secret_manager_secret_iam_member.mlflow_database_url,
    google_storage_bucket_iam_member.mlflow_artifact_admin,
    google_sql_database.mlflow,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "worker_mlflow_invoker" {
  project  = var.gcp_project_id
  location = google_cloud_run_v2_service.mlflow.location
  name     = google_cloud_run_v2_service.mlflow.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.runtime.email}"
}
