# Database read cache

- Optional shared Valkey caches presentation summaries and immutable card bodies. Empty `CACHE_VALKEY_ADDR` disables it.
- PostgreSQL owns authorization, current revisions, balances, billing, jobs, and writes. Losing cache contents loses no application data.

## Read paths and invalidation

| Read | Cache key includes | TTL | PostgreSQL checks on every request |
| --- | --- | --- | --- |
| Presentation list | User, cache generation, limit, offset | 30 seconds | Current cache generation |
| Card body | Owner, presentation, revision, digest | One hour | Ownership and current revision metadata |

- List hits skip count, body loading, and summary parsing, retaining one indexed generation lookup.
- Migration 37 installs a row trigger that advances `presentation_cache_versions` on inserts, updates, and deletes. Ownership changes advance both owners.
- Invalidation commits or rolls back with the write. It covers API, editor, template, worker, and maintenance changes without Valkey calls from writers.
- Late cache fills use their earlier generation, so later requests cannot find stale entries. Superseded keys expire; in-flight reads may return their pre-commit snapshot.
- Generation tombstones have no user foreign key, preserving invalidation during cascading account deletion. Do not truncate presentations while serving requests; the trigger covers row writes.
- Document misses repeat authorization before loading the requested body. Editor, export, and shared reads use this path; share validity and assets are checked separately.
- Authorization and current pointers are never cached. Digests identify submitted revisions, not reserialized JSONB bytes.
- Keys hash length-delimited identities under `slidesage:cache:v1:`. Values above 4 MiB bypass caching.
- Invalid cached JSON falls back to PostgreSQL. Failed reads and missing objects are not cached.

## Availability and telemetry

- Connections open lazily, with at most eight active connections per API instance.
- Operations default to 100 ms with no retries. Errors bypass Valkey for five seconds before trying again.
- Cache outages do not fail readiness or block writes. PostgreSQL must handle a complete cache outage.
- `slidesage.cache.requests` and `slidesage.cache.duration` record `operation` and `outcome`; duration is milliseconds.
- Get outcomes are `hit`, `miss`, `error`, and `bypass`; set outcomes are `ok`, `error`, and `bypass`.
- Metrics contain no identities, keys, document content, or credentials. Compare hit rate and request/database latency before increasing capacity.

## Production

- Terraform `cache_enabled` defaults to false. GitHub `CACHE_ENABLED=true` enables it in plan/deploy; local plans can use `-var=cache_enabled=true`.
- Deploy through the migration-first workflow so version tracking exists before enabling cache.
- `CACHE_ENABLED=false` removes cache resources on the next release and restores direct database reads.
- Enabled defaults are Memorystore for Valkey 9.0 with cluster mode disabled, one `SHARED_CORE_NANO` node, no replicas, and a dedicated VPC.
- Private Service Connect automation is the only connection method. A `gcp-memorystore` service connection policy reserves the primary and reader endpoints in a `/28` subnet; the API uses only the primary, because the reader rejects writes.
- API uses Direct VPC egress from a separate `/26` subnet with `PRIVATE_RANGES_ONLY`. Worker needs no cache access or VPC attachment; database triggers invalidate its writes.
- TLS and IAM authentication are enabled. Memorystore for Valkey has no generated AUTH password, so nothing is stored in Secret Manager or Terraform state. Terraform supplies the instance CA chain through `CACHE_VALKEY_CA_PEM`, sets `CACHE_VALKEY_AUTH=iam`, and grants the runtime account `roles/memorystore.dbConnectionUser`.
- With IAM auth, each new connection sends a runtime service account access token through Valkey AUTH. Authenticated connections outlive token expiry. A token refresh slower than the operation budget fails that operation and starts the five-second bypass.
- Production rejects a configured cache without both the CA and IAM auth.
- `cache_node_type` accepts `SHARED_CORE_NANO`, `STANDARD_SMALL`, `HIGHMEM_MEDIUM`, or `HIGHMEM_XLARGE`. `cache_replica_count` accepts 0 to 5; one or more adds automatic failover.
- Zero replicas permit cold restarts and flushes. Every node is billed while idle, and PostgreSQL fallback is required either way. See [Memorystore for Valkey pricing](https://cloud.google.com/memorystore/valkey/pricing).

## Local development and checks

- devenv starts Valkey on `127.0.0.1:6379` as the `cache` process, without persistence, and points the API at it. Apply migrations before relying on it; devenv orders them first.
- Non-production Valkey may omit IAM auth and CA. Variables are listed in [Environment variables](ENVIRONMENT_VARIABLES.md#database-read-cache).
- Outside devenv, run a disposable server:

```bash
podman run --rm --name slidesage-valkey -p 127.0.0.1:6379:6379 docker.io/valkey/valkey:9.0-alpine valkey-server --save '' --appendonly no
```

- Integration tests use a migrated disposable `DATABASE_URL` and disposable `TEST_VALKEY_ADDR`. Valkey tests create expiring keys without flushing the database.
- Coverage includes invalidation/rollback, concurrent fill, user isolation, ownership transfer, account deletion, revision selection, corruption, expiry, and outages.
