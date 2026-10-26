#!/usr/bin/env bash
# Run a compiled migration binary against the retained database. Pause both
# application Containers before incompatible schema changes. Caller holds no lock.
set -euo pipefail
cd "$(dirname "$0")"
export COMPOSE_FILE=compose.json
binary=${1:?usage: migrate.sh /absolute/path/to/migrate}
[[ $binary == /* && -x $binary ]]
exec 9>.deploy.lock
flock 9
./backup.sh
# The existing production password is URL-safe. Keep the constructed URL out of logs.
credentials=$(docker compose exec -T postgres sh -c 'printf "%s:%s" "$POSTGRES_USER" "$POSTGRES_PASSWORD"')
database=$(docker compose exec -T postgres sh -c 'printf "%s" "$POSTGRES_DB"')
DATABASE_URL="postgresql://$credentials@127.0.0.1:15432/$database?sslmode=disable" "$binary"
