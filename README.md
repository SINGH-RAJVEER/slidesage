# SlideSage

AI-assisted presentation generator
---

## Overview

- **Backend:** Flask app that provides AI services (text generation via `backend/ai.py`) and serves generated content under `backend/public`.
- **Frontend:** Vite + Bun app that submits prompts to the backend, previews generated slides, and lets users download PPTX files.
- **Build system:** Nix flakes are used for reproducible dev shells and Docker image builds.

---

## Architecture & Flow

- **User → Frontend:** Enter prompt and request a presentation.
- **Frontend → Backend:** `POST /api/generate-presentation` with `{ "prompt": "..." }`.
- **Backend → AI services:** Backend calls Bedrock models to generate slide content and optional images.
- **Backend → Storage:** Generated images saved to `backend/public` and served at `/public/<filename>`.
- **Frontend → User:** Receives presentation JSON and renders preview; users can edit or download PPTX.

---

## Files to know

- **`backend/`** — Flask services and AI helpers (`ai.py`, `main.py`, `config.py`).
- **`frontend/`** — Vite + Bun app; source in `frontend/src/` (pages, components, hooks, types).
- **`docker-compose.yml`** — Starts `backend` (port `8000`) and `frontend` (port `8080`) for local development.

---

## Environment variables

Copy the example env files and fill with your credentials and model IDs:

**`backend/.env`** (create from `backend/.env.example`):

- `LITELLM_MODEL`, `LITELLM_PROXY_URL` - AI service configuration
- `FLASK_DEBUG`, `CORS_ORIGINS` - Flask configuration
- `JWT_SECRET_KEY` - **REQUIRED**: Secret key for JWT tokens (use a strong random string in production!)
- `JWT_ACCESS_TOKEN_EXPIRES` - Access token expiration (default: 3600 seconds)
- `JWT_REFRESH_TOKEN_EXPIRES` - Refresh token expiration (default: 86400 seconds)
- `DATABASE_URL` - PostgreSQL connection string (defaults to Docker Compose: `postgresql://slidesage:slidesage@postgres:5432/slidesage`)
  - For local development: `postgresql://user:password@localhost:5432/slidesage`

**`frontend/.env`** (create from `frontend/.env.example`):
- `VITE_API_URL` - Backend API URL (e.g. `http://localhost:8000`)

---

## Important endpoints

### Authentication (No auth required)
- `POST /api/auth/register` — Register new user: `{ email: string, password: string }`
- `POST /api/auth/login` — Login: `{ email: string, password: string }` → returns `{ access_token, refresh_token }`
- `POST /api/auth/refresh` — Refresh access token (requires refresh token)
- `GET /api/auth/me` — Get current user (requires access token)
- `POST /api/auth/logout` — Logout (requires access token)

### Application (Auth required)
- `POST /api/generate-presentation` — Generate presentation: `{ prompt: string }` → `{ success: boolean, data: presentation }`
- `GET /api/health` — Health check (no auth required)

---

## Run with Docker (recommended)

From the project root:

```bash
docker compose up --build
```

This will start:
- **PostgreSQL** database on port `5432`
- **Backend** API on `http://localhost:8000`
- **Frontend** app on `http://localhost:8080`

The database will be automatically initialized with the required tables on first run.

---

## Data flow (summary)

1. Frontend sends prompt to `POST /api/generate-presentation`.
2. Backend uses `AIService` (`backend/ai.py`) to build a presentation structure (slides, titles, points, optional image placeholders).
3. Backend does not generate infograph images. The main flow focuses on textual slide generation via `AIService`.
4. Frontend renders slides and offers download as PPTX.

---

## Notes & troubleshooting

- If Nix flakes hit GitHub rate limits, pin inputs and commit `flake.lock` or supply a `GITHUB_TOKEN` during builds:

```bash
export GITHUB_TOKEN=ghp_xxx
docker compose build --build-arg GITHUB_TOKEN=$GITHUB_TOKEN
docker compose up --build
```

---

## Local dev tips

- Backend: use the Nix devShell in `backend/` or run a Python venv and start the app with:

```bash
uv run main.py
```

- Frontend: run the dev server with `bunx vite` or `pnpm run dev` and set `API_URL` to your backend.

---
