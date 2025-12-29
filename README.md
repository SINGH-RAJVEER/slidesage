# SlideSage

AI-assisted presentation generator that creates professional slides with rich content, charts, and beautiful templates.

---

## Overview

SlideSage is a modern web application that leverages AI to generate complete presentations from simple text prompts. It features real-time streaming of generated content, support for data visualization charts, and multiple professional design templates.

- **Backend:** Flask app providing AI services (via LiteLLM), authentication, and data persistence.
- **Frontend:** React (Vite + Bun) app with a modern UI built using Tailwind CSS and Shadcn UI.
- **Database:** PostgreSQL for storing user data and presentation history.
- **Build system:** Nix flakes for reproducible environments and Docker for containerization.

---

## Key Features

- **AI Generation:** Generates comprehensive slide decks including titles, bullet points, and summaries.
- **Smart Charts:** Automatically creates data visualizations (Bar, Line, Pie, etc.) based on the context.
- **Streaming:** Watch your presentation being built in real-time with streaming responses.
- **Templates:** Choose from multiple professional themes (Modern Dark, Corporate Blue, Minimalist, etc.).
- **Authentication:** Secure user accounts with email/password or **Google OAuth** to save and manage your presentation history.
- **Export:** Download your presentations as editable PPTX files.

---

## Architecture & Flow

1. **User → Frontend:** User logs in, selects a template, and enters a prompt.
2. **Frontend → Backend:** `POST /api/generate-presentation-stream` initiates the generation process.
3. **Backend → AI:** Backend uses LiteLLM to interface with LLMs to generate content and chart data.
4. **Streaming:** Slides are streamed back to the frontend one by one as they are generated.
5. **Storage:** Completed presentations are saved to the PostgreSQL database.
6. **Frontend → User:** User previews the slides, applies different templates, and downloads the final PPTX.

---

## Tech Stack

### Backend

- **Framework:** Flask
- **Database:** PostgreSQL (SQLAlchemy)
- **AI/LLM:** LiteLLM (LLM integration)
- **Auth:** Flask-JWT-Extended + Google OAuth 2.0

### Frontend

- **Framework:** React + Vite
- **Runtime:** Bun
- **Styling:** Tailwind CSS
- **Components:** Shadcn UI
- **Icons:** Lucide React

---

## Files to know

- **`backend/`**
  - `main.py`: Application entry point and API routes.
  - `ai.py`: AI service logic for generating content and charts.
  - `models.py`: Database models (User, Presentation).
  - `auth.py`: Authentication routes and logic.
- **`frontend/`**
  - `src/components/Viewer/`: Presentation viewer and template logic.
  - `src/components/Charts/`: Chart rendering components.
  - `src/contexts/StreamingContext.tsx`: Handling of streaming AI responses.
- **`docker-compose.yml`**: Orchestrates Backend, Frontend, and PostgreSQL services.

---

## Environment variables

Copy the example env files and fill with your credentials:

**`backend/.env`** (create from `backend/.env.example`):

- `LITELLM_MODEL`, `LITELLM_PROXY_URL` - AI service configuration
- `FLASK_DEBUG`, `CORS_ORIGINS` - Flask configuration
- `JWT_SECRET_KEY` - **REQUIRED**: Secret key for JWT tokens
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - **OPTIONAL**: For Google OAuth
- `DATABASE_URL` - PostgreSQL connection string
  - Default: `postgresql://slidesage:slidesage@postgres:5432/slidesage`

**`frontend/.env`** (create from `frontend/.env.example`):

- `VITE_API_URL` - Backend API URL (e.g. `http://localhost:8000`)
- `VITE_GOOGLE_CLIENT_ID` - **OPTIONAL**: Google OAuth Client ID

---

## Getting Started

1. **Start Services:**

   ```bash
   docker-compose up --build
   ```

2. **Access Application:**

   - Frontend: `http://localhost:5173`
   - Backend API: `http://localhost:8000`

3. **Development:**
   - The project includes `flake.nix` for setting up a reproducible development environment with Nix.

## Important endpoints

### Authentication (No auth required)

- `POST /api/auth/register` — Register new user: `{ email: string, password: string }`
- `POST /api/auth/login` — Login: `{ email: string, password: string }` → returns `{ access_token, refresh_token }`
- `POST /api/auth/google` — Google OAuth login: `{ token: string }` → returns `{ access_token, refresh_token }`
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

- Frontend: run the dev server with `bun dev` and set `API_URL` to your backend.

---
