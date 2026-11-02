# VPS database operations

PostgreSQL moves to Neon in the Cloudflare Containers cutover. The VPS database supplies the final dump and then stays, with no writers, as the rollback source. After the runtime checks pass, the prepared `infra/compose.json` can replace the old Compose file. It declares only PostgreSQL and preserves `slidesage_postgres-data` and the retained `slidesage_objects` volume. The API, worker, converter, frontend, Nginx, Valkey, and application maintenance timer are no longer part of the target VPS setup. See [Cloudflare deployment](CLOUDFLARE_DEPLOYMENT.md) for the ordered migration.

## Post-cutover rollback database

This section is optional and runs only after the cutover; the runbook does not need it, and it restarts PostgreSQL. Keep the existing `/opt/slidesage/.env` and database credentials. Do not overwrite them with the reduced example. Compose publishes PostgreSQL only as `127.0.0.1:15432:5432`; nothing outside the VPS connects to it. The public firewall needs the existing SSH port; it does not need a PostgreSQL rule or application HTTPS ports after the API cutover.

```bash
cd /opt/slidesage
docker compose config --quiet
docker compose up --detach --wait postgres
./backup.sh
sudo install -m 644 slidesage-backup.service slidesage-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now slidesage-backup.timer
```

Preserve the previous Compose file before installing this one. Starting the reduced project leaves old application containers running as orphans; stop them explicitly only at the cutover step. Never use `docker compose down --volumes` or delete the original volumes as part of this migration.

`backup.sh` creates PostgreSQL custom-format dumps, verifies each archive can be listed, and retains `BACKUP_KEEP` dumps, 14 by default. Copy dumps off the VPS separately. Database dumps do not contain image bytes; R2 and the old image volume need their own retention policy.

## Migrations and recovery

Migrations run from an operator machine against Neon, not on the VPS. Compile `dist/migrate` with `just binaries`, create a Neon restore branch, pause application writers before incompatible schema migrations, then run:

```bash
infra/migrate.sh "$PWD/dist/migrate" /private/neon-direct-url
```

The script reads the URL from a private file, refuses the `-pooler` host, and passes the URL to the binary through the environment without printing it.

To recover Neon, pause both Cloudflare application instances, restore a point-in-time branch in the Neon console, and point the `DATABASE_URL` in `APP_ENV` at it, or reset the primary branch to that point. To roll back to the VPS, keep writers stopped, dump Neon through the direct host with `pg_dump --format=custom --no-owner --no-acl`, and restore it on the VPS:

```bash
exec 9>.deploy.lock
flock 9
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl --exit-on-error' < backups/<dump>
flock --unlock 9
```

Restore failures can leave a partly restored schema. Keep writers stopped until the database and matching application version are verified. An application rollback does not reverse schema migrations or copy new R2 images back into the old local volume.
