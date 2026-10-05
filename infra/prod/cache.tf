resource "google_compute_network" "cache" {
  count                   = var.cache_enabled ? 1 : 0
  name                    = "slidesage-cache"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "cache" {
  count                    = var.cache_enabled ? 1 : 0
  name                     = "slidesage-cache-run"
  region                   = var.gcp_region
  network                  = google_compute_network.cache[0].id
  ip_cidr_range            = "10.81.0.0/26"
  private_ip_google_access = true
}

resource "google_redis_instance" "cache" {
  count                   = var.cache_enabled ? 1 : 0
  name                    = "slidesage-read-cache"
  region                  = var.gcp_region
  tier                    = var.cache_tier
  memory_size_gb          = var.cache_memory_gb
  redis_version           = "REDIS_7_2"
  authorized_network      = google_compute_network.cache[0].id
  connect_mode            = "DIRECT_PEERING"
  reserved_ip_range       = "10.82.0.0/29"
  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  redis_configs = {
    maxmemory-policy = "allkeys-lru"
  }
  depends_on = [google_project_service.required]
}

# Terraform manages this generated credential, unlike the existing application
# secrets. Never put the sensitive auth string directly into a Cloud Run env var.
resource "google_secret_manager_secret" "cache_password" {
  count     = var.cache_enabled ? 1 : 0
  secret_id = "CACHE_REDIS_PASSWORD"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "cache_password" {
  count       = var.cache_enabled ? 1 : 0
  secret      = google_secret_manager_secret.cache_password[0].id
  secret_data = google_redis_instance.cache[0].auth_string
}

resource "google_secret_manager_secret_iam_member" "cache_password" {
  count     = var.cache_enabled ? 1 : 0
  secret_id = google_secret_manager_secret.cache_password[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

locals {
  cache_environment = var.cache_enabled ? {
    CACHE_REDIS_ADDR   = "${google_redis_instance.cache[0].host}:${google_redis_instance.cache[0].port}"
    CACHE_REDIS_CA_PEM = join("\n", [for ca in google_redis_instance.cache[0].server_ca_certs : ca.cert])
    CACHE_TIMEOUT_MS   = "100"
  } : {}
}
