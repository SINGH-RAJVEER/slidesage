# Monorepo Structure

SlideSage uses a monorepo architecture with Bun workspaces and Turbo for optimal development experience.

## Directory Layout

```
slide-sage/
├── apps/                     # Applications
│   ├── backend/             # Hono API server
│   │   ├── src/
│   │   │   ├── lib/         # Shared libraries
│   │   │   ├── middleware/  # Hono middleware
│   │   │   ├── repositories/# Database access layer
│   │   │   ├── routes/      # API route definitions
│   │   │   ├── services/    # Business logic and orchestration
│   │   │   ├── types/       # TypeScript type definitions
│   │   │   ├── utils/       # Utility functions
│   │   │   └── index.ts     # Application entry point
│   │   ├── biome.json       # Linter/Formatter config
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
│   └── database/            # Shared database package
│       ├── src/
│       │   ├── index.ts     # Database connection
│       │   └── schema.ts    # Drizzle schema definitions
│       ├── drizzle.config.ts # ORM config
│       └── package.json     # @slide-sage/database
├── docs/                    # Documentation
├── turbo.json              # Turbo configuration
├── package.json            # Root workspace configuration
├── docker-compose.yml      # Development containers
└── README.md
```

## Workspace Configuration

### Root package.json

```json
{
  "name": "slide-sage-monorepo",
  "workspaces": ["apps/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "format": "turbo run format"
  }
}
```

### Turbo Configuration

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "format": {}
  }
}
```

## Technology Stack Overview

### Infrastructure Layer

- **Package Manager**: Bun workspaces for dependency management
- **Build System**: Turbo for task orchestration and caching
- **Runtime**: Bun for both frontend and backend
- **Containerization**: Docker for development and deployment

### Application Layer

- **Backend**: TypeScript + Bun + Hono + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI
- **Database**: PostgreSQL with type-safe queries
- **Authentication**: JWT + Google OAuth 2.0

## Benefits

1. **Shared Code**: Database schema and utilities shared across apps
2. **Atomic Commits**: Changes across frontend and backend in one PR
3. **Unified Tooling**: Single configuration for linting, formatting
4. **Code Sharing**: Easy sharing of types and utilities between apps
5. **Simplified CI/CD**: Build and test everything together
6. **Consistent Environment**: Same versions across all packages

For detailed technology information, see [TECH_STACK.md](TECH_STACK.md).
