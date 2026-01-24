# SlideSage

AI-assisted presentation generator that creates professional slides with rich content, charts, and beautiful templates.

---

**Quick Start:**

```bash
# Backend
cd backend
bun install
cp .env.example .env
# Edit .env if needed (default PORT is 8000)
bun run db:push
bun run dev

# Frontend (in a new terminal)
cd frontend
bun install
cp .env.example .env
# Edit .env to point VITE_API_URL to http://localhost:8000
bun dev
```

---

## Overview

SlideSage is a modern web application that leverages AI to generate complete presentations from simple text prompts. It features real-time streaming of generated content, support for data visualization charts, and multiple professional design templates.

- **Backend:** TypeScript + Bun + Hono with Drizzle ORM
- **Frontend:** React (Vite + Bun) app with a modern UI built using Tailwind CSS and Shadcn UI
- **Database:** PostgreSQL for storing user data and presentation history
- **Build system:** Docker for containerization

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

- **Runtime:** Bun (fast JavaScript/TypeScript runtime)
- **Framework:** Hono (Express-like web framework)
- **Database:** PostgreSQL with Drizzle ORM (type-safe queries)
- **AI/LLM:** OpenAI API compatible endpoints
- **Auth:** Jose JWT + Google OAuth 2.0
- **Linter/Formatter:** Biome
- **Benefits:** Fast startup, type-safe, low memory usage

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
├── backend/                  # Hono API
│   ├── src/
│   │   ├── db/              # Database schema and migrations
│   │   ├── lib/             # Shared libraries
│   │   ├── middleware/      # Hono middleware
│   │   ├── repositories/    # Database access layer
│   │   ├── routes/          # API route definitions
│   │   ├── services/        # Business logic and AI integration
│   │   ├── types/           # TypeScript type definitions
│   │   ├── utils/           # Utility functions
│   │   └── index.ts         # Application entry point
│   ├── biome.json           # Linter/Formatter config
│   ├── drizzle.config.ts    # ORM config
│   └── package.json
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── features/        # Feature-based modules
│   │   │   ├── auth/
│   │   │   ├── presentations/
│   │   │   └── profile/
│   │   ├── components/      # Shared UI components
│   │   ├── lib/             # Shared utilities
│   │   ├── pages/           # Top-level pages
│   │   └── App.tsx
│   └── package.json
├── docs/                    # Project documentation
│   ├── API_CONTRACT.md      # Complete API documentation
│   ├── CLEAN_CODE.md        # Clean code standards contract
│   └── WORKFLOWS.md         # Development workflows
├── docker-compose.yml
└── README.md
```

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env` and fill with your credentials:

**Backend (backend/.env):**

- `PORT` - API Port (default: 8000)
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET_KEY` - **REQUIRED**: Secret key for JWT tokens
- `GEMINI_API_KEY`, `GROQ_API_KEY` - API keys for AI services
- `LITELLM_MODEL` - AI model to use
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - **OPTIONAL**: For Google OAuth
- `CORS_ORIGINS` - Allowed CORS origins

**Frontend (frontend/.env):**

- `VITE_API_URL` - Backend API URL (e.g., http://localhost:8000)
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
   - Backend API: `http://localhost:8000`
   - PostgreSQL: `localhost:5432`

### Local Development

1. **Backend Setup:**

   ```bash
   cd backend
   bun install
   # Configure .env
   bun run db:push
   bun run dev
   ```

2. **Frontend Setup:**

   ```bash
   cd frontend
   bun install
   # Configure .env
   bun dev
   ```

---

## Development Commands

**Backend:**

- `bun run dev` - Start development server
- `bun run lint` - Run Biome check
- `bun run format` - Format code with Biome
- `bun run db:push` - Push schema changes to database
- `bun run db:studio` - Open Drizzle Studio

**Frontend:**

- `bun dev` - Start development server
- `bun lint` - Run linting

---

## API Documentation

Complete API documentation is available in `docs/API_CONTRACT.md`.

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

### Backend Layers (Hono + Drizzle)

1. **Routes Layer** (`src/routes/`): API route definitions and validation
2. **Services Layer** (`src/services/`): Business logic and orchestration
3. **Repositories Layer** (`src/repositories/`): Database access via Drizzle
4. **Middleware** (`src/middleware/`): Authentication and request processing
5. **DB** (`src/db/`): Schema definitions and migrations

### Key Principles

- Follows clean code guidelines (see `docs/CLEAN_CODE.md`)
- All API endpoints documented in `docs/API_CONTRACT.md`
- Type-safe development with TypeScript
- Consistent error handling and validation
- Separation of HTTP concerns from business logic

---

## Contributing

When contributing to this project:

1. Follow the clean code guidelines in `docs/CLEAN_CODE.md`
2. Update `docs/API_CONTRACT.md` when changing API contracts
3. Run linters before committing:
   - Backend: `cd backend && bun run lint`
   - Frontend: `cd frontend && bun lint`

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

- Backend: Ensure `DATABASE_URL` is correct and PostgreSQL is running.
- Frontend: Ensure `VITE_API_URL` matches the running backend port.