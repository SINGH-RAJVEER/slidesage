#!/usr/bin/env bash
# Run from the uploaded release directory. Hold the lock across file sync and
# deployment so timers and manual releases cannot use partly updated files.
set -euo pipefail
umask 077

tag=${1:?usage: activate-release.sh <sha> <registry> <web-domain> <api-domain>}
registry=${2:?missing registry}
web_domain=${3:?missing web domain}
api_domain=${4:?missing API domain}
if [[ ! $tag =~ ^[0-9a-f]{40}$ ]]; then
	echo "expected a full commit SHA" >&2
	exit 1
fi
release=$(cd "$(dirname "$0")" && pwd)
cd /opt/slidesage
exec 9>.deploy.lock
flock 9

# Read Compose's interpolation values without sourcing the secret file or
# printing it. Refuse a frontend built for a different API or registry.
compose=(docker compose --env-file .env --project-directory "$PWD" -f "$release/compose.json")
"${compose[@]}" config --quiet
resolved=$("${compose[@]}" config --environment)
for setting in IMAGE_REGISTRY WEB_DOMAIN API_DOMAIN; do
	case "$setting" in
		IMAGE_REGISTRY) expected=$registry ;;
		WEB_DOMAIN) expected=$web_domain ;;
		API_DOMAIN) expected=$api_domain ;;
	esac
	actual=$(printf '%s\n' "$resolved" | sed -n "s/^$setting=//p")
	if [[ $actual != "$expected" ]]; then
		echo "$setting differs between CI and the server .env" >&2
		exit 1
	fi
done

# Only release files are eligible for copying. Server state never participates
# in sync, including credentials, certificates, dumps, and lock files.
rsync -a --include='/compose.json' --include='/*.sh' \
	--include='/*.service' --include='/*.timer' --include='/env.example' \
	--include='/nginx/***' --include='/templates/***' --exclude='*' \
	"$release/" ./
# deploy.sh inherits descriptor 9 and retains this lock through readiness.
./deploy.sh "$tag"
