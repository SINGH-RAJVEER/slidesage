# Build release binaries first with `just binaries`. No application secrets enter the image.
from docker.io/library/alpine:3.24

run apk add --no-cache ca-certificates openssh-client
workdir /app
copy dist/api dist/worker dist/converter dist/container /app/
user 65532:65532
expose 8000 8080
entrypoint ["/app/container"]
