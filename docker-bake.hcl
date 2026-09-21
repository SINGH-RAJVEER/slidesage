# Bake definition for the runtime images.
#
# Each image copies one prebuilt binary from dist/ onto scratch, so a bake is
# three trivial builds sharing a certificate stage. Baking them together still
# beats three sequential build-push-action steps, which re-entered the builder
# each time.

variable "REGISTRY" {
	default = "asia-south1-docker.pkg.dev"
}

variable "PROJECT_ID" {
	default = ""
}

variable "REPOSITORY" {
	default = "slidesage"
}

# The immutable tag for a release. Deploys pin Cloud Run to this, never latest.
variable "IMAGE_VERSION" {
	default = "dev"
}

function "image" {
	params = [component]
	result = "${REGISTRY}/${PROJECT_ID}/${REPOSITORY}/${component}"
}

group "default" {
	targets = ["api", "worker", "migrate"]
}

target "common" {
	context    = "."
	dockerfile = "apps/api/Dockerfile"
}

target "api" {
	inherits = ["common"]
	target   = "api"
	tags = [
		"${image("api")}:${IMAGE_VERSION}",
		"${image("api")}:latest",
	]
}

target "worker" {
	inherits = ["common"]
	target   = "worker"
	tags = [
		"${image("worker")}:${IMAGE_VERSION}",
		"${image("worker")}:latest",
	]
}

target "migrate" {
	inherits = ["common"]
	target   = "migrate"
	tags = [
		"${image("migrate")}:${IMAGE_VERSION}",
		"${image("migrate")}:latest",
	]
}
