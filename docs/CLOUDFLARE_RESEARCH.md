# Cloudflare Containers migration research

Checked against primary sources on 2026-10-26. These findings informed the prepared implementation; they do not certify a production deployment. The operational instructions are in [Cloudflare deployment](CLOUDFLARE_DEPLOYMENT.md).

## Template and lifecycle

The current [Containers starter](https://github.com/cloudflare/templates/tree/main/containers-template) imports `DurableObject` from `cloudflare:workers` and uses `ctx.container`, named images, `scheduling_policy: "durable_object"`, and SQLite-backed exports. Cloudflare recommends the [direct API](https://developers.cloudflare.com/containers/api/) for new applications. The adapted workspace pins Wrangler 4.153.0 and runtime types 5.20261026.1.

`start()` and `running` do not prove HTTP readiness. The starter serializes concurrent starts and probes a TCP port before proxying. Inactivity timeouts must be restored after a Durable Object restart. The direct API accepts at most six hours of inactivity; a pending `monitor()` promise prevents eviction for at most 15 minutes. Continuous PostgreSQL work is not a Durable Object request heartbeat. Sources: [direct API](https://developers.cloudflare.com/containers/api/durable-object-container/), [starter code](https://github.com/cloudflare/templates/blob/main/containers-template/src/index.ts).

The prepared controller uses fixed API/generation identities, a minute Cron heartbeat, five-minute inactivity, readiness probes, and graceful image/version replacement. The generation process runs maintenance itself every 15 minutes. These are application choices; restart and drain behavior still require runtime verification. Sources: [Cron example](https://developers.cloudflare.com/containers/examples/cron/), [lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/).

The `durable_object` scheduling policy does not automatically roll out a new image to an existing running instance. Inspect the image and deliberately replace it. Named images use a local Dockerfile or Cloudflare registry digest. Sources: [scheduling policy](https://developers.cloudflare.com/containers/configuration/scheduling-policy/), [image management](https://developers.cloudflare.com/containers/platform-details/image-management/).

## Database connectivity

The user chose to retain PostgreSQL on the VPS for the first cutover. A dedicated restricted SSH local-forward preserves pgx/River's PostgreSQL protocol, does not expose the database publicly, and avoids introducing a new database provider. This is an application design inference. Pin the existing host identity and restrict the account to one loopback target; `ForceCommand` alone does not restrict forwarding. Sources: [OpenSSH forwarding](https://man.openbsd.org/ssh#L), [sshd restrictions](https://man.openbsd.org/sshd_config).

The Container supervisor maintains that connection and leaves it alive during application drain. `ExitOnForwardFailure` checks listener establishment, not database availability, so application database pings remain required. Sources: [SSH configuration](https://man.openbsd.org/ssh_config), [application startup](../apps/api/cmd/api/main.go), [worker readiness](../apps/api/cmd/worker/main.go).

Hyperdrive is not a transparent replacement for this migration. Its documented restrictions include PostgreSQL advisory locks and LISTEN/NOTIFY, while current River/migrations use PostgreSQL features beyond simple queries. Source: [Hyperdrive PostgreSQL support](https://developers.cloudflare.com/hyperdrive/reference/postgres-compatibility/).

Cloudflare Tunnel plus Access TCP is another supported approach, but requires client-side cloudflared and service-token setup. Cloudflare recommends Client-to-Tunnel for long-lived connections, so it is not assumed equivalent to a persistent raw database connection. Sources: [arbitrary TCP](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/cloudflared-authentication/arbitrary-tcp/), [service policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).

## Image storage

Container disks are ephemeral when instances stop. Database and image bytes therefore need persistent services. Sources: [Container FAQ](https://developers.cloudflare.com/containers/faq/), [architecture](https://developers.cloudflare.com/containers/concepts/architecture/).

The prepared R2 gateway retains the API's authorized image routes and uses conditional creation. `etagDoesNotMatch: "*"` prevents replacing an existing object; an identical retry checks size and SHA-256 metadata, and mismatches fail. The Go client validates bytes before upload, and R2 validates the SHA-256 of the bounded request stream while writing. Sources: [R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/).

The one-time migration preserves existing keys, checks upload bytes, and reads remote bytes back for verification. A final copy must run after old writers stop. The storage-only bootstrap Worker lets this happen before API DNS changes and cannot start generation instances.

## Verification boundaries

Local type checks, tests, builds, and emulated R2 checks cannot establish production SSH reachability, Cloudflare instance placement, real model success, persistence across platform restarts, DNS cutover, or rollback safety. Complete the deployed generation, auth, image, export, restart, and backup gates in the runbook before retiring the old application services. PostgreSQL backup and restore remain VPS responsibilities.
