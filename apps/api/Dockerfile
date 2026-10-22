# Runtime images only. The binaries are compiled on the CI runner, where the Go
# build cache persists cheaply through actions/cache, and are copied in from
# dist/. Compiling inside the image meant either recompiling every dependency on
# every release, or paying more to shuttle BuildKit's cache mounts in and out
# than the incremental compile saved. Build the binaries first with
# `just binaries`, then `just image`.

# certificates and the image storage directory
from docker.io/library/alpine:3.24 as certs

run apk add --no-cache ca-certificates \
	&& mkdir -p /data/objects \
	&& chown -R 65532:65532 /data


from scratch as base

workdir /app

copy --from=certs \
	/etc/ssl/certs/ca-certificates.crt \
	/etc/ssl/certs/ca-certificates.crt

# Image storage mount point. A new named volume copies this ownership, so the
# non-root runtime user can write card images to it.
copy --from=certs --chown=65532:65532 /data /data

user 65532:65532


# api
from base as api

copy dist/api /app/api

expose 8000

entrypoint ["/app/api"]


# worker
from base as worker

copy dist/worker /app/worker

entrypoint ["/app/worker"]

# migrate
from base as migrate

copy dist/migrate /app/migrate

entrypoint ["/app/migrate"]

# card converter, private to the compose network
from base as converter

copy dist/converter /app/converter

env CARD_CONVERTER_HOST=0.0.0.0

expose 8090

entrypoint ["/app/converter"]
