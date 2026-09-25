# SlideSage

SlideSage is a presentation builder with AI-assisted research and generation. The React app lets users create, revise, preview, store, and export slide decks.

---

## Features

- Durable presentation generation jobs with resumable progress
- Web research with cited sources
- Reviewed web sources attached to generated decks

## Repository

```text
apps/
    api/        Go API, Goose migrations, repositories, and provider integrations
    web/        React web application
    converter/  Bun service that validates drafts into card documents
libs/
    cards/      Card document schema and validation
    types/      Shared TypeScript contracts
    ui/         Shared React UI primitives
docs/           Maintainer documentation
devenv.nix      Local toolchain and service orchestration
Justfile        Common development commands
```

## Documentation

- [Development setup](docs/DEVELOPMENT_SETUP.md)
- [Environment variables](docs/ENVIRONMENT_VARIABLES.md)
- [CI/CD: Artifact Registry and Cloud Run](docs/CI_CD.md)
- [Production infrastructure](docs/PRODUCTION_INFRASTRUCTURE.md)
- [Architecture](docs/API_ARCHITECTURE.md)
- [Card document proposal](docs/GAMMA_ARCHITECTURE.md)
- [Card documents](docs/CARD_DOCUMENTS.md)
- [API reference](docs/API_OVERVIEW.md)
- [Authentication](docs/AUTH_API.md)
- [Web research](docs/WEB_RESEARCH.md)
- [Observability](docs/OBSERVABILITY.md)
