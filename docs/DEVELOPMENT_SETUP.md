# Development Setup

Complete guide to setting up the SlideSage development environment.

## Prerequisites

### Required Software

- **Bun** (1.0+): Package manager and runtime
- **Docker** & **Docker Compose**: Container management
- **Git**: Version control

### Optional but Recommended

- **PostgreSQL Client**: For direct database access
- **VS Code**: Recommended IDE with extensions

### Installation Commands

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Docker (Linux)
sudo apt update
sudo apt install docker.io docker-compose

# Verify installations
bun --version
docker --version
docker-compose --version
```

## Initial Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-username/slide-sage.git
cd slide-sage
```

### 2. Install Dependencies

```bash
# Install all workspace dependencies
bun install

# This installs dependencies for:
# - Root workspace (turbo, prettier)
# - Backend app
# - Frontend app
```

### 3. Configure Environment Variables

#### Backend Configuration

```bash
# Copy example environment file
cp apps/backend/.env.example apps/backend/.env

# Edit with your configuration
nano apps/backend/.env
```

**Required Backend Variables:**

```bash
PORT=8000
DATABASE_URL=postgresql://user:password@localhost:5432/slide_sage
JWT_SECRET_KEY=your-super-secret-jwt-key-here
GEMINI_API_KEY=your-gemini-api-key
GROQ_API_KEY=your-groq-api-key
LITELLM_MODEL=gemini-pro
CORS_ORIGINS=http://localhost:5173
```

#### Frontend Configuration

```bash
# Copy example environment file
cp apps/frontend/.env.example apps/frontend/.env

# Edit with your configuration
nano apps/frontend/.env
```

**Required Frontend Variables:**

```bash
VITE_API_URL=http://localhost:8000/api
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
```

### 4. Start Development Services

#### Option A: Docker (Recommended)

```bash
# Start all services with Docker
docker-compose up --build

# Services started:
# - slide-sage-frontend (port 5173)
# - slide-sage-backend (port 8000)
# - slide-sage-database (port 5432)
```

#### Option B: Local Development

```bash
# Start PostgreSQL (if running locally)
docker-compose up database -d

# Start development servers
bun dev

# Or start individual services:
turbo run dev --filter=backend
turbo run dev --filter=frontend
```

## Verify Setup

### Check Services

```bash
# Test backend health
curl http://localhost:8000/api/health

# Check frontend (open in browser)
open http://localhost:5173

# Verify database connection
cd apps/database && bun run db:studio
```

### Expected Responses

#### Health Check

```json
{
  "status": "healthy",
  "message": "SlideSage API is running",
  "timestamp": "2026-01-04T12:00:00Z"
}
```

#### Frontend Loading

- React development server should load
- No 404 errors in console
- API calls should connect to backend

## IDE Configuration

### VS Code Extensions (Recommended)

```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-json",
    "ms-vscode.vscode-docker"
  ]
}
```

### VS Code Settings

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

## Troubleshooting

### Common Issues

#### Port Already in Use

```bash
# Find process using port
lsof -i :8000  # Backend
lsof -i :5173  # Frontend

# Kill process
kill -9 <PID>

# Or change ports in .env files
echo "PORT=8001" >> apps/backend/.env
```

#### Database Connection Failed

```bash
# Check if database is running
docker-compose ps

# Restart database
docker-compose restart database

# Check database logs
docker-compose logs database

# Test connection manually
psql postgresql://user:password@localhost:5432/slide_sage
```

#### Dependency Installation Failed

```bash
# Clear cache and reinstall
rm -rf node_modules
bun install

# Clear Bun cache
bun pm cache rm
bun install
```

#### Frontend Build Errors

```bash
# Clear Vite cache
cd apps/frontend
rm -rf .vite
bun dev

# Check TypeScript errors
bun run build
```

## Development Tools

### Useful Commands

```bash
# Database operations
cd apps/database
bun run db:push      # Push schema changes
bun run db:studio    # Open Drizzle Studio
bun run db:generate  # Generate migrations

# Code quality
bun lint            # Lint all code
bun format          # Format all code
bun build           # Build all apps

# Individual app commands
turbo run dev --filter=backend
turbo run test --filter=frontend
```

### Database Management

```bash
# View tables and data
cd apps/database
bun run db:studio

# Reset database (development only)
bun run db:migrate  # Run migrations
# Or manually reset via:
# docker-compose down database
# docker-compose up database
```

## Next Steps

After setup is complete:

1. **Create Test User**: Register via the frontend UI
2. **Generate Presentation**: Try the AI generation feature
3. **Explore Codebase**: Read the architecture documentation
4. **Set Up Testing**: Configure test environment

For development workflows, see [DEVELOPMENT_WORKFLOWS.md](DEVELOPMENT_WORKFLOWS.md).
