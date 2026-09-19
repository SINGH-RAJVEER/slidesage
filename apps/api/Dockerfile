# Runtime images only. The binaries are compiled on the CI runner, where the Go
# build cache persists cheaply through actions/cache, and are copied in from
# dist/. Compiling inside the image meant either recompiling every dependency on
# every release, or paying more to shuttle BuildKit's cache mounts in and out
# than the incremental compile saved. Build the binaries first with
# `just binaries`, then `just image`.

# certificates
from docker.io/library/alpine:3.24 as certs

run apk add --no-cache ca-certificates


from scratch as base

workdir /app

copy --from=certs \
	/etc/ssl/certs/ca-certificates.crt \
	/etc/ssl/certs/ca-certificates.crt

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
