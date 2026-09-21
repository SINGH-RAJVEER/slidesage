locals {
  api_name     = "api"
  worker_name  = "worker"
  migrate_name = "slidesage-migrate"

  api_secret_names = toset([
    "DATABASE_URL",
    "AUTH_SECRET",
    "RATE_LIMIT_HASH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "EXA_API_KEY",
    "OPEN_ROUTER_API_KEY",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "CDN_SIGNING_KEY_SECRET",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
  ])

  worker_secret_names = toset([
    "DATABASE_URL",
    "EXA_API_KEY",
    "OPEN_ROUTER_API_KEY",
    "CDN_SIGNING_KEY_SECRET",
  ])

  # Telemetry export is opt-in: with no endpoint the services keep their local
  # loggers and Terraform never asks for the Datadog headers secret.
  observability_enabled = trimspace(var.otel_exporter_otlp_endpoint) != ""
  observability_environment = local.observability_enabled ? {
    OTEL_EXPORTER_OTLP_ENDPOINT = var.otel_exporter_otlp_endpoint
    OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
    OTEL_LOGS_EXPORTER          = var.otel_logs_exporter
    OTEL_SERVICE_VERSION        = var.otel_service_version
  } : {}
  observability_secret_names = local.observability_enabled ? toset(["DATADOG_OTLP_HEADERS"]) : toset([])

  runtime_secret_names = setunion(
    local.api_secret_names,
    local.worker_secret_names,
    local.observability_secret_names,
  )

  # Services the project already had before the wake signal was introduced.
  # Only these can be imported; the rest are enabled by the first apply.
  preexisting_services = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
  ])

  required_services = setunion(local.preexisting_services, toset([
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
  ]))
}

data "google_project" "current" {
  project_id = var.gcp_project_id
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.gcp_project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "containers" {
  project       = var.gcp_project_id
  location      = var.gcp_region
  repository_id = "slidesage"
  description   = "SlideSage api images"
  format        = "DOCKER"

  depends_on = [google_project_service.required]
}

resource "google_artifact_registry_repository_iam_member" "cloud_run_reader" {
  project    = var.gcp_project_id
  location   = google_artifact_registry_repository.containers.location
  repository = google_artifact_registry_repository.containers.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${data.google_project.current.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_service_account" "runtime" {
  project      = var.gcp_project_id
  account_id   = "slidesage-runtime"
  display_name = "SlideSage Cloud Run runtime"
}

data "google_secret_manager_secret" "runtime" {
  for_each  = local.runtime_secret_names
  project   = var.gcp_project_id
  secret_id = each.value

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  for_each  = data.google_secret_manager_secret.runtime
  project   = var.gcp_project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_run_v2_service" "api" {
  name     = local.api_name
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  # Preserve service-level scaling as well as revision-level limits.
  scaling {
    min_instance_count    = 0
    scaling_mode          = var.maintenance_mode ? "MANUAL" : "AUTOMATIC"
    manual_instance_count = var.maintenance_mode ? 0 : null
  }

  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = "300s"
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    containers {
      image = var.api_image

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      ports {
        container_port = 8000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "BASE_URL"
        value = "https://api.${var.domain_name}"
      }
      env {
        name  = "CORS_ORIGINS"
        value = "https://${var.domain_name},https://www.${var.domain_name},https://slidesage.pages.dev,https://slide-sage.pages.dev"
      }
      env {
        name  = "BETTER_AUTH_TRUSTED_ORIGINS"
        value = "https://${var.domain_name},https://www.${var.domain_name},https://slidesage.pages.dev,https://slide-sage.pages.dev"
      }
      env {
        name  = "TRUST_PROXY_HEADERS"
        value = "true"
      }
      env {
        name  = "OPEN_ROUTER_MODEL"
        value = var.open_router_model
      }
      env {
        name  = "OPEN_ROUTER_API_BASE"
        value = var.open_router_api_base
      }
      env {
        name  = "PRESENTATION_GCS_BUCKET"
        value = local.presentation_gcs_bucket
      }
      env {
        name  = "CDN_URL"
        value = var.cdn_url
      }
      env {
        name  = "CDN_SIGNING_KEY_NAME"
        value = var.cdn_signing_key_name
      }
      env {
        name  = "CDN_SIGNED_URL_TTL_SECONDS"
        value = tostring(var.cdn_signed_url_ttl_seconds)
      }
      env {
        name  = "WORKER_WAKE_URL"
        value = "${google_cloud_run_v2_service.worker.uri}/drain"
      }
      env {
        name  = "WORKER_WAKE_QUEUE"
        value = google_cloud_tasks_queue.worker_wake.id
      }
      env {
        name  = "WORKER_WAKE_SERVICE_ACCOUNT"
        value = google_service_account.runtime.email
      }
      env {
        name  = "WORKER_WAKE_DEADLINE_SECONDS"
        value = tostring(var.worker_wake_deadline_seconds)
      }

      dynamic "env" {
        for_each = local.observability_environment
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.observability_secret_names
        content {
          name = "OTEL_EXPORTER_OTLP_HEADERS"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.runtime[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = local.api_secret_names
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.runtime[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 8000
        }
        failure_threshold     = 10
        period_seconds        = 3
        timeout_seconds       = 1
        initial_delay_seconds = 0
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.primary.connection_name]
      }
    }
  }

  # Client metadata describes the tool that last touched the resource.
  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime_accessor]
}

resource "google_cloud_run_v2_service" "worker" {
  name     = local.worker_name
  location = var.gcp_region

  # Same-project Cloud Tasks requests to the default run.app URL are internal.
  # Keep both network ingress and IAM restricted to the wake path.
  ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  # A committed river_job row is invisible to the autoscaler, so the API sends a
  # wake signal after each submission instead of a warm instance waiting on it.
  scaling {
    min_instance_count    = var.maintenance_mode ? 0 : var.worker_min_instances
    scaling_mode          = var.maintenance_mode ? "MANUAL" : "AUTOMATIC"
    manual_instance_count = var.maintenance_mode ? 0 : null
  }

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = 1

    # The drain request stays open for as long as the queue has work, because an
    # instance with no request in flight is a scale-down candidate however busy
    # River is. The timeout has to outlast both the job timeout and the deadline
    # Cloud Tasks holds the dispatch open for.
    timeout = "${var.worker_wake_deadline_seconds + 300}s"

    scaling {
      min_instance_count = var.maintenance_mode ? 0 : var.worker_min_instances
      max_instance_count = 10
    }

    containers {
      name  = "worker-1"
      image = var.worker_image

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "WORKER_CONCURRENCY"
        value = "1"
      }
      env {
        name  = "WORKER_REQUEST_LEASED"
        value = "true"
      }
      env {
        name  = "WORKER_DRAIN_ACCEPT_SECONDS"
        value = "1200"
      }
      env {
        name  = "WORKER_DRAIN_HANDOFF_SECONDS"
        value = "480"
      }
      env {
        name  = "BASE_URL"
        value = "https://api.${var.domain_name}"
      }
      env {
        name  = "OPEN_ROUTER_MODEL"
        value = var.open_router_model
      }
      env {
        name  = "OPEN_ROUTER_API_BASE"
        value = var.open_router_api_base
      }
      env {
        name  = "PRESENTATION_GCS_BUCKET"
        value = local.presentation_gcs_bucket
      }
      env {
        name  = "CDN_URL"
        value = var.cdn_url
      }
      env {
        name  = "CDN_SIGNING_KEY_NAME"
        value = var.cdn_signing_key_name
      }
      env {
        name  = "CDN_SIGNED_URL_TTL_SECONDS"
        value = tostring(var.cdn_signed_url_ttl_seconds)
      }

      dynamic "env" {
        for_each = local.observability_environment
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.observability_secret_names
        content {
          name = "OTEL_EXPORTER_OTLP_HEADERS"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.runtime[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = local.worker_secret_names
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.runtime[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/ready"
          port = 8080
        }
        failure_threshold     = 10
        period_seconds        = 3
        timeout_seconds       = 1
        initial_delay_seconds = 0
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.primary.connection_name]
      }
    }
  }

  # Client metadata describes the tool that last touched the resource.
  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime_accessor]
}

resource "google_cloud_run_v2_service_iam_member" "api_public_invoker" {
  project  = var.gcp_project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "migrate" {
  name     = local.migrate_name
  location = var.gcp_region

  template {
    template {
      service_account = google_service_account.runtime.email
      timeout         = "600s"
      max_retries     = 3

      containers {
        image = var.migrate_image

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.runtime["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.primary.connection_name]
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime_accessor]
}

# Wake signalling ------------------------------------------------------------
#
# A committed queue row is invisible to Cloud Run. Cloud Tasks carries the
# signal rather than the API calling the worker directly: it holds the drain
# request open for the life of the generation, and it retries if the worker was
# never reached. Production uses no minimum instance after verifying that an
# authenticated task can cold-start the worker and hold its drain lease.

resource "google_cloud_tasks_queue" "worker_wake" {
  project  = var.gcp_project_id
  name     = "worker-wake"
  location = var.gcp_region

  rate_limits {
    max_dispatches_per_second = 10
    max_concurrent_dispatches = 10
  }

  # A lost signal costs a deck its prompt start, never its existence, and the
  # scheduled sweep below is the backstop. Retrying a handful of times is enough.
  retry_config {
    max_attempts = 5
    min_backoff  = "1s"
    max_backoff  = "60s"
    # The first request may run for 28 minutes before asking Cloud Tasks to
    # retry it, so the retry window must extend beyond one complete lease.
    max_retry_duration = "3600s"
  }

  depends_on = [google_project_service.required]
}

# Creating a task that carries an OIDC token means acting as the identity in it.
resource "google_service_account_iam_member" "runtime_acts_as_itself" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_task_enqueuer" {
  project = var.gcp_project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Internal ingress admits same-project Cloud Tasks, and IAM still limits the
# authenticated caller to this runtime identity.
resource "google_cloud_run_v2_service_iam_member" "worker_wake_invoker" {
  project  = var.gcp_project_id
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

# Recovery and cleanup ------------------------------------------------------
#
# These ran on a ticker inside the always-on worker. A scaled-to-zero worker is
# not running to hold a ticker, and scheduling pings frequent enough to be one
# would keep an instance alive and undo the saving. A job bills only for the
# seconds it runs, with no idle tail, so the sweep moves here.

resource "google_cloud_run_v2_job" "maintenance" {
  name     = "slidesage-maintenance"
  location = var.gcp_region

  template {
    template {
      service_account = google_service_account.runtime.email
      timeout         = "600s"
      max_retries     = 1

      containers {
        image = var.worker_image
        args  = ["--maintenance"]

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.runtime["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }

        # The sweep re-wakes the worker when it finds queue rows nothing is
        # polling for, such as a River retry that came due while the service was
        # scaled away.
        env {
          name  = "WORKER_WAKE_URL"
          value = "${google_cloud_run_v2_service.worker.uri}/drain"
        }
        env {
          name  = "WORKER_WAKE_QUEUE"
          value = google_cloud_tasks_queue.worker_wake.id
        }
        env {
          name  = "WORKER_WAKE_SERVICE_ACCOUNT"
          value = google_service_account.runtime.email
        }
        env {
          name  = "WORKER_WAKE_DEADLINE_SECONDS"
          value = tostring(var.worker_wake_deadline_seconds)
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.primary.connection_name]
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime_accessor]
}

resource "google_cloud_run_v2_job_iam_member" "maintenance_invoker" {
  project  = var.gcp_project_id
  location = google_cloud_run_v2_job.maintenance.location
  name     = google_cloud_run_v2_job.maintenance.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_scheduler_job" "maintenance" {
  project     = var.gcp_project_id
  region      = var.gcp_region
  name        = "slidesage-maintenance"
  description = "Run the generation recovery and account cleanup sweep the worker no longer holds open."
  schedule    = var.maintenance_schedule
  time_zone   = "Etc/UTC"

  # A sweep firing mid-migration would start a worker against a half-migrated
  # schema, which is exactly what pausing the services is meant to prevent.
  paused = var.maintenance_mode

  http_target {
    http_method = "POST"
    uri         = "https://${var.gcp_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.gcp_project_id}/jobs/${google_cloud_run_v2_job.maintenance.name}:run"

    oauth_token {
      service_account_email = google_service_account.runtime.email
    }
  }

  depends_on = [
    google_project_service.required,
    google_cloud_run_v2_job_iam_member.maintenance_invoker,
  ]
}
