# TypeScript Backend Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (Frontend)                        │
│                  React + Vite + Tailwind                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Hono Web Framework                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Middleware Layer                        │  │
│  │  • CORS                                              │  │
│  │  • Logger                                            │  │
│  │  • Auth (JWT Verification)                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Route Handlers                          │  │
│  │  ┌──────────────┐    ┌─────────────────────────┐   │  │
│  │  │ Auth Routes  │    │ Presentation Routes     │   │  │
│  │  │              │    │                         │   │  │
│  │  │ • Register   │    │ • Generate (SSE Stream) │   │  │
│  │  │ • Login      │    │ • List                  │   │  │
│  │  │ • Google     │    │ • Get                   │   │  │
│  │  │ • Refresh    │    │ • Delete                │   │  │
│  │  │ • Profile    │    │                         │   │  │
│  │  └──────────────┘    └─────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Service Layer                             │
│  ┌──────────────────┐  ┌─────────────────────────────────┐ │
│  │  Auth Service    │  │  Presentation Service           │ │
│  │                  │  │                                 │ │
│  │  • JWT tokens    │  │  • Token calculation            │ │
│  │  • Password hash │  │  • Token deduction              │ │
│  │  • OAuth verify  │  │  • Generation orchestration     │ │
│  │  • Profile mgmt  │  │  • CRUD operations              │ │
│  └──────────────────┘  └─────────────────────────────────┘ │
│           │                         │                        │
│           │            ┌────────────┴──────────┐            │
│           │            │                       │            │
│           │            ▼                       │            │
│           │  ┌─────────────────────┐          │            │
│           │  │    AI Service       │          │            │
│           │  │                     │          │            │
│           │  │  • Prompt builder   │          │            │
│           │  │  • LLM API calls    │          │            │
│           │  │  • Stream processor │          │            │
│           │  │  • Slide parser     │          │            │
│           │  └─────────────────────┘          │            │
│           │            │                       │            │
│           │            │                       │            │
└───────────┼────────────┼───────────────────────┼────────────┘
            │            │                       │
            ▼            ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Repository Layer                            │
│  ┌──────────────────────┐  ┌─────────────────────────────┐ │
│  │  User Repository     │  │  Presentation Repository    │ │
│  │                      │  │                             │ │
│  │  • create()          │  │  • create()                 │ │
│  │  • findById()        │  │  • findById()               │ │
│  │  • findByEmail()     │  │  • findByUserId()           │ │
│  │  • update()          │  │  • update()                 │ │
│  │  • verifyPassword()  │  │  • delete()                 │ │
│  │  • deductTokens()    │  │                             │ │
│  │  • awardBonus()      │  │                             │ │
│  └──────────────────────┘  └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Drizzle ORM                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Schema Definitions                                 │   │
│  │  • users (id, email, password_hash, tokens, ...)   │   │
│  │  • presentations (id, user_id, slides_data, ...)   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL Database (v16)                       │
│  ┌──────────────┐    ┌────────────────────────┐            │
│  │ users table  │    │ presentations table    │            │
│  │              │    │                        │            │
│  │ • Primary    │◄───┤ • Foreign key (user)  │            │
│  │   keys       │    │ • JSONB (slides_data)  │            │
│  │ • Indexes    │    │ • Self-reference       │            │
│  └──────────────┘    └────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘

External Services:
┌──────────────────┐    ┌──────────────────┐
│ Google OAuth API │    │ OpenAI / LLM API │
└──────────────────┘    └──────────────────┘
```

## Request Flow Examples

### 1. User Registration Flow

```
Client
  │
  ├─► POST /api/auth/register
  │   { email, name, password }
  │
  ▼
Hono Router
  │
  ├─► auth.routes.ts (register handler)
  │
  ▼
Auth Service
  │
  ├─► validateEmail()
  ├─► checkDuplicate()
  │
  ▼
User Repository
  │
  ├─► hashPassword()
  ├─► insertUser()
  │
  ▼
Drizzle ORM
  │
  ├─► INSERT INTO users ...
  │
  ▼
PostgreSQL
  │
  ◄── User record created
  │
  ◄── JWT tokens generated
  │
  ◄── Response: { user, access_token, refresh_token }
```

### 2. Generate Presentation Flow (SSE)

```
Client
  │
  ├─► POST /api/generate-presentation-stream
  │   { topic, slide_count, detail_level, tonality }
  │   + Authorization: Bearer <token>
  │
  ▼
Hono Router + Auth Middleware
  │
  ├─► Verify JWT token
  ├─► Extract userId
  │
  ▼
Presentation Service
  │
  ├─► Check user tokens
  ├─► Deduct tokens
  ├─► Start generation
  │
  ▼
AI Service
  │
  ├─► Build system prompt
  ├─► Call LLM API (streaming)
  │
  ▼
Stream Processor
  │
  ├─► Parse chunks
  ├─► Extract theme ──────► SSE: event:theme
  ├─► Extract slide 1 ────► SSE: event:slide
  ├─► Extract slide 2 ────► SSE: event:slide
  ├─► ...
  ├─► Complete ───────────► SSE: event:complete
  │
  ▼
Presentation Repository
  │
  ├─► Save presentation
  │   (slides_data as JSONB)
  │
  ▼
PostgreSQL
  │
  ◄── Presentation saved
  │
  ◄── SSE: event:saved
```

### 3. Get Presentations Flow

```
Client
  │
  ├─► GET /api/presentations
  │   + Authorization: Bearer <token>
  │
  ▼
Hono Router + Auth Middleware
  │
  ├─► Verify JWT
  ├─► Extract userId
  │
  ▼
Presentation Service
  │
  ├─► getUserPresentations(userId)
  │
  ▼
Presentation Repository
  │
  ├─► findByUserId(userId)
  │
  ▼
Drizzle ORM
  │
  ├─► SELECT * FROM presentations
  │   WHERE user_id = $1
  │   ORDER BY created_at DESC
  │
  ▼
PostgreSQL
  │
  ◄── Array of presentations
  │
  ◄── Transform to JSON
  │
  ◄── Response: { presentations: [...] }
```

## Technology Stack Visualization

```
┌─────────────────────────────────────────────┐
│         Runtime: Bun (1.0+)                 │
│  Fast JavaScript/TypeScript runtime         │
└─────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│      Language: TypeScript (5.0+)            │
│  Type-safe, compiled to efficient JS        │
└─────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│     Framework: Hono (4.6+)                  │
│  Express-like, optimized for Bun            │
└─────────────────────────────────────────────┘
              │
              ├─► ORM: Drizzle (0.36+)
              │   Type-safe SQL queries
              │
              ├─► Auth: Jose (5.9+)
              │   JWT signing/verification
              │
              ├─► Password: bcryptjs (2.4+)
              │   Bcrypt hashing
              │
              └─► OAuth: google-auth-library (9.15+)
                  Google OAuth verification
```

## Key Advantages

1. **Type Safety**: TypeScript catches errors at compile time
2. **Performance**: Bun is 3x faster than Node.js
3. **Developer Experience**: Hot reload, better errors, autocomplete
4. **Modern Stack**: Latest technologies, active development
5. **Single Runtime**: No Python + Node, just Bun
6. **Better Concurrency**: Native async/await, no GIL
7. **Lower Memory**: ~30MB vs ~80MB with Flask
8. **Faster Startup**: 0.3s vs 2.1s with Flask
