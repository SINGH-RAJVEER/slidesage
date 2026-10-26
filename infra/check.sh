#!/usr/bin/env bash
# Validate with disposable credentials, never a developer or server .env.
set -euo pipefail
cd "$(dirname "$0")/.."
shellcheck infra/*.sh
for script in infra/*.sh; do
	bash -n "$script"
done
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
cp infra/compose.json "$fixture/"
sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=ci-placeholder/' infra/env.example > "$fixture/.env"
docker compose --project-directory "$fixture" --env-file "$fixture/.env" -f "$fixture/compose.json" config --quiet
