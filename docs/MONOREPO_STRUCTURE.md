# Monorepo Structure

SlideSage uses a monorepo architecture with Bun workspaces and Turbo for optimal development experience.

## Directory Layout

```
slide-sage/
├── apps/                     # Applications
│   ├── APIs/             # Hono API server
│   │   ├── src/
│   │   │   ├── lib/         # Shared libraries
│   │   │   ├── middleware/  # Hono middleware
│   │   │   ├── db/          # Drizzle schema + DB client
│   │   │   ├── repositories/# Database access layer
│   │   │   ├── routes/      # API route definitions
│   │   │   ├── services/    # Business logic and orchestration
│   │   │   ├── types/       # TypeScript type definitions
│   │   │   ├── utils/       # Utility functions
│   │   │   └── index.ts     # Application entry point
│   │   ├── drizzle/         # Drizzle migrations + snapshots
│   │   ├── drizzle.config.ts # Drizzle-kit config
│   │   ├── biome.json       # Linter/Formatter config
│   │   └── package.json
│   ├── Web/            # React SPA
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
- **Runtime**: Bun for both Web and APIs
- **Containerization**: Docker for development and deployment

### Application Layer

- **APIs**: TypeScript + Bun + Hono + Drizzle ORM
- **Web**: React + Vite + Tailwind CSS + Shadcn UI
- **Database**: PostgreSQL with type-safe queries
- **Authentication**: JWT + Google OAuth 2.0

## Benefits

1. **Shared Code**: Database schema and utilities shared across apps
2. **Atomic Commits**: Changes across Web and APIs in one PR
3. **Unified Tooling**: Single configuration for linting, formatting
4. **Code Sharing**: Easy sharing of types and utilities between apps
5. **Simplified CI/CD**: Build and test everything together
6. **Consistent Environment**: Same versions across all packages

For detailed technology information, see [TECH_STACK.md](TECH_STACK.md).
