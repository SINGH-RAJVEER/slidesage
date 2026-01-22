# 🎉 SlideSage Project

## Overview

SlideSage is a full-stack application with a React frontend and a TypeScript backend using Bun, Hono, and Drizzle ORM.

---

## 🚀 Quick Start (3 Steps)

### 1. Configure Environment

```bash
cd backend
# Edit .env with your API keys
nano .env
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Start the Server

```bash
bun run dev
```

**That's it!** Your backend is now running on `http://localhost:8000`

---

## 📚 Documentation

| Document                                       | Description                         |
| ---------------------------------------------- | ----------------------------------- |
| [QUICKSTART_TS.md](./QUICKSTART_TS.md)         | 🚀 Quick start guide                |
| [ARCHITECTURE.md](./ARCHITECTURE.md)           | 🏗️ Architecture diagrams            |
| [backend/README.md](../backend/README.md)      | 📘 Backend-specific documentation   |

---

## ✨ Features

### Performance

- ⚡ **Fast** startup and response times
- 🚀 **High** throughput
- 💾 **Efficient** memory usage

### Developer Experience

- ✅ Full TypeScript type safety
- ✅ Hot reload in development
- ✅ Better error messages
- ✅ IDE autocomplete for everything

### Technology Stack

- **Runtime**: Bun (fast JavaScript/TypeScript runtime)
- **Framework**: Hono (Express-like, optimized for Bun)
- **Database**: Drizzle ORM (type-safe SQL queries)
- **Auth**: Better Auth
- **DB**: PostgreSQL

---

## 🐳 Docker Support

### Start Everything

```bash
docker-compose up -d
```

### View Logs

```bash
docker-compose logs -f backend
```

### Stop

```bash
docker-compose down
```

---

## 📊 File Structure

```
backend/
├── src/
│   ├── index.ts                    # Main app entry
│   ├── db/                         # Database layer
│   │   ├── index.ts               # Connection
│   │   ├── schema.ts              # Models
│   │   └── migrate.ts             # Migrations
│   ├── repositories/               # Data access
│   ├── services/                   # Business logic
│   ├── routes/                     # API endpoints
│   ├── middleware/                 # Auth, CORS, etc.
│   └── utils/                      # Utilities
├── package.json                    # Dependencies
├── tsconfig.json                   # TypeScript config
├── drizzle.config.ts              # ORM config
├── Dockerfile                      # Docker image
└── .env.example                    # Environment template
```

---

## 🔧 Available Commands

```bash
# Development
bun run dev              # Start with hot reload

# Production
bun run start            # Start production server

# Database
bun run db:migrate       # Run migrations
bun run db:studio        # Open database GUI
bun run db:generate      # Generate migrations
bun run db:push          # Push schema changes

# Installation
bun install              # Install dependencies
```

---

## ⚙️ Environment Variables

Edit `backend/.env`:

```env
# Server
PORT=8000

# Database
DATABASE_URL=postgresql://slidesage:slidesage@localhost:5432/slidesage

# JWT (if applicable)
JWT_SECRET_KEY=your-secret-key-here

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# AI/LLM
LITELLM_MODEL=openai/gpt-4
OPENAI_API_KEY=your-openai-api-key

# CORS
CORS_ORIGINS=http://localhost:5173
```

---

## 🎓 Architecture

```
Client (React)
    ↓
Hono Framework
    ↓
Middleware (CORS, Auth, Logger)
    ↓
Route Handlers
    ↓
Service Layer (Business Logic)
    ↓
Repository Layer (Data Access)
    ↓
Drizzle ORM
    ↓
PostgreSQL Database
```

---

**Enjoy your SlideSage application!** 🎊
