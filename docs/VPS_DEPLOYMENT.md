# VPS database operations

PostgreSQL and pgvector remain on the VPS during the first Cloudflare Containers cutover. The prepared `infra/compose.json` declares only PostgreSQL and preserves `slidesage_postgres-data` and the retained `slidesage_objects` volume. The API, worker, converter, frontend, Nginx, Valkey, and application maintenance timer are no longer part of the target VPS setup. See [Cloudflare deployment](CLOUDFLARE_DEPLOYMENT.md) for the ordered migration.

## Database and backup setup

Keep the existing `/opt/slidesage/.env` and database credentials. Do not overwrite them with the reduced example. Compose publishes PostgreSQL only as `127.0.0.1:15432:5432`. Each Cloudflare application uses a restricted SSH connection to that loopback port. The public firewall needs the existing SSH port; it does not need a PostgreSQL rule or application HTTPS ports after the API cutover.

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

## Restricted database SSH account

Create a dedicated `slidesage-db` account with a unique key. It must accept public-key authentication and local forwarding only. It needs no Docker membership or interactive shell. Restrict the key to `permitopen="127.0.0.1:15432"` and use `restrict,port-forwarding` in `authorized_keys`. Add an sshd `Match User slidesage-db` block:

```text
Match User slidesage-db
	AuthenticationMethods publickey
	PasswordAuthentication no
	KbdInteractiveAuthentication no
	AllowTcpForwarding local
	PermitOpen 127.0.0.1:15432
	AllowStreamLocalForwarding no
	AllowAgentForwarding no
	X11Forwarding no
	PermitTTY no
	ForceCommand /bin/false
```

Validate `sshd -t` and the effective `sshd -T -C user=slidesage-db,host=localhost,addr=127.0.0.1` configuration before reloading SSH. Keep the authenticated administrative connection open until a second connection through the new key succeeds. Obtain the server host public key through that existing authenticated session and create a known-hosts entry for `[148.113.1.66]:20135`. An unauthenticated `ssh-keyscan` alone does not verify its identity. Source: [OpenSSH configuration](https://man.openbsd.org/sshd_config).

The Container supervisor pins that host key, disables password prompts, binds its local PostgreSQL listener only to `127.0.0.1:15432`, and supervises the SSH process. If forwarding dies, it drains the application and exits; the edge heartbeat starts a fresh instance. The application verifies database connectivity before serving traffic.

## Migrations and recovery

Compile `dist/migrate` with `just binaries` and transfer that binary and `infra/migrate.sh` to the VPS. The binary must be compatible with the VPS architecture. Pause application writers before incompatible schema migrations, then run:

```bash
cd /opt/slidesage
./migrate.sh /opt/slidesage/releases/<sha>/migrate
```

The script holds `.deploy.lock`, takes a backup, and passes the database URL through the environment without printing credentials. It assumes the retained production database credentials remain URL-safe, as required by the original deployment.

To restore, pause both Cloudflare application instances and any retained VPS writers, hold `.deploy.lock`, and restore a compatible dump:

```bash
exec 9>.deploy.lock
flock 9
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl --exit-on-error' < backups/<dump>
flock --unlock 9
```

Restore failures can leave a partly restored schema. Keep writers stopped until the database and matching application version are verified. An application rollback does not reverse schema migrations or copy new R2 images back into the old local volume.
