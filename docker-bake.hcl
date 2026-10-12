# Bake definition for the runtime images.
#
# The Go images copy prebuilt binaries from dist/. The converter image copies a
# Bun bundle and the web image the built frontend from the same directory. One
# bake publishes the whole release.

# Registry path the images are pushed under, without the image name.
variable "REGISTRY" {
	default = "ghcr.io/singh-rajveer/slidesage"
}

# The immutable tag for a release. Deploys pin the VPS to this, never latest.
variable "IMAGE_VERSION" {
	default = "dev"
}

function "image" {
	params = [component]
	result = "${REGISTRY}/${component}"
}

group "default" {
	targets = ["api", "worker", "migrate", "converter", "web"]
}

target "common" {
	context    = "."
	dockerfile = "apps/api/Dockerfile"
	platforms  = ["linux/amd64"]
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

target "converter" {
	context    = "."
	dockerfile = "apps/converter/Dockerfile"
	target     = "converter"
	platforms  = ["linux/amd64"]
	tags = [
		"${image("converter")}:${IMAGE_VERSION}",
		"${image("converter")}:latest",
	]
}

target "web" {
	context    = "."
	dockerfile = "apps/web/Dockerfile"
	target     = "web"
	platforms  = ["linux/amd64"]
	tags = [
		"${image("web")}:${IMAGE_VERSION}",
		"${image("web")}:latest",
	]
}
