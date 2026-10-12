#!/usr/bin/env bash
# Validate release files with disposable credentials, never a developer .env.
set -euo pipefail
cd "$(dirname "$0")/.."
shellcheck infra/*.sh
for script in infra/*.sh; do
	bash -n "$script"
done
docker buildx bake -f docker-bake.hcl --print >/dev/null

fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
cp infra/compose.json "$fixture/"
cp -r infra/nginx infra/templates "$fixture/"
mkdir -p "$fixture/certs"
sed -e 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=ci-placeholder/' \
	-e 's/^VALKEY_PASSWORD=.*/VALKEY_PASSWORD=ci-placeholder/' \
	"infra/env.example" > "$fixture/.env"
docker compose --project-directory "$fixture" --env-file "$fixture/.env" \
	-f "$fixture/compose.json" --profile jobs config --quiet

if [[ ${1:-} == --config-only ]]; then
	exit 0
fi
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
	-keyout "$fixture/certs/origin.key" -out "$fixture/certs/origin.pem" \
	-subj /CN=slidesage.app >/dev/null 2>&1
docker run --rm \
	-e WEB_DOMAIN=slidesage.app -e API_DOMAIN=api.slidesage.app \
	-e 'NGINX_ENVSUBST_FILTER=^(WEB_DOMAIN|API_DOMAIN)$' \
	-v "$fixture/templates:/etc/nginx/templates:ro" \
	-v "$fixture/nginx/cloudflare.conf:/etc/nginx/conf.d/cloudflare.conf:ro" \
	-v "$fixture/certs:/etc/nginx/certs:ro" \
	docker.io/library/nginx:1.30-alpine nginx -t
