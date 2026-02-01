# SlideSage

AI-assisted presentation generator that creates professional slides with rich content, charts, and beautiful templates.

This is a **monorepo** managed with Turbo and Bun, containing the frontend and backend applications.

---

**Quick Start:**

```bash
# Install dependencies (from root)
bun install

# Set up environment variables
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
# Edit .env files with your configuration

# Start all services in development mode
bun dev

# Or use Turbo directly
turbo run dev
```

---

## Overview

SlideSage is a modern web application that leverages AI to generate complete presentations from simple text prompts. It features real-time streaming of generated content, support for data visualization charts, and multiple professional design templates.

This project is structured as a **monorepo** using:

- **Package Manager:** Bun workspaces
- **Build System:** Turbo for task orchestration and caching
- **Backend:** TypeScript + Bun + Hono with Drizzle ORM (`apps/backend/`)
- **Frontend:** React (Vite + Bun) app with Tailwind CSS and Shadcn UI (`apps/frontend/`)
- **Database:** PostgreSQL for storing user data and presentation history
- **Containerization:** Docker for deployment

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

This is a monorepo managed with Turbo and Bun workspaces:

```
slide-sage/
├── apps/                     # Applications
│   ├── backend/             # Hono API server
│   │   ├── src/
│   │   │   ├── db/          # Database schema and migrations
│   │   │   ├── lib/         # Shared libraries
│   │   │   ├── middleware/  # Hono middleware
│   │   │   ├── repositories/# Database access layer
│   │   │   ├── routes/      # API route definitions
│   │   │   ├── services/    # Business logic and AI integration
│   │   │   ├── types/       # TypeScript type definitions
│   │   │   ├── utils/       # Utility functions
│   │   │   └── index.ts     # Application entry point
│   │   ├── biome.json       # Linter/Formatter config
│   │   ├── drizzle.config.ts # ORM config
│   │   └── package.json
│   ├── frontend/            # React SPA
│   │   ├── src/
│   │   │   ├── features/    # Feature-based modules
│   │   │   │   ├── auth/
│   │   │   │   ├── presentations/
│   │   │   │   └── profile/
│   │   │   ├── components/  # Shared UI components
│   │   │   ├── lib/         # Shared utilities
│   │   │   ├── pages/       # Top-level pages
│   │   │   └── App.tsx
│   │   └── package.json
│   └── database/            # Database configuration
├── packages/                 # Shared packages (if any)
├── docs/                    # Project documentation
│   ├── API_CONTRACT.md      # Complete API documentation
│   ├── ARCHITECTURE.md      # System architecture
│   ├── CLEAN_CODE.md        # Clean code standards
│   └── WORKFLOWS.md         # Development workflows
├── turbo.json               # Turbo configuration
├── package.json             # Root package.json (workspaces)
├── docker-compose.yml
└── README.md
```

---

## Environment Variables

Copy the example environment files and configure them:

```bash
# Backend environment
cp apps/backend/.env.example apps/backend/.env

# Frontend environment
cp apps/frontend/.env.example apps/frontend/.env
```

**Backend (apps/backend/.env):**

- `PORT` - API Port (default: 8000)
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET_KEY` - **REQUIRED**: Secret key for JWT tokens
- `GEMINI_API_KEY`, `GROQ_API_KEY` - API keys for AI services
- `LITELLM_MODEL` - AI model to use
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - **OPTIONAL**: For Google OAuth
- `CORS_ORIGINS` - Allowed CORS origins

**Frontend (apps/frontend/.env):**

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

**From the monorepo root:**

1. **Install all dependencies:**

   ```bash
   bun install
   ```

2. **Configure environment variables:**

   ```bash
   cp apps/backend/.env.example apps/backend/.env
   cp apps/frontend/.env.example apps/frontend/.env
   # Edit both .env files with your configuration
   ```

3. **Start all services:**

   ```bash
   bun dev              # Starts both backend and frontend
   # or
   turbo run dev        # Explicit turbo command
   ```

4. **Initialize database (first time only):**

   ```bash
   cd apps/backend
   bun run db:push
   ```

**Individual service development:**

```bash
# Backend only
turbo run dev --filter=backend

# Frontend only
turbo run dev --filter=frontend
```

---

## Development Commands

This monorepo uses Turbo for task orchestration. Run these commands from the **root directory**:

### General Commands

- `bun dev` / `turbo run dev` - Start all development servers
- `bun build` / `turbo run build` - Build all applications
- `bun lint` / `turbo run lint` - Lint all code
- `bun format` / `turbo run format` - Format all code

### Application-Specific Commands

**Backend:**

- `turbo run dev --filter=backend` - Start backend development server
- `turbo run lint --filter=backend` - Lint backend code
- `turbo run format --filter=backend` - Format backend code
- `cd apps/backend && bun run db:push` - Push schema changes to database
- `cd apps/backend && bun run db:studio` - Open Drizzle Studio

**Frontend:**

- `turbo run dev --filter=frontend` - Start frontend development server
- `turbo run lint --filter=frontend` - Lint frontend code
- `turbo run build --filter=frontend` - Build frontend for production

### Database Commands (Backend)

```bash
cd apps/backend
bun run db:push      # Push schema changes
bun run db:studio    # Open Drizzle Studio
bun run db:generate  # Generate migrations
bun run db:migrate   # Run migrations
```

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

When contributing to this monorepo:

1. Follow the clean code guidelines in `docs/CLEAN_CODE.md`
2. Update `docs/API_CONTRACT.md` when changing API contracts
3. Run linters before committing:
   ```bash
   # From root directory
   bun lint          # Lint all applications
   # or
   turbo run lint    # Explicit turbo command
   ```
4. Test your changes:
   ```bash
   bun dev           # Start development servers
   ```
5. Follow monorepo best practices:
   - Make changes in the appropriate app directory
   - Use workspace dependencies when sharing code
   - Test changes across all affected applications

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
