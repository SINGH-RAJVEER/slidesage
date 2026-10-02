locals {
  presentation_gcs_bucket = coalesce(var.presentation_gcs_bucket, "${var.gcp_project_id}-presentation-revisions")
}

# Keep the legacy resource address and bucket name. Card images live here.
resource "google_storage_bucket" "presentation_revisions" {
  project                     = var.gcp_project_id
  name                        = local.presentation_gcs_bucket
  location                    = var.gcp_region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  depends_on = [google_project_service.required]
}

# API and worker create image objects. Document revisions now live in PostgreSQL.
resource "google_storage_bucket_iam_member" "runtime_revision_creator" {
  bucket = google_storage_bucket.presentation_revisions.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# API/worker image reads, and the listing the migration job's purge walks.
resource "google_storage_bucket_iam_member" "runtime_revision_viewer" {
  bucket = google_storage_bucket.presentation_revisions.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# The migration job deletes what the retired pipelines left: PPTX revisions,
# their preview renders, and card bodies stored before PostgreSQL. The runtime
# account may delete only under those prefixes, so images stay create-and-read.
resource "google_storage_bucket_iam_member" "runtime_legacy_object_cleaner" {
  bucket = google_storage_bucket.presentation_revisions.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.runtime.email}"

  condition {
    title       = "legacy-presentation-objects"
    description = "PPTX revisions, preview renders, and pre-PostgreSQL card bodies"
    # IAM Conditions supports extract(), not regular-expression matches().
    # Equal captures require the legacy directory immediately after one ID.
    expression = <<-EOT
      resource.name.startsWith('projects/_/buckets/${google_storage_bucket.presentation_revisions.name}/objects/presentations/') &&
      resource.name.extract('/objects/presentations/{id}/') != '' &&
      (
        resource.name.extract('/objects/presentations/{id}/') == resource.name.extract('/objects/presentations/{id}/objects/') ||
        resource.name.extract('/objects/presentations/{id}/') == resource.name.extract('/objects/presentations/{id}/revisions/') ||
        resource.name.extract('/objects/presentations/{id}/') == resource.name.extract('/objects/presentations/{id}/cards/')
      )
    EOT
  }
}
