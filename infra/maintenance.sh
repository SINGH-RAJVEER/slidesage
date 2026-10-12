#!/usr/bin/env bash
# Run maintenance only between successful releases, under the deployment lock.
set -euo pipefail
cd "$(dirname "$0")"
export COMPOSE_FILE=compose.json
umask 077

exec 9>.deploy.lock
flock --nonblock 9 || exit 0
if [ -e .deploy-incomplete ]; then
	echo "skipping maintenance: deployment recovery is required"
	exit 0
fi
docker compose run --rm --no-deps maintenance
