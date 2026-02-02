# SlideSage

AI-assisted presentation generator that creates professional slides with rich content, charts, and beautiful templates.

## 🚀 Quick Start

```bash
# Clone and setup
git clone https://github.com/your-username/slide-sage.git
cd slide-sage

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Start development (Docker recommended)
./docker/scripts/dev.sh start
# or for manual development
bun dev
```

**Access Application:**

- **Frontend**: `http://localhost:5173`
- **Backend API**: `http://localhost:8000`
- **Database**: `localhost:5432`

### Docker Development Commands

```bash
# Start development environment with hot reload
./docker/scripts/dev.sh start

# View logs
./docker/scripts/dev.sh logs
./docker/scripts/dev.sh logs backend

# Stop development environment
./docker/scripts/dev.sh stop

# Restart development environment
./docker/scripts/dev.sh restart

# Clean up containers and images
./docker/scripts/dev.sh clean
```

### Docker Build Commands

```bash
# Build production images
./docker/scripts/build.sh prod

# Build development images
./docker/scripts/build.sh dev

# Build specific service
./docker/scripts/build.sh backend v1.0.0
```

### Manual Docker Compose

```bash
# Development (from project root)
docker-compose -f docker/compose/docker-compose.yml -f docker/compose/docker-compose.dev.yml up

# Production (from project root)
docker-compose -f docker/compose/docker-compose.yml -f docker/compose/docker-compose.prod.yml up
```

---

## 📋 Key Features

- **🤖 AI Generation**: Comprehensive slide decks from simple prompts
- **📊 Smart Charts**: Automatic data visualizations (Bar, Line, Pie, etc.)
- **⚡ Real-time Streaming**: Watch presentations build via Server-Sent Events
- **🎨 Professional Templates**: Multiple themes (Modern Dark, Corporate Blue, Minimalist)
- **🔐 Secure Authentication**: Email/password or Google OAuth
- **📄 Export Support**: Download presentations as editable PPTX files

---

## 📚 Documentation

### 🚀 Getting Started

| Document                                              | Description                           |
| ----------------------------------------------------- | ------------------------------------- |
| [**DEVELOPMENT_SETUP.md**](docs/DEVELOPMENT_SETUP.md) | Complete environment setup guide      |
| [**CODE_STANDARDS.md**](docs/CODE_STANDARDS.md)       | Coding conventions and best practices |

### 🏗️ Architecture & Technology

| Document                                                    | Description                                 |
| ----------------------------------------------------------- | ------------------------------------------- |
| [**MONOREPO_STRUCTURE.md**](docs/MONOREPO_STRUCTURE.md)     | Monorepo layout and workspace configuration |
| [**TECH_STACK.md**](docs/TECH_STACK.md)                     | Detailed technology stack overview          |
| [**BACKEND_ARCHITECTURE.md**](docs/BACKEND_ARCHITECTURE.md) | Backend layers and component design         |
| [**REQUEST_FLOWS.md**](docs/REQUEST_FLOWS.md)               | Request flow diagrams and sequences         |

### 🔌 API Documentation

| Document                                              | Description                                       |
| ----------------------------------------------------- | ------------------------------------------------- |
| [**API_OVERVIEW.md**](docs/API_OVERVIEW.md)           | General API standards and conventions             |
| [**AUTH_API.md**](docs/AUTH_API.md)                   | Authentication endpoints (login, register, OAuth) |
| [**PRESENTATIONS_API.md**](docs/PRESENTATIONS_API.md) | Presentation CRUD and AI generation endpoints     |

### 💻 Development Workflows

| Document                                                      | Description                                   |
| ------------------------------------------------------------- | --------------------------------------------- |
| [**DEVELOPMENT_WORKFLOWS.md**](docs/DEVELOPMENT_WORKFLOWS.md) | Feature development, testing, and code review |
| [**DEPLOYMENT_WORKFLOWS.md**](docs/DEPLOYMENT_WORKFLOWS.md)   | Docker deployment and CI/CD pipelines         |
| [**FRONTEND_ROUTING.md**](docs/FRONTEND_ROUTING.md)           | Frontend route map and auth guard             |

---

## 🛠️ Common Commands

### From Root Directory

```bash
bun dev              # Start all development servers (Turbo TUI)
bun dev:stream       # Start all development servers (plain logs)
bun build            # Build all applications
bun lint             # Lint all code
bun format           # Format all code
bun test             # Run all tests
```

### App-Specific Commands

```bash
# Backend only
turbo run dev --filter=backend
cd apps/backend && bun run db:studio

# Frontend only
turbo run dev --filter=frontend
turbo run build --filter=frontend
```

### Database Operations

```bash
cd apps/backend
bun run db:push      # Push schema changes
bun run db:migrate    # Run migrations
bun run db:studio     # Open Drizzle Studio
```

---

## 🏗️ Project Structure

```
slide-sage/
├── apps/                     # Applications
│   ├── backend/             # Hono API server (TypeScript + Drizzle)
│   ├── frontend/            # React SPA (Vite + Tailwind + Shadcn UI)
│   └── database/            # PostgreSQL service container
├── docker/                  # 🐳 Docker configuration
│   ├── compose/            # Docker Compose files
│   │   ├── docker-compose.yml      # Base configuration
│   │   ├── docker-compose.dev.yml  # Development overrides
│   │   └── docker-compose.prod.yml # Production overrides
│   ├── dockerfiles/        # Optimized Dockerfiles
│   │   ├── backend.Dockerfile      # Backend service
│   │   ├── frontend.Dockerfile     # Frontend service
│   │   └── database.Dockerfile    # Database service
│   ├── nginx/             # Production reverse proxy
│   ├── scripts/           # Helper scripts
│   │   ├── build.sh     # Build automation
│   │   └── dev.sh       # Development automation
│   └── README.md          # Docker documentation
├── docs/                    # 📚 Documentation
│   ├── API_OVERVIEW.md      # API standards and overview
│   ├── AUTH_API.md          # Authentication endpoints
│   ├── PRESENTATIONS_API.md # Presentation endpoints
│   ├── MONOREPO_STRUCTURE.md # Workspace structure
│   ├── TECH_STACK.md        # Technology stack details
│   ├── BACKEND_ARCHITECTURE.md # Backend layers
│   ├── REQUEST_FLOWS.md     # Request flow diagrams
│   ├── DEVELOPMENT_SETUP.md  # Environment setup guide
│   ├── DEVELOPMENT_WORKFLOWS.md # Development processes
│   ├── DEPLOYMENT_WORKFLOWS.md # Deployment guide
│   └── CODE_STANDARDS.md    # Coding standards
├── .env.example             # Environment template
├── .env                    # Environment configuration
├── turbo.json              # Turbo build system config
├── package.json            # Root workspace configuration
└── bun.lock               # Bun lockfile
```

### Technology Stack

- **Package Manager**: Bun workspaces for dependency management
- **Build System**: Turbo for task orchestration and caching
- **Backend**: TypeScript + Bun + Hono + Drizzle ORM + PostgreSQL
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI
- **Infrastructure**: Docker with multi-stage builds and optimized images
- **Database**: PostgreSQL 16 Alpine with health checks
- **Production**: Nginx reverse proxy with SSL support

---

## 🔄 Development Workflow

### 1. Feature Development

1. **Plan**: Read [DEVELOPMENT_WORKFLOWS.md](docs/DEVELOPMENT_WORKFLOWS.md)
2. **Setup**: Follow [DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md)
3. **Code**: Follow [CODE_STANDARDS.md](docs/CODE_STANDARDS.md)
4. **Test**: Use test commands and follow guidelines
5. **Review**: Check code quality and standards

### 2. API Development

1. **Design**: Reference [API_OVERVIEW.md](docs/API_OVERVIEW.md)
2. **Backend**: Follow [BACKEND_ARCHITECTURE.md](docs/BACKEND_ARCHITECTURE.md)
3. **Documentation**: Update appropriate API docs:
   - [AUTH_API.md](docs/AUTH_API.md) for authentication
   - [PRESENTATIONS_API.md](docs/PRESENTATIONS_API.md) for presentations

### 3. Deployment

1. **Local Development**: Use `./docker/scripts/dev.sh start`
2. **Production**:
   - Build with `./docker/scripts/build.sh prod`
   - Deploy with `docker-compose -f docker/compose/docker-compose.yml -f docker/compose/docker-compose.prod.yml up`
3. **CI/CD**: Use automated pipelines and monitoring

---

## 🔧 Configuration

### Environment Variables

All services use a single `.env` file in the project root:

```bash
# Copy example configuration
cp .env.example .env

# Backend Configuration
DATABASE_URL=postgresql://slidesage:slidesage@localhost:5432/slidesage
JWT_SECRET_KEY=change-this-secret-key-in-production
GROQ_API_KEY=your-groq-api-key
LITELLM_MODEL=groq/moonshotai/kimi-k2-instruct-0905

# Frontend Configuration
VITE_API_URL=http://localhost:8000
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret

# Server Configuration
PORT=8000
BASE_URL=http://localhost:8000

# CORS
CORS_ORIGINS=*
```

---

## 📝 Notes & Troubleshooting

### Common Issues

- **Database Connection**: Ensure PostgreSQL is running and `DATABASE_URL` is correct
- **Frontend API**: Verify `VITE_API_URL` matches backend port
- **Authentication**: Check that `JWT_SECRET_KEY` is set and consistent
- **Token Issues**: Ensure AI API keys are valid and have sufficient credits
- **Docker Build Failures**:
  - Check that `.env` file exists in project root
  - Ensure Docker is running and has sufficient permissions
  - Try `./docker/scripts/dev.sh clean` to reset containers

### Getting Help

1. **Check Documentation**: Start with relevant docs in `/docs` folder
2. **Review Logs**: Check `docker-compose logs` for service issues
3. **Test API**: Use `/api/health` endpoint to verify backend
4. **Validate Setup**: Ensure all environment variables are configured

---

## 🎯 Monorepo Benefits

- **🔄 Shared Dependencies**: Common packages managed centrally
- **⚡ Parallel Development**: Multiple apps developed simultaneously
- **🔧 Unified Tooling**: Single configuration for linting, formatting
- **📦 Atomic Commits**: Changes across frontend and backend in one PR
- **🚀 Simplified CI/CD**: Build and test everything together
- **💡 Code Sharing**: Easy sharing of types and utilities

---

## 📖 Documentation Guide

- **New to project?** → Start with [DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md)
- **Adding features?** → Read [DEVELOPMENT_WORKFLOWS.md](docs/DEVELOPMENT_WORKFLOWS.md)
- **Working with API?** → Check [API_OVERVIEW.md](docs/API_OVERVIEW.md) first
- **Deploying?** → Follow [DEPLOYMENT_WORKFLOWS.md](docs/DEPLOYMENT_WORKFLOWS.md)
- **Need architecture info?** → See [MONOREPO_STRUCTURE.md](docs/MONOREPO_STRUCTURE.md)

---

## 🤝 Contributing

1. **Follow Standards**: Adhere to [CODE_STANDARDS.md](docs/CODE_STANDARDS.md)
2. **Update Documentation**: Keep API docs current when making changes
3. **Test Thoroughly**: Ensure tests pass for new features
4. **Use Conventional Commits**: Follow the commit message format in standards

---
