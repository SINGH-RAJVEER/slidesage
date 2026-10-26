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

# Apply Goose and River migrations
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
	for component in api worker migrate converter container migrate-objects; do \
		CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go -C apps/api build \
			-mod=readonly -trimpath -buildvcs=false -ldflags="-s -w" \
			-o "$PWD/dist/$component" "./cmd/$component"; \
	done

# Run the card converter only
converter:
	go -C apps/api run ./cmd/converter

# Build the Cloudflare Pages upload directory. The API origin is fixed at build time.
web-bundle api_url="https://api.slidesage.app":
	VITE_API_URL={{api_url}} bun run --cwd apps/web build

# Build the API/worker image used by Wrangler.
image: binaries
	docker build --platform linux/amd64 --file infra/cloudflare/Dockerfile --tag slidesage-backend .

# Deploy only after completing the database, secrets, and image cutover runbook.
deploy-backend: binaries
	bun run --cwd apps/edge deploy
