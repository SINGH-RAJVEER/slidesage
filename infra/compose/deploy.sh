#!/usr/bin/env bash
# Roll the stack to an image tag: back up the database, stop the old API and
# worker, migrate, then start the new release. Some migrations delete data, so
# no old binary runs against a half-migrated schema, and the dump taken here is
# the way back.
#
#   ./deploy.sh <image-tag>
set -euo pipefail
cd "$(dirname "$0")"

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

# The maintenance and backup timers skip their run while this lock is held,
# so no sweep runs the new worker against a half-migrated schema. Waiting here
# lets a sweep that already started finish first.
exec 9>.deploy.lock
flock 9

# Pull before recording the tag, so a mistyped tag leaves .env on the release
# that is still running.
IMAGE_TAG="$tag" docker compose pull --quiet
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$tag/" .env

docker compose up --detach --wait postgres
./backup.sh

# The new api and worker start only after migrate exits successfully. If it
# fails they stay stopped; investigate before starting anything older.
docker compose stop api worker
docker compose up --detach --remove-orphans

for _ in $(seq 30); do
	if docker compose exec -T nginx wget -q -O /dev/null http://api:8000/health; then
		echo "deployed $tag"
		exit 0
	fi
	sleep 2
done
docker compose ps --all
docker compose logs --tail 50 migrate api
echo "api is not healthy after deploying $tag" >&2
exit 1
