#!/usr/bin/env bash
# Roll the stack to an image tag: back up the database, stop the old API and
# worker, migrate, then start the new release. Some migrations delete data, so
# no old binary runs against a half-migrated schema, and the dump taken here is
# the way back.
#
#   ./deploy.sh <image-tag>
set -euo pipefail
cd "$(dirname "$0")"
umask 077
# Do not rely on Compose discovering a nonstandard filename through .env.
export COMPOSE_FILE=compose.json

tag=${1:?usage: deploy.sh <image-tag>}
if [[ ! $tag =~ ^[A-Za-z0-9._-]+$ ]]; then
	echo "invalid image tag: $tag" >&2
	exit 1
fi
for required in .env certs/origin.pem certs/origin.key secrets/gcs-key.json; do
	if [ ! -f "$required" ]; then
		echo "missing $required; see docs/VPS_DEPLOYMENT.md" >&2
		exit 1
	fi
done
if ! grep -q '^IMAGE_TAG=' .env; then
	echo "missing IMAGE_TAG in .env" >&2
	exit 1
fi

# Called by the EXIT trap below.
# shellcheck disable=SC2329
diagnostics() {
	status=$?
	if (( status != 0 )); then
		docker compose ps --all || true
		echo "deployment failed; inspect container logs locally before restarting API or worker" >&2
	fi
}
trap 'diagnostics' EXIT

# The maintenance and backup timers skip their run while this lock is held,
# so no sweep runs the new worker against a half-migrated schema. Waiting here
# lets a sweep that already started finish first.
exec 9>.deploy.lock
flock 9

# Pull before recording the tag, so a mistyped tag leaves .env on the release
# that is still running.
IMAGE_TAG="$tag" docker compose config --quiet
IMAGE_TAG="$tag" docker compose --profile jobs pull --quiet
# The image entrypoint renders the mounted templates before nginx validates
# domains and certificates. Catch edge configuration failures before downtime.
IMAGE_TAG="$tag" docker compose run --rm --no-deps nginx nginx -t

IMAGE_TAG="$tag" docker compose up --detach --wait --wait-timeout 120 postgres valkey converter
./backup.sh
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$tag/" .env

# The new api and worker start only after migrate exits successfully. If it
# fails they stay stopped; investigate before starting anything older.
# Keep scheduled maintenance disabled after a failed cutover as well as while
# this process holds the lock. A later successful release clears the marker.
touch .deploy-incomplete
docker compose stop api worker
# Re-run migrations even for a redeploy of the same tag. Keep the completed
# container for depends_on and diagnostics; only this container participates
# in abort-on-container-exit, so PostgreSQL remains running.
docker compose up --no-deps --force-recreate --abort-on-container-exit --exit-code-from migrate migrate
# Recreate nginx even when only a mounted template or certificate changed.
docker compose up --detach --no-deps --force-recreate --wait --wait-timeout 120 nginx api worker

for _ in $(seq 30); do
	if docker compose exec -T nginx wget -q -T 3 -O /dev/null http://api:8000/health \
		&& docker compose exec -T nginx wget -q -T 3 -O /dev/null http://worker:8080/ready; then
		rm -f .deploy-incomplete
		echo "deployed $tag"
		exit 0
	fi
	sleep 2
done
echo "API or worker is not ready after deploying $tag" >&2
exit 1
