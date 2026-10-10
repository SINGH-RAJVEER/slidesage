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

# Apply Goose and River migrations, then delete retired objects from the image
# bucket when PRESENTATION_GCS_BUCKET is set.
migrate:
	CGO_ENABLED=0 go -C apps/api run ./cmd/migrate

# Add the documented test user to the local database. Pass --session to also
# print a signed-in cookie. Refuses any DATABASE_URL that is not on this machine.
seed *args:
	DATABASE_URL="${DATABASE_URL:-postgresql://slidesage:slidesage@127.0.0.1:${PGPORT:-5432}/slidesage}" CGO_ENABLED=0 go -C apps/api run ./cmd/seed {{args}}

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

# Bundle the card converter into the file its container image copies in
converter-bundle:
	mkdir -p dist
	bun build apps/converter/src/main.ts --target bun --outfile dist/converter.js

# Run the card converter only
converter:
	bun run dev:converter

# Build a container image from the repo root context. Run `just binaries` first.
image target="api": binaries
	docker build --target {{target}} --file apps/api/Dockerfile --tag slidesage-{{target}} .
