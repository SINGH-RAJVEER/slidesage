set dotenv-path := ".env"
set shell := ["bash", "-cu"]

default:
    @just --list

# Start all services and apps
dev:
    devenv up

# Open a psql shell to the local dev database
db-shell:
    psql -h 127.0.0.1 -p "${PGPORT:-${POSTGRES_PORT:-5432}}" -U "${POSTGRES_USER:-slidesage}" -d "${POSTGRES_DB:-slidesage}"

# Apply Go API migrations
migrate:
    CGO_ENABLED=0 go -C apps/api run ./cmd/migrate

# Create a new Goose SQL migration
db-generate name:
    goose -dir apps/api/migrations create "{{name}}" sql

# Run the API server only
api:
    bun run dev:api

# Run the Web server only
web:
    bun --cwd apps/web dev

test:
    bun run test

test-api:
    bun run test:api

test-web:
    bun run test:web

test-ui:
    bun run test:ui

lint:
    bun run lint

lint-fix:
    bunx biome check --write .

format:
    bun run format

# Compile the release binaries the container images copy in
binaries:
	mkdir -p dist
	for component in api worker migrate; do \
		CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go -C apps/api build \
			-mod=readonly -trimpath -buildvcs=false -ldflags="-s -w" \
			-o "$PWD/dist/$component" "./cmd/$component"; \
	done

# Build a container image from the repo root context. Run `just binaries` first.
image target="api": binaries
	docker build --target {{target}} --file apps/api/Dockerfile --tag slidesage-{{target}} .
