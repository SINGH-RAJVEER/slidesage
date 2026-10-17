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

- Compose runs password-protected Valkey on the private container network, with no published host port.
- The API uses `CACHE_VALKEY_ADDR=valkey:6379`, `CACHE_VALKEY_AUTH=password`, and the server's `VALKEY_PASSWORD`. Empty `CACHE_VALKEY_ADDR` disables caching outside Compose.
- Valkey uses `allkeys-lru` and no disk persistence. Restarts produce cache misses; PostgreSQL remains authoritative.
- Apply migrations before enabling the read cache. The worker invalidates reads through database triggers and needs no direct Valkey access.

## Local development and checks

- devenv starts Valkey on `127.0.0.1:6379` as the `cache` process, without persistence, and points the API at it. Apply migrations before relying on it; devenv orders them first.
- Local Valkey may omit password authentication and TLS. Variables are listed in [Environment variables](ENVIRONMENT_VARIABLES.md#database-read-cache).
- Outside devenv, run a disposable server:

```bash
podman run --rm --name slidesage-valkey -p 127.0.0.1:6379:6379 docker.io/valkey/valkey:9.0-alpine valkey-server --save '' --appendonly no
```

- Integration tests use a migrated disposable `DATABASE_URL` and disposable `TEST_VALKEY_ADDR`. Valkey tests create expiring keys without flushing the database.
- Coverage includes invalidation/rollback, concurrent fill, user isolation, ownership transfer, account deletion, revision selection, corruption, expiry, and outages.

## Isolated Rust port

The Rust backend caches `GET /presentations` lists and immutable bodies for `GET /presentations/{id}/document`. It shares Go's key hashes, payload formats and TTLs. Lists read the PostgreSQL generation before every lookup; document reads always check ownership and the current revision, then fetch fresh asset metadata. A document cache miss repeats authorization before reading the body. Existing SQL migrations remain unchanged. The deployed backend remains unchanged.

The Rust client opens one multiplexed RESP2 connection lazily and permits at most eight concurrent operations. Its timeout includes waiting for an operation slot and connecting. Errors trigger a five-second bypass; missing, oversized or corrupt values fall back to PostgreSQL. This differs from the Go client's pool of up to eight connections.

The disposable compatibility runner verifies native Valkey expiry and size limits, committed writes, rollback, late fills, ownership transfer and account deletion. Go-to-Rust and Rust-to-Go cache tests use real Valkey entries, including raw document bodies with a one-hour TTL. List tests lock the presentation table to prove that a cache hit skips count and body queries. Document tests check fresh head, ownership and asset metadata, plus corrupted entries and Go decoder edge cases. A separate local run verified password authentication over TLS with a custom CA, including round-trip reads, writes and expiry.

To repeat the native client test against a disposable authenticated or TLS server, set `TEST_VALKEY_ADDR`, optional `TEST_VALKEY_PASSWORD`, and optional `TEST_VALKEY_CA_PEM` containing the CA certificate text:

```bash
cargo test --manifest-path apps/backend-rust/Cargo.toml --locked --lib --features postgres-tests cache::tests::native_valkey_round_trip_expiry_and_size_limit -- --exact
```

The cache OpenTelemetry counters and histograms are still pending. These checks validate the isolated read-cache port; they do not establish complete backend compatibility or a production deployment.
