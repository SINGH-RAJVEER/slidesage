# APIs Architecture

Detailed APIs architecture and layer design for SlideSage.

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Hono Web Framework                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Middleware Layer                        │  │
│  │  • CORS                                              │
│  │  • Logger                                            │
│  │  • Auth (JWT Verification)                          │
│  │  • Error Handling                                    │
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
│                    Service Layer                         │
│  ┌──────────────────┐  ┌─────────────────────────────┐ │
│  │  Auth Service    │  │  Presentation Service        │ │
│  │                  │  │                             │ │
│  │  • JWT tokens    │  │  • Token calculation        │ │
│  │  • Password hash │  │  • Token deduction          │ │
│  │  • OAuth verify  │  │  • Generation orchestration │ │
│  │  • Profile mgmt  │  │  • CRUD operations          │ │
│  └──────────────────┘  └─────────────────────────────┘ │
│           │                         │                    │
│           │            ┌────────────┴──────────┐         │
│           │            │                       │         │
│           │            ▼                       │         │
│           │  ┌─────────────────────┐          │         │
│           │  │    AI Service       │          │         │
│           │  │                     │          │         │
│           │  │  • Prompt builder   │          │         │
│           │  │  • LLM API calls    │          │         │
│           │  │  • Stream processor │          │         │
│           │  │  • Slide parser     │          │         │
│           │  └─────────────────────┘          │         │
│           │            │                       │         │
└───────────┼────────────┼───────────────────────┼─────────┘
            │            │                       │
            ▼            ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Repository Layer                          │
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
│                   Drizzle ORM                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Schema Definitions                                 │   │
│  │  • users (id, email, password_hash, tokens, ...)   │   │
│  │  • presentations (id, user_id, slides_data, ...)   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL Database (v16)                      │
└─────────────────────────────────────────────────────────────┘
```

## Route Handler Layer

### Structure

```typescript
// src/routes/auth.routes.ts
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.middleware";
import { authService } from "../services/auth.service";
import type { LoginRequest, RegisterRequest } from "../types/auth";

const authRoutes = new Hono();

// POST /api/auth/register
authRoutes.post("/register", async (c) => {
  const data = (await c.req.json()) as RegisterRequest;
  const result = await authService.register(data);
  return c.json(result, 201);
});

// POST /api/auth/login
authRoutes.post("/login", async (c) => {
  const data = (await c.req.json()) as LoginRequest;
  const result = await authService.login(data);
  return c.json(result);
});
```

### Responsibilities

- Request validation and type checking
- Call appropriate service methods
- Handle HTTP status codes
- Format response structure
- Error handling at HTTP level

## Service Layer

### Example Service

```typescript
// src/services/auth.service.ts
import { UserRepository } from "../repositories/user.repository";
import { jwtService } from "../lib/jwt";
import { bcryptService } from "../lib/bcrypt";
import type { User, LoginRequest, RegisterRequest } from "../types/auth";

export class AuthService {
  private userRepo = new UserRepository();

  async register(data: RegisterRequest) {
    // Business logic
    const existingUser = await this.userRepo.findByEmail(data.email);
    if (existingUser) {
      throw new Error("Email already registered");
    }

    const hashedPassword = await bcryptService.hash(data.password);
    const user = await this.userRepo.create({
      ...data,
      password_hash: hashedPassword,
      slide_tokens: 10.0,
    });

    const tokens = jwtService.generateTokens(user);
    return { user, ...tokens };
  }

  async login(data: LoginRequest) {
    const user = await this.userRepo.findByEmail(data.email);
    if (!user) {
      throw new Error("Invalid credentials");
    }

    const isValid = await bcryptService.verify(
      data.password,
      user.password_hash,
    );
    if (!isValid) {
      throw new Error("Invalid credentials");
    }

    const tokens = jwtService.generateTokens(user);
    return { user, ...tokens };
  }
}
```

### Responsibilities

- Business logic implementation
- Orchestration of multiple repositories
- External service integrations
- Transaction management
- Domain-level validation

## Repository Layer

### Example Repository

```typescript
// src/repositories/user.repository.ts
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import type { User, NewUser } from "../types/user";

export class UserRepository {
  async create(userData: NewUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async findById(id: number): Promise<User | null> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0] || null;
  }

  async updateTokens(userId: number, tokens: number): Promise<void> {
    await db
      .update(users)
      .set({ slide_tokens: tokens })
      .where(eq(users.id, userId));
  }
}
```

### Responsibilities

- Database access abstraction
- Type-safe queries using Drizzle ORM
- SQL query optimization
- Connection management
- Data transformation

## Database Layer

### Schema Definition

```typescript
// src/db/schema.ts
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  real,
  jsonb,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  password_hash: text("password_hash").notNull(),
  slide_tokens: real("slide_tokens").default(10.0),
  profile_picture_url: text("profile_picture_url"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

export const presentations = pgTable("presentations", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id")
    .references(() => users.id)
    .notNull(),
  title: text("title").notNull(),
  slide_count: integer("slide_count").default(1),
  slides_data: jsonb("slides_data").notNull(),
  theme: text("theme").default("modern"),
  tokens_used: integer("tokens_used").default(0),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});
```

### Responsibilities

- Database schema definition
- Type generation
- Migration management
- Connection configuration

## Middleware Layer

### Authentication Middleware

```typescript
// src/middleware/auth.middleware.ts
import { Context, Next } from "hono";
import { jwtService } from "../lib/jwt";

export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: { message: "Authorization required" } }, 401);
  }

  const token = authHeader.substring(7);
  const payload = jwtService.verifyAccessToken(token);

  if (!payload) {
    return c.json({ error: { message: "Invalid token" } }, 401);
  }

  c.set("userId", payload.userId);
  c.set("email", payload.email);

  await next();
};
```

### Responsibilities

- Request preprocessing
- Authentication and authorization
- Request logging
- Error handling
- CORS management

## Configuration

### Environment Variables

```typescript
// src/config/index.ts
export const config = {
  port: parseInt(process.env.PORT || "8000"),
  database: {
    url: process.env.DATABASE_URL!,
  },
  jwt: {
    secretKey: process.env.JWT_SECRET_KEY!,
    accessTokenExpiry: "15m",
    refreshTokenExpiry: "30d",
  },
  ai: {
    geminiKey: process.env.GEMINI_API_KEY,
    groqKey: process.env.GROQ_API_KEY,
    model: process.env.LITELLM_MODEL || "gemini-pro",
  },
  cors: {
    origins: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:5173"],
  },
};
```

For request flow diagrams, see [REQUEST_FLOWS.md](REQUEST_FLOWS.md).
