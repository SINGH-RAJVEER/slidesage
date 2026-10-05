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

# Memorystore for Valkey only connects through Private Service Connect. The
# policy lets it reserve primary and reader endpoint addresses in this subnet.
resource "google_compute_subnetwork" "cache_endpoints" {
  count         = var.cache_enabled ? 1 : 0
  name          = "slidesage-cache-psc"
  region        = var.gcp_region
  network       = google_compute_network.cache[0].id
  ip_cidr_range = "10.83.0.0/28"
}

resource "google_network_connectivity_service_connection_policy" "cache" {
  count         = var.cache_enabled ? 1 : 0
  name          = "slidesage-cache"
  location      = var.gcp_region
  service_class = "gcp-memorystore"
  network       = google_compute_network.cache[0].id
  psc_config {
    subnetworks = [google_compute_subnetwork.cache_endpoints[0].id]
  }
  depends_on = [google_project_service.required]
}

resource "google_memorystore_instance" "cache" {
  count                       = var.cache_enabled ? 1 : 0
  instance_id                 = "slidesage-read-cache"
  location                    = var.gcp_region
  mode                        = "CLUSTER_DISABLED"
  shard_count                 = 1
  replica_count               = var.cache_replica_count
  node_type                   = var.cache_node_type
  engine_version              = "VALKEY_9_0"
  authorization_mode          = "IAM_AUTH"
  transit_encryption_mode     = "SERVER_AUTHENTICATION"
  deletion_protection_enabled = false
  engine_configs = {
    maxmemory-policy = "allkeys-lru"
  }
  desired_auto_created_endpoints {
    network    = google_compute_network.cache[0].id
    project_id = data.google_project.current.project_id
  }
  depends_on = [google_network_connectivity_service_connection_policy.cache]
}

# IAM authentication replaces a stored password: the runtime account presents
# its own access token when the API opens a connection.
resource "google_project_iam_member" "runtime_cache_connect" {
  count   = var.cache_enabled ? 1 : 0
  project = var.gcp_project_id
  role    = "roles/memorystore.dbConnectionUser"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

locals {
  # The reader endpoint rejects writes, so the API uses only the primary.
  cache_primary_endpoint = var.cache_enabled ? one(flatten([
    for endpoint in google_memorystore_instance.cache[0].endpoints : [
      for connection in endpoint.connections : [
        for psc in connection.psc_auto_connection : psc if psc.connection_type == "CONNECTION_TYPE_PRIMARY"
      ]
    ]
  ])) : null

  cache_environment = var.cache_enabled ? {
    CACHE_VALKEY_ADDR = "${local.cache_primary_endpoint.ip_address}:${local.cache_primary_endpoint.port}"
    CACHE_VALKEY_AUTH = "iam"
    CACHE_VALKEY_CA_PEM = join("\n", flatten([
      for server_ca in google_memorystore_instance.cache[0].managed_server_ca : [
        for chain in server_ca.ca_certs : chain.certificates
      ]
    ]))
    CACHE_TIMEOUT_MS = "100"
  } : {}
}
