variable "gcp_project_id" {
  description = "Google Cloud project that hosts the production backend."
  type        = string
}

variable "gcp_region" {
  description = "Cloud Run and Artifact Registry region."
  type        = string
  default     = "asia-south1"
}

variable "cache_enabled" {
  description = "Provision a private Memorystore read cache and attach the API through Direct VPC egress."
  type        = bool
  default     = false
}

variable "cache_tier" {
  description = "BASIC is a disposable single-node cache; STANDARD_HA adds automatic failover. Changing tier replaces the cache."
  type        = string
  default     = "BASIC"
  validation {
    condition     = contains(["BASIC", "STANDARD_HA"], var.cache_tier)
    error_message = "cache_tier must be BASIC or STANDARD_HA."
  }
}

variable "cache_memory_gb" {
  description = "Provisioned Memorystore capacity in GiB, billed even when idle."
  type        = number
  default     = 1
  validation {
    condition     = var.cache_memory_gb >= 1 && var.cache_memory_gb <= 300 && floor(var.cache_memory_gb) == var.cache_memory_gb
    error_message = "cache_memory_gb must be an integer between 1 and 300."
  }
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the Pages project."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone and Pages edit permissions. Supply through TF_VAR_cloudflare_api_token."
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "A Cloudflare-managed apex domain for the production web application."
  type        = string
  default     = "slidesage.app"
}

variable "github_owner" {
  description = "GitHub organization or user that owns the repository connected to Cloudflare Pages."
  type        = string
  default     = "SINGH-RAJVEER"
}

variable "github_repository" {
  description = "Repository name reported by the existing Cloudflare Pages Git integration. Preserve it during adoption, even if GitHub now redirects the old name."
  type        = string
  default     = "slide-sage"
}

variable "api_image" {
  description = "Artifact Registry image for the API. CI should pass an immutable digest or commit tag."
  type        = string
}

variable "worker_image" {
  description = "Artifact Registry image for the generation worker. CI should pass an immutable digest or commit tag."
  type        = string
}

variable "migrate_image" {
  description = "Artifact Registry image for the migration job. CI should pass an immutable digest or commit tag."
  type        = string
}

variable "converter_image" {
  description = "Artifact Registry image for the Bun card converter sidecars. CI passes the same immutable commit tag to the API and worker."
  type        = string
}

variable "open_router_model" {
  description = "Server-owned OpenRouter generation model."
  type        = string
  default     = "qwen/qwen3.8-27b:free"
}

variable "open_router_api_base" {
  description = "OpenRouter chat completions endpoint used by the API and worker."
  type        = string
  default     = "https://openrouter.ai/api/v1/chat/completions"
}

variable "presentation_gcs_bucket" {
  description = "Private GCS bucket for card image assets. Preserve the existing name; defaults to <project-id>-presentation-revisions."
  type        = string
  default     = null
  nullable    = true
}

variable "unsplash_enabled" {
  description = "Enable Unsplash stock photos. Requires the UNSPLASH_ACCESS_KEY Secret Manager secret; otherwise generation stays text-only."
  type        = bool
  default     = false
}

variable "otel_exporter_otlp_endpoint" {
  description = "Common Datadog OTLP intake endpoint. Leave empty to disable telemetry export."
  type        = string
  default     = ""
}

variable "otel_service_version" {
  description = "Version attached to OpenTelemetry resources, normally the deployed commit SHA."
  type        = string
  default     = ""
}

variable "otel_logs_exporter" {
  description = "Set to none when the Datadog GCP integration already collects Cloud Run stdout logs."
  type        = string
  default     = "otlp"

  validation {
    condition     = contains(["otlp", "none"], var.otel_logs_exporter)
    error_message = "otel_logs_exporter must be otlp or none."
  }
}

variable "maintenance_mode" {
  description = "Disable API and queue consumers during incompatible database migrations. CI restores automatic scaling after the release apply."
  type        = bool
  default     = false
}

variable "worker_min_instances" {
  description = "Floor for worker instances. Zero lets authenticated Cloud Tasks requests start workers only while generation work exists."
  type        = number
  default     = 0
}

variable "worker_wake_deadline_seconds" {
  description = "How long Cloud Tasks holds a drain request open. The in-flight request is what stops Cloud Run reclaiming an instance that is generating, so this must exceed the seven-minute River job timeout."
  type        = number
  default     = 1800

  validation {
    condition     = var.worker_wake_deadline_seconds > 420 && var.worker_wake_deadline_seconds <= 1800
    error_message = "worker_wake_deadline_seconds must exceed the 420 second job timeout and stay within the 1800 second Cloud Tasks maximum."
  }
}

variable "maintenance_schedule" {
  description = "Cron schedule for the recovery and cleanup sweep that used to run as a ticker inside the always-on worker."
  type        = string
  default     = "*/15 * * * *"
}
