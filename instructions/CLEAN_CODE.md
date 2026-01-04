This `clean-code.md` is a standards contract for all AI agents and developers working on a React frontend + Flask backend project. Every change to the repo should comply with these rules.

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
│   │   └── index.tsx
│   ├── public/
│   ├── package.json
│   └── tsconfig.json
├── backend/                  # Flask API
│   ├── app/
│   │   ├── __init__.py
│   │   ├── api/             # Blueprints / route handlers
│   │   ├── services/        # Business logic
│   │   ├── models/          # ORM / schemas
│   │   ├── repositories/    # DB access layer
│   │   ├── schemas/         # Request/response validation (pydantic/marshmallow)
│   │   └── config.py
│   ├── migrations/
│   ├── tests/
│   ├── requirements.txt
│   └── wsgi.py
├── instructions/
│   ├── CLEAN_CODE.md        # This file
│   ├── API_CONTRACT.md      # OpenAPI / endpoint contracts
│   ├── WORKFLOWS.md         # Agent playbooks (CI, deployment, tasks)
│   └── DECISIONS.md         # ADRs (architecture decision records)
├── .env.example
├── docker-compose.yml
├── Makefile
└── README.md
```

- Do not place application code in the repository root.[1]
- Keep frontend and backend independently buildable and testable.[5][4]

***

## Cross-Cutting Principles

- Prefer **composition** over inheritance in both React and Flask code.[6][3]
- Functions should do one thing, be small, and be named after what they do.[3]
- Avoid duplication; extract shared utilities where patterns repeat 3+ times.[3]
- Keep I/O at the edges: React handles UI, Flask endpoints handle HTTP, services handle business logic, repositories handle persistence.[7][6]

***

## Frontend (React) Rules

### Technology & Architecture

- React + TypeScript for all new code.[8][5]
- Use functional components and hooks only; no new class components.[8]
- Group code by feature, not by type, under `src/features/<feature>/` (component, hook, API slice together).[9][5]

### State & Data Flow

- Use local component state for purely presentational concerns.
- Use a dedicated data layer (React Query / RTK Query) for server state; do not manually manage loading/error for API calls in multiple places.[10][8]
- No direct `fetch`/Axios calls inside deeply nested components; centralize API access in `src/lib/api` or feature-level API modules.[11][10]

### Styling & UI

- Use a single styling approach across the app (e.g. CSS Modules, Tailwind, or styled-components); do not mix ad hoc styles.[8]
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

## Backend (Flask) Rules

### Architecture & Layers

- Follow a layered, clean-architecture style:
  - `api/`: Blueprints, request parsing, response formatting.
  - `services/`: Business rules, orchestrating multiple repositories and external services.[6][7]
  - `repositories/`: DB access, ORM queries, external persistence.[6]
  - `models/`: Domain models / ORM models.
  - `schemas/`: Validation and serialization.[6]
- HTTP handlers must be thin; they should:
  - Validate and deserialize input via a schema.
  - Call a service function.
  - Serialize the service result to JSON.[2][6]

### Flask Conventions

- Use application factory pattern (`create_app(config_name)`) in `app/__init__.py`.[2]
- Register blueprints in a dedicated `register_blueprints(app)` function.[2]
- Use configuration objects or classes, not hard-coded values in modules.[2]

Example:

```python
# app/api/users.py
from flask import Blueprint, request, jsonify
from app.schemas.users import UserCreateSchema
from app.services.users import create_user

bp = Blueprint("users", __name__, url_prefix="/api/users")

@bp.post("")
def create_user_endpoint():
    payload = UserCreateSchema().load(request.get_json())
    user = create_user(payload)
    return jsonify(user), 201
```

### Python Code Style

- Follow PEP 8 strictly (4-space indents, 79-char lines, snake_case, clear names).[3][2]
- Avoid long functions; prefer smaller, testable units.[3]
- Exceptions:
  - Use custom exception classes for domain/business errors.
  - Map them to clear HTTP error responses via a global error handler.[2]

***

## API Contract & Frontend–Backend Integration

- All endpoints must be documented in `instructions/API_CONTRACT.md` (OpenAPI/Swagger or structured table).[12][13]
- The React app must never rely on implicit/undocumented responses:
  - Document request shape, response shape, status codes, and error formats.
- Use a stable base URL (e.g. `/api`) and environment-driven configuration:
  - Frontend: `VITE_API_URL` / `REACT_APP_API_URL`.
  - Backend: CORS allowed origins and host.[10][11]

Integration rules:

- Prefer JSON for all responses (`application/json`) except explicit file endpoints.[11][10]
- Handle CORS via a single configuration place (Flask-CORS or proxy in dev; no ad hoc CORS headers scattered).[10]

***

## Error Handling & Logging

- Never expose stack traces or internal error messages to the client in production.[10][2]
- Use a consistent error format, e.g.:

```json
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User not found",
    "details": {}
  }
}
```

- Frontend:
  - Show user-friendly messages.
  - Log technical details to the console only in development, or to a central logging service in production.[10]
- Backend:
  - Log at appropriate levels (INFO for normal flow, WARNING for recoverable issues, ERROR for failures).
  - Include correlation/request IDs when available.[4]

***

## Security & Data Validation

- Validate data on both client and server; client validation is UX, server validation is security.[10][8]
- Never trust client input; all incoming data must be validated by schemas or explicit checks.[10]
- Protect against:
  - SQL injection via parameterized queries/ORM only.
  - XSS by encoding output, not injecting raw HTML from user input.[10]
  - CSRF for state-changing requests if using cookies for auth.[8]

Secrets & configuration:

- Never commit real secrets; use `.env` + `.env.example`.
- All services must read configuration from environment variables or config files, not from constants in code.[4][8]

***

## Testing & Quality Gates

- Backend:
  - Use pytest for unit and integration tests.
  - Tests live under `backend/tests/` mirroring the app structure.[4][6]
- Frontend:
  - Use Jest + React Testing Library (or equivalent) for unit/component tests.[5][9]
- Each new feature must:
  - Have tests for happy-path and at least one failure-path.
  - Not decrease overall test coverage thresholds set in CI.

Example high-level commands (from `Makefile`):

```makefile
dev:
\tdocker-compose up

test:
\tcd backend && pytest
\tcd frontend && npm test -- --watch=false

lint:
\tcd backend && ruff check .
\tcd frontend && npm run lint
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
  - `instructions/API_CONTRACT.md` when API shape changes.
  - `instructions/DECISIONS.md` with a short ADR when making architectural/design changes.
- Never:
  - Introduce new frameworks or libraries without an explicit ADR.
  - Break public API contracts without updating API docs and a migration note.

Following these rules keeps the React–Flask stack maintainable, secure, and scalable for both humans and autonomous agents.
