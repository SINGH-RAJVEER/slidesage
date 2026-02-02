set dotenv-load := true
set shell := ["bash", "-cu"]

COMPOSE_DEV := "docker/compose/docker-compose.dev.yml"
COMPOSE_PROD := "docker/compose/docker-compose.prod.yml"

default:
  @just --list

# ---- Compose: dev ----
dev-up:
  docker compose -f {{COMPOSE_DEV}} up --build

dev-up-d:
  docker compose -f {{COMPOSE_DEV}} up -d --build

dev-down:
  docker compose -f {{COMPOSE_DEV}} down

dev-reset:
  docker compose -f {{COMPOSE_DEV}} down -v --remove-orphans

dev-logs service="":
  docker compose -f {{COMPOSE_DEV}} logs -f {{service}}

# ---- Compose: prod ----
prod-up:
  docker compose -f {{COMPOSE_PROD}} up -d --build

prod-down:
  docker compose -f {{COMPOSE_PROD}} down

prod-logs service="":
  docker compose -f {{COMPOSE_PROD}} logs -f {{service}}

# ---- Validation ----
compose-config:
  docker compose -f {{COMPOSE_DEV}} config >/dev/null
  docker compose -f {{COMPOSE_PROD}} config >/dev/null
  echo "compose files parse cleanly"

# ---- Handy shells ----
db-shell:
  docker compose -f {{COMPOSE_DEV}} exec database psql -U "${POSTGRES_USER:-slidesage}" -d "${POSTGRES_DB:-slidesage}"

backend-shell:
  docker compose -f {{COMPOSE_DEV}} exec backend sh

frontend-shell:
  docker compose -f {{COMPOSE_DEV}} exec frontend sh
