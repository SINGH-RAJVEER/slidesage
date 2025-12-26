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

-- `backend/.env` (create from `backend/.env.example`):

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `BEDROCK_MODEL_ID`
- Optional: `FLASK_DEBUG`, `CORS_ORIGINS`
- `frontend/.env` (create from `frontend/.env.example`):
  - `API_URL` (e.g. `http://localhost:8000`)

---

## Important endpoints

- `POST /api/generate-presentation` — body: `{ prompt: string }` → response: `{ success: boolean, data: presentation }`
  Generated images are no longer created by the backend. The primary endpoint is below.

---

## Run with Docker (recommended)

From the project root:

```bash
docker compose up --build
```

After that the backend listens on `http://localhost:8000` and the frontend on `http://localhost:8080` (unless ports are changed in `docker-compose.yml`).

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
