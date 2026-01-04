# SlideSage

AI-assisted presentation generator that creates professional slides with rich content, charts, and beautiful templates.

---

## Overview

SlideSage is a modern web application that leverages AI to generate complete presentations from simple text prompts. It features real-time streaming of generated content, support for data visualization charts, and multiple professional design templates.

- **Backend:** Flask app with clean layered architecture (API, Services, Repositories, Models)
- **Frontend:** React (Vite + Bun) app with a modern UI built using Tailwind CSS and Shadcn UI
- **Database:** PostgreSQL for storing user data and presentation history
- **Build system:** Docker for containerization and Nix flakes for reproducible environments

---

## Key Features

- **AI Generation:** Generates comprehensive slide decks including titles, bullet points, and summaries
- **Smart Charts:** Automatically creates data visualizations (Bar, Line, Pie, etc.) based on the context
- **Streaming:** Watch your presentation being built in real-time with Server-Sent Events (SSE)
- **Templates:** Choose from multiple professional themes (Modern Dark, Corporate Blue, Minimalist, etc.)
- **Authentication:** Secure user accounts with email/password or Google OAuth
- **Export:** Download your presentations as editable PPTX files

---

## Architecture & Flow

1. **User → Frontend:** User logs in, selects a template, and enters a prompt
2. **Frontend → Backend:** `POST /api/generate-presentation-stream` initiates the generation process
3. **Backend → AI:** Backend uses LiteLLM to interface with LLMs to generate content and chart data
4. **Streaming:** Slides are streamed back to the frontend one by one as they are generated
5. **Storage:** Completed presentations are saved to the PostgreSQL database
6. **Frontend → User:** User previews the slides, applies different templates, and downloads the final PPTX

---

## Tech Stack

### Backend

- **Framework:** Flask with application factory pattern
- **Database:** PostgreSQL (SQLAlchemy ORM)
- **AI/LLM:** LiteLLM for LLM integration
- **Auth:** Flask-JWT-Extended + Google OAuth 2.0
- **Validation:** Marshmallow for request/response schemas

### Frontend

- **Framework:** React + TypeScript
- **Build Tool:** Vite
- **Runtime:** Bun
- **Styling:** Tailwind CSS
- **Components:** Shadcn UI
- **Icons:** Lucide React

---

## Project Structure

```
project-root/
├── backend/                  # Flask API
│   ├── app/
│   │   ├── api/             # Thin route handlers (API layer)
│   │   ├── services/        # Business logic
│   │   ├── repositories/    # Database access layer
│   │   ├── schemas/         # Request/response validation
│   │   ├── models/          # ORM models
│   │   └── config.py        # Configuration
│   ├── main.py              # Application entry point
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── services/
│   │   └── types/
│   ├── package.json
│   └── Dockerfile
├── instructions/
│   ├── clean-code.md        # Clean code standards contract
│   ├── API_CONTRACT.md      # Complete API documentation
│   ├── DECISIONS.md         # Architecture decision records
│   └── WORKFLOWS.md         # Development workflows
├── .env.example
├── docker-compose.yml
├── Makefile
└── README.md
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill with your credentials:

**Backend (.env):**

- `FLASK_DEBUG` - Enable debug mode (default: True)
- `JWT_SECRET_KEY` - **REQUIRED**: Secret key for JWT tokens
- `DATABASE_URL` - PostgreSQL connection string
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - **OPTIONAL**: For Google OAuth
- `LITELLM_MODEL` - AI model to use (e.g., gpt-4)
- `CORS_ORIGINS` - Allowed CORS origins

**Frontend (frontend/.env):**

- `VITE_API_URL` - Backend API URL (e.g., http://localhost:5000/api)
- `VITE_GOOGLE_CLIENT_ID` - **OPTIONAL**: Google OAuth Client ID

---

## Getting Started

### Using Docker (Recommended)

1. **Start Services:**

   ```bash
   docker-compose up --build
   ```

2. **Access Application:**

   - Frontend: `http://localhost:5173`
   - Backend API: `http://localhost:5000`
   - PostgreSQL: `localhost:5432`

### Local Development

1. **Install Dependencies:**

   ```bash
   make install
   ```

2. **Start Backend:**

   ```bash
   make dev-backend
   ```

3. **Start Frontend (in another terminal):**

   ```bash
   make dev-frontend
   ```

---

## Development Commands

Use the provided Makefile for common tasks:

- `make help` - Show all available commands
- `make dev` - Start full development environment with Docker
- `make install` - Install all dependencies
- `make test` - Run all tests
- `make lint` - Run linters on all code
- `make docker-up` - Start Docker services
- `make docker-down` - Stop Docker services
- `make clean` - Clean build artifacts

---

## API Documentation

Complete API documentation is available in `instructions/API_CONTRACT.md`.

### Authentication Endpoints (No auth required)

- `POST /api/auth/register` — Register new user
- `POST /api/auth/login` — Login with email/password
- `POST /api/auth/google` — Google OAuth login
- `POST /api/auth/refresh` — Refresh access token
- `GET /api/auth/me` — Get current user (requires auth)
- `PUT /api/auth/profile` — Update user profile (requires auth)
- `POST /api/auth/logout` — Logout (requires auth)

### Presentation Endpoints (Auth required)

- `POST /api/generate-presentation-stream` — Generate presentation with SSE streaming
- `GET /api/presentations` — Get all user presentations
- `GET /api/presentations/:id` — Get specific presentation
- `DELETE /api/presentations/:id` — Delete presentation
- `GET /api/health` — Health check (no auth required)

---

## Architecture

SlideSage follows clean architecture principles with clear separation of concerns:

### Backend Layers

1. **API Layer** (`app/api/`): Thin HTTP handlers for request/response
2. **Services Layer** (`app/services/`): Business logic and orchestration
3. **Repositories Layer** (`app/repositories/`): Database access
4. **Schemas Layer** (`app/schemas/`): Validation and serialization
5. **Models Layer** (`app/models/`): Domain models (SQLAlchemy ORM)

### Key Principles

- Follows clean code guidelines (see `instructions/clean-code.md`)
- All API endpoints documented in `instructions/API_CONTRACT.md`
- Architecture decisions tracked in `instructions/DECISIONS.md`
- Consistent error handling and validation
- Separation of HTTP concerns from business logic

---

## Contributing

When contributing to this project:

1. Follow the clean code guidelines in `instructions/clean-code.md`
2. Update `instructions/API_CONTRACT.md` when changing API contracts
3. Document architectural decisions in `instructions/DECISIONS.md`
4. Write tests for new features
5. Run linters before committing: `make lint`

---

## Data Flow

1. User authenticates via email/password or Google OAuth
2. Frontend sends presentation request to `POST /api/generate-presentation-stream`
3. Backend validates request, checks user tokens, and streams generation
4. AI service (LiteLLM) generates slides with content and optional charts
5. Slides are streamed to frontend in real-time via Server-Sent Events
6. Completed presentation is saved to PostgreSQL database
7. User can view, edit, and export presentation as PPTX

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
