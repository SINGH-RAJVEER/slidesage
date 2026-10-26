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
	edge/       Cloudflare Container lifecycle and private R2 gateway
	web/        React web application
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
- [CI/CD: Pages and Containers releases](docs/CI_CD.md)
- [Production infrastructure](docs/PRODUCTION_INFRASTRUCTURE.md)
- [Cloudflare deployment and cutover](docs/CLOUDFLARE_DEPLOYMENT.md)
- [Architecture](docs/API_ARCHITECTURE.md)
- [Card document architecture](docs/CARD_ARCHITECTURE.md)
- [Card documents](docs/CARD_DOCUMENTS.md)
- [API reference](docs/API_OVERVIEW.md)
- [Authentication](docs/AUTH_API.md)
- [Web research](docs/WEB_RESEARCH.md)
- [Prefetching](docs/PREFETCHING.md)
- [Observability](docs/OBSERVABILITY.md)
- [Feedback and bug reports](docs/FEEDBACK.md)
- [Ads](docs/ADS.md)
- [Mobile UI](docs/MOBILE_UI.md)
- [Ad rewards](docs/AD_REWARDS.md)
