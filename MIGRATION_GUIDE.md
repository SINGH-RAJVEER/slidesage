# Migration from Flask to Bun + TypeScript Backend

## Overview

This project has been successfully ported from Python/Flask to TypeScript with Bun runtime, using:

- **Runtime**: Bun (replacing Python)
- **Web Framework**: Hono (replacing Flask)
- **Database**: Drizzle ORM with Postgres (replacing SQLAlchemy)
- **Authentication**: Jose JWT library (replacing Flask-JWT-Extended)

## Directory Structure

```
backend-ts/
├── src/
│   ├── db/
│   │   ├── index.ts          # Database connection
│   │   ├── schema.ts         # Drizzle schema definitions
│   │   └── migrate.ts        # Migration runner
│   ├── repositories/
│   │   ├── user.repository.ts
│   │   └── presentation.repository.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── presentation.service.ts
│   │   ├── ai.service.ts
│   │   └── ai-prompts.ts
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   └── presentation.routes.ts
│   ├── middleware/
│   │   └── auth.middleware.ts
│   ├── utils/
│   │   └── stream-processor.ts
│   └── index.ts              # Main application entry
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── Dockerfile
└── .env.example
```

## Key Differences from Flask Backend

### 1. Database Layer

- **Before**: SQLAlchemy with Flask models
- **After**: Drizzle ORM with type-safe queries
- All database operations now use async/await
- Schema defined in `src/db/schema.ts`

### 2. Authentication

- **Before**: Flask-JWT-Extended
- **After**: Jose library for JWT signing/verification
- Password hashing still uses bcrypt (bcryptjs)
- Google OAuth using google-auth-library

### 3. API Framework

- **Before**: Flask with blueprints
- **After**: Hono with route groups
- Middleware architecture similar to Flask
- Server-Sent Events (SSE) for streaming

### 4. Type Safety

- Full TypeScript support with strict typing
- All models, requests, and responses are typed
- Better IDE support and compile-time error checking

## Setup Instructions

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Install Dependencies

```bash
cd backend-ts
bun install
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

Required environment variables:

```env
DATABASE_URL=postgresql://slidesage:slidesage@localhost:5432/slidesage
JWT_SECRET_KEY=your-secret-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
LITELLM_MODEL=openai/gpt-4
OPENAI_API_KEY=your-openai-api-key
CORS_ORIGINS=http://localhost:5173
```

### 4. Run Database Migrations

```bash
bun run db:migrate
```

### 5. Start Development Server

```bash
bun run dev
```

The server will start on `http://localhost:8000`

## API Compatibility

The TypeScript backend maintains full API compatibility with the Flask version:

### Authentication Endpoints

- ✅ POST `/api/auth/register`
- ✅ POST `/api/auth/login`
- ✅ POST `/api/auth/google`
- ✅ POST `/api/auth/refresh`
- ✅ GET `/api/auth/me`
- ✅ PUT `/api/auth/profile`
- ✅ POST `/api/auth/logout`

### Presentation Endpoints

- ✅ POST `/api/generate-presentation-stream` (SSE streaming)
- ✅ GET `/api/presentations`
- ✅ GET `/api/presentations/:id`
- ✅ DELETE `/api/presentations/:id`

## Docker Deployment

Use the new docker-compose file:

```bash
docker-compose -f docker-compose-ts.yml up -d
```

## Performance Benefits

1. **Faster Startup**: Bun starts up much faster than Python
2. **Lower Memory**: Bun uses less memory than Python/Flask
3. **Better Concurrency**: Native async/await support
4. **Type Safety**: Catch errors at compile time

## Migration Checklist

- [x] Database models ported to Drizzle schemas
- [x] User repository with password hashing
- [x] Presentation repository with JSONB support
- [x] Auth service with JWT and Google OAuth
- [x] Presentation service with token management
- [x] AI service with streaming support
- [x] All API routes ported to Hono
- [x] Authentication middleware
- [x] Docker configuration
- [x] Environment configuration

## Frontend Changes Required

The frontend should work without changes, but update the API base URL if needed:

```typescript
const API_BASE_URL = "http://localhost:8000/api";
```

## Troubleshooting

### Database Connection Issues

```bash
# Check if Postgres is running
docker ps | grep postgres

# Test connection
psql postgresql://slidesage:slidesage@localhost:5432/slidesage
```

### Port Already in Use

```bash
# Change port in .env
PORT=8001
```

### TypeScript Errors

```bash
# Reinstall dependencies
rm -rf node_modules
bun install
```

## Next Steps

1. Test all API endpoints
2. Update frontend to use new backend
3. Set up production environment variables
4. Configure reverse proxy (nginx)
5. Set up monitoring and logging

## Support

For issues or questions, refer to:

- Bun documentation: https://bun.sh/docs
- Hono documentation: https://hono.dev
- Drizzle ORM: https://orm.drizzle.team
