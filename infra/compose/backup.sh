#!/usr/bin/env bash
# Dump the database to backups/ in pg_dump custom format, check the archive
# reads back, and keep the newest BACKUP_KEEP dumps. Copy backups/ off the
# server separately; a dump on the same disk does not survive losing the VPS.
set -euo pipefail
cd "$(dirname "$0")"
umask 077

keep=$(sed -n 's/^BACKUP_KEEP=//p' .env 2>/dev/null | tail -n 1)
keep=${keep:-14}
mkdir -p backups
target="backups/slidesage-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' >"$target.partial"
docker compose exec -T postgres pg_restore --list >/dev/null <"$target.partial"
mv "$target.partial" "$target"
echo "wrote $target ($(du -h "$target" | cut -f1))"

printf '%s\n' backups/slidesage-*.dump | sort -r | tail -n "+$((keep + 1))" | xargs -r rm --
