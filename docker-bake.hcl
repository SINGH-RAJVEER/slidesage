# Bake definition for the three images built from apps/api/Dockerfile.
#
# The API, worker, and migrate images all derive from one `build` stage. Baking
# them together lets BuildKit run that stage once and share its result, instead
# of re-entering the builder for three sequential build-push-action steps.

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
