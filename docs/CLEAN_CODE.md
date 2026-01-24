This `clean-code.md` is a standards contract for all AI agents and developers working on a React frontend + TypeScript/Bun backend project. Every change to the repo should comply with these rules.

***

# Clean Code Guidelines

- Treat this file as **source-of-truth** for architecture, style, and workflow.
- Do not introduce patterns that conflict with these rules without an explicit RFC and approval.
- Prefer consistency over personal preference; match existing patterns in each layer.

***

## Repository Structure

Use a clear, monorepo-style layout with strict separation of concerns.

```text
project-root/
├── frontend/                 # React SPA / client
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── lib/
│   │   └── main.tsx
│   ├── public/
│   ├── package.json
│   └── tsconfig.json
├── backend/                  # TypeScript API (Bun + Hono)
│   ├── src/
│   │   ├── index.ts          # Main application entry
│   │   ├── routes/           # Route handlers (Hono)
│   │   ├── services/         # Business logic
│   │   ├── repositories/     # Data access layer
│   │   ├── middleware/       # Hono middleware
│   │   ├── db/               # Database schema and connections
│   │   ├── lib/              # Shared libraries
│   │   ├── types/            # TypeScript type definitions
│   │   └── utils/            # Utility functions
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle.config.ts
│   └── Dockerfile
├── docs/
│   ├── CLEAN_CODE.md         # This file
│   ├── API_CONTRACT.md       # OpenAPI / endpoint contracts
│   └── WORKFLOWS.md          # Agent playbooks (CI, deployment, tasks)
├── .env.example
├── docker-compose.yml
└── README.md
```

- Do not place application code in the repository root.[1]
- Keep frontend and backend independently buildable and testable.[5][4]

***

## Cross-Cutting Principles

- Prefer **composition** over inheritance in both React and TypeScript code.[6][3]
- Functions should do one thing, be small, and be named after what they do.[3]
- Avoid duplication; extract shared utilities where patterns repeat 3+ times.[3]
- Keep I/O at the edges: React handles UI, Hono endpoints handle HTTP, services handle business logic, repositories handle persistence.[7][6]

***

## Frontend (React) Rules

### Technology & Architecture

- React + TypeScript for all new code.[8][5]
- Use functional components and hooks only; no new class components.[8]
- Group code by feature, not by type, under `src/features/<feature>/` (component, hook, API slice together).[9][5]

### State & Data Flow

- Use local component state for purely presentational concerns.
- Use a dedicated data layer (React Query / TanStack Query) for server state; do not manually manage loading/error for API calls in multiple places.[10][8]
- No direct `fetch`/Axios calls inside deeply nested components; centralize API access in `src/lib/api` or feature-level API modules.[11][10]

### Styling & UI

- Use a single styling approach across the app (Tailwind CSS with Shadcn UI components); do not mix ad hoc styles.[8]
- Components must be:
  - **Pure** with respect to props (no hidden global state).
  - Small and focused: if a component grows beyond ~200 lines or handles multiple concerns, split it.

### React Code Style

- Use PascalCase for components, camelCase for variables/functions.[3]
- No side effects during render; use `useEffect` carefully (minimal dependencies, cleanups).[8]
- Derive state instead of duplicating it whenever possible to avoid divergence.[8]

Example (good):

```tsx
// src/features/users/components/UserList.tsx
import { useUsers } from '../hooks/useUsers';

export function UserList() {
  const { data: users, isLoading, error } = useUsers();

  if (isLoading) return <p>Loading users...</p>;
  if (error) return <p>Failed to load users.</p>;

  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

***

## Backend (TypeScript/Hono) Rules

### Architecture & Layers

- Follow a layered, clean-architecture style:
  - `routes/`: Hono route handlers, request parsing, response formatting.
  - `services/`: Business rules, orchestrating multiple repositories and external services.[6][7]
  - `repositories/`: Database access, ORM queries, external persistence.[6]
  - `db/`: Database schema, connections, and migrations.
  - `types/`: TypeScript type definitions and interfaces.
- HTTP handlers must be thin; they should:
  - Validate and type-check input.
  - Call a service function.
  - Return typed responses.[2][6]

### Hono Conventions

- Use route grouping pattern in `src/routes/`.[2]
- Register route groups in the main `src/index.ts` file.[2]
- Use environment-based configuration, not hard-coded values in modules.[2]
- Leverage Hono's built-in middleware for common tasks (CORS, logging, auth).

Example:

```typescript
// src/routes/users.routes.ts
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.middleware';
import { userService } from '../services/user.service';
import type { User, CreateUserRequest } from '../types';

const userRoutes = new Hono();

userRoutes.post('/', authMiddleware, async (c) => {
  const payload = await c.req.json() as CreateUserRequest;
  const user: User = await userService.createUser(payload);
  return c.json({ user }, 201);
});

export default userRoutes;
```

### TypeScript Code Style

- Follow strict TypeScript configuration (strict: true).[3][2]
- Define interfaces for all data structures.[3]
- Avoid `any` type; use proper typing or `unknown`.[3]
- Use async/await consistently throughout the codebase.
- Exceptions:
  - Use custom error classes for domain/business errors.
  - Map them to clear HTTP error responses via middleware.[2]

### Database Layer (Drizzle ORM)

- Define all schemas in `src/db/schema.ts`.
- Use type-safe queries with Drizzle ORM.
- Repository pattern for database operations:
  - Each entity has its own repository file.
  - Repositories return typed results.
  - Handle database errors at the repository level.

Example:

```typescript
// src/repositories/user.repository.ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import type { User, NewUser } from '../types';

export class UserRepository {
  async create(userData: NewUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async findById(id: number): Promise<User | null> {
    const user = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user[0] || null;
  }
}
```

***

## API Contract & Frontend–Backend Integration

- All endpoints must be documented in `docs/API_CONTRACT.md`.[12][13]
- The React app must never rely on implicit/undocumented responses:
  - Document request shape, response shape, status codes, and error formats.
- Use a stable base URL (e.g. `/api`) and environment-driven configuration:
  - Frontend: `VITE_API_URL`.
  - Backend: CORS allowed origins via `CORS_ORIGINS`.[10][11]

Integration rules:

- Prefer JSON for all responses (`application/json`) except explicit file endpoints.[11][10]
- Handle CORS via Hono's cors middleware with environment configuration.[10]

***

## Error Handling & Logging

- Never expose stack traces or internal error messages to the client in production.[10][2]
- Use a consistent error format, e.g.:

```json
{
  "error": {
    "message": "User not found",
    "details": {}
  }
}
```

- Frontend:
  - Show user-friendly messages.
  - Log technical details to the console only in development.[10]
- Backend:
  - Use Hono's built-in logger middleware.
  - Include request IDs when available.[4]
  - Use proper HTTP status codes consistently.

***

## Security & Data Validation

- Validate data on both client and server; client validation is UX, server validation is security.[10][8]
- Never trust client input; all incoming data must be validated by TypeScript types and runtime checks.[10]
- Protect against:
  - SQL injection via Drizzle ORM parameterized queries.
  - XSS by encoding output, not injecting raw HTML from user input.[10]
  - CSRF for state-changing requests if using cookies for auth.[8]

Secrets & configuration:

- Never commit real secrets; use `.env` + `.env.example`.
- All services must read configuration from environment variables, not from constants in code.[4][8]

***

## Testing & Quality Gates

- Backend:
  - Use Bun's built-in test runner for unit and integration tests.
  - Tests live under `backend/src/**/*.test.ts` near the implementation files.[4][6]
- Frontend:
  - Use Bun test runner + React Testing Library for unit/component tests.[5][9]
- Each new feature must:
  - Have tests for happy-path and at least one failure-path.
  - Not decrease overall type safety.

Example commands:

```bash
# Backend development
cd backend && bun run dev
cd backend && bun test
cd backend && bun run lint

# Frontend development  
cd frontend && bun dev
cd frontend && bun test
cd frontend && bun run lint
```

***

## Git, Commits, and Branching

- Commit messages must be imperative and scoped, e.g. `feat(user): add profile endpoint`.[4]
- Do not mix unrelated changes in a single PR (one logical change per PR).
- Keep branches short-lived; rebase instead of merging master/main into feature branches when possible.[4]

***

## Agent-Specific Instructions

When an AI agent modifies this repository, it must:

- Respect this **CLEAN_CODE** contract before generating or editing files.
- Match existing patterns in the target module (naming, layering, error format).
- Update or add:
  - `docs/API_CONTRACT.md` when API shape changes.
  - Type definitions when data structures change.
- Never:
  - Introduce new frameworks or libraries without an explicit RFC.
  - Break public API contracts without updating API docs and a migration note.
  - Use `any` type without strong justification.

Following these rules keeps the React–TypeScript stack maintainable, secure, and scalable for both humans and autonomous agents.