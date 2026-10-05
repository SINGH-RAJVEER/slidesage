# Database read cache

- Optional shared Redis caches presentation summaries and immutable card bodies. Empty `CACHE_REDIS_ADDR` disables it.
- PostgreSQL owns authorization, current revisions, balances, billing, jobs, and writes. Losing cache contents loses no application data.

## Read paths and invalidation

| Read | Cache key includes | TTL | PostgreSQL checks on every request |
| --- | --- | --- | --- |
| Presentation list | User, cache generation, limit, offset | 30 seconds | Current cache generation |
| Card body | Owner, presentation, revision, digest | One hour | Ownership and current revision metadata |

- List hits skip count, body loading, and summary parsing, retaining one indexed generation lookup.
- Migration 37 installs a row trigger that advances `presentation_cache_versions` on inserts, updates, and deletes. Ownership changes advance both owners.
- Invalidation commits or rolls back with the write. It covers API, editor, template, worker, and maintenance changes without Redis calls from writers.
- Late cache fills use their earlier generation, so later requests cannot find stale entries. Superseded keys expire; in-flight reads may return their pre-commit snapshot.
- Generation tombstones have no user foreign key, preserving invalidation during cascading account deletion. Do not truncate presentations while serving requests; the trigger covers row writes.
- Document misses repeat authorization before loading the requested body. Editor, export, and shared reads use this path; share validity and assets are checked separately.
- Authorization and current pointers are never cached. Digests identify submitted revisions, not reserialized JSONB bytes.
- Keys hash length-delimited identities under `slidesage:cache:v1:`. Values above 4 MiB bypass caching.
- Invalid cached JSON falls back to PostgreSQL. Failed reads and missing objects are not cached.

## Availability and telemetry

- Connections open lazily, with at most eight active connections per API instance.
- Operations default to 100 ms with no retries. Errors bypass Redis for five seconds before trying again.
- Cache outages do not fail readiness or block writes. PostgreSQL must handle a complete cache outage.
- `slidesage.cache.requests` and `slidesage.cache.duration` record `operation` and `outcome`; duration is milliseconds.
- Get outcomes are `hit`, `miss`, `error`, and `bypass`; set outcomes are `ok`, `error`, and `bypass`.
- Metrics contain no identities, keys, document content, or credentials. Compare hit rate and request/database latency before increasing capacity.

## Production

- Terraform `cache_enabled` defaults to false. GitHub `CACHE_ENABLED=true` enables it in plan/deploy; local plans can use `-var=cache_enabled=true`.
- Deploy through the migration-first workflow so version tracking exists before enabling cache.
- `CACHE_ENABLED=false` removes cache resources on the next release and restores direct database reads.
- Enabled defaults are Redis 7.2, 1 GiB Basic Tier, dedicated VPC, `/26` Cloud Run subnet, and separate `/29` Redis peering range.
- API uses Direct VPC egress with `PRIVATE_RANGES_ONLY`. Worker needs no Redis credentials or VPC attachment; database triggers invalidate its writes.
- TLS and Redis AUTH are enabled. Terraform stores the password in Secret Manager, injects a specific version, and supplies instance CAs through `CACHE_REDIS_CA_PEM`.
- Production rejects configured Redis without both password and CA. The generated password is also in sensitive Terraform state; retain backend access controls.
- `cache_memory_gb` defaults to 1. `cache_tier` accepts `BASIC` or `STANDARD_HA`; changing tier replaces the disposable cache.
- Basic permits cold restarts and flushes; Standard adds replication/failover. Both require PostgreSQL fallback and incur idle capacity charges. See [Redis pricing](https://cloud.google.com/memorystore/docs/redis/pricing).

## Local development and checks

- Start Redis separately, set `CACHE_REDIS_ADDR=127.0.0.1:6379`, and apply migrations before enabling it.
- Non-production Redis may omit password and CA. Variables are listed in [Environment variables](ENVIRONMENT_VARIABLES.md#database-read-cache).

```bash
podman run --rm --name slidesage-redis -p 127.0.0.1:6379:6379 docker.io/library/redis:7.2-alpine redis-server --save '' --appendonly no
```

- Integration tests use a migrated disposable `DATABASE_URL` and disposable `TEST_REDIS_ADDR`. Redis tests create expiring keys without flushing the database.
- Coverage includes invalidation/rollback, concurrent fill, user isolation, ownership transfer, account deletion, revision selection, corruption, expiry, and outages.
