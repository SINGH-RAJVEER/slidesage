# Development Workflows

This document describes common development workflows and best practices for the SlideSage project using TypeScript backend with Bun + Hono.

---

## Table of Contents

1. [Setting Up Development Environment](#setting-up-development-environment)
2. [Adding a New API Endpoint](#adding-a-new-api-endpoint)
3. [Adding a New Feature](#adding-a-new-feature)
4. [Running Tests](#running-tests)
5. [Database Migrations](#database-migrations)
6. [Deployment](#deployment)
7. [Troubleshooting](#troubleshooting)

---

## Setting Up Development Environment

### Prerequisites

- Bun (1.0+)
- PostgreSQL
- Docker and Docker Compose (optional but recommended)

### Initial Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your-username/slide-sage.git
   cd slide-sage
   ```

2. **Set up environment variables:**

   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   # Edit both .env files with your configuration
   ```

3. **Install dependencies:**

   ```bash
   # Backend
   cd backend
   bun install

   # Frontend
   cd ../frontend
   bun install
   ```

4. **Start services with Docker:**

   ```bash
   docker-compose up --build
   ```

5. **Start development servers:**

   ```bash
   # Terminal 1: Backend
   cd backend
   bun run dev

   # Terminal 2: Frontend
   cd frontend
   bun dev
   ```

---

## Adding a New API Endpoint

Follow the layered architecture pattern. Here's a complete workflow:

### Step 1: Define Types

Create or update types in `backend/src/types/`:

```typescript
// backend/src/types/example.ts
export interface Example {
  id: number;
  name: string;
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExampleRequest {
  name: string;
  count?: number;
}

export interface UpdateExampleRequest {
  name?: string;
  count?: number;
}
```

### Step 2: Update Database Schema

Add to `backend/src/db/schema.ts`:

```typescript
// backend/src/db/schema.ts
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const examples = pgTable('examples', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  count: integer('count').default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});
```

### Step 3: Add Repository Method

Create or update repository in `backend/src/repositories/`:

```typescript
// backend/src/repositories/example.repository.ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { examples } from '../db/schema';
import type { Example, CreateExampleRequest } from '../types/example';

export class ExampleRepository {
  async create(data: CreateExampleRequest): Promise<Example> {
    const [example] = await db
      .insert(examples)
      .values(data)
      .returning();
    return example;
  }

  async findById(id: number): Promise<Example | null> {
    const result = await db
      .select()
      .from(examples)
      .where(eq(examples.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findAll(): Promise<Example[]> {
    return await db.select().from(examples);
  }

  async deleteById(id: number): Promise<void> {
    await db.delete(examples).where(eq(examples.id, id));
  }
}
```

### Step 4: Add Service Method

Create or update service in `backend/src/services/`:

```typescript
// backend/src/services/example.service.ts
import { ExampleRepository } from '../repositories/example.repository';
import type { Example, CreateExampleRequest } from '../types/example';

export class ExampleService {
  private exampleRepo = new ExampleRepository();

  async createExample(data: CreateExampleRequest): Promise<Example> {
    if (!data.name?.trim()) {
      throw new Error('Name is required');
    }

    if (data.count && data.count < 1) {
      throw new Error('Count must be positive');
    }

    return await this.exampleRepo.create(data);
  }

  async getExample(id: number): Promise<Example> {
    const example = await this.exampleRepo.findById(id);
    if (!example) {
      throw new Error('Example not found');
    }
    return example;
  }

  async getAllExamples(): Promise<Example[]> {
    return await this.exampleRepo.findAll();
  }

  async deleteExample(id: number): Promise<void> {
    const example = await this.exampleRepo.findById(id);
    if (!example) {
      throw new Error('Example not found');
    }
    await this.exampleRepo.deleteById(id);
  }
}
```

### Step 5: Add Route Handler

Create or update route in `backend/src/routes/`:

```typescript
// backend/src/routes/example.routes.ts
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.middleware';
import { ExampleService } from '../services/example.service';
import type { CreateExampleRequest } from '../types/example';

const exampleRoutes = new Hono();
const exampleService = new ExampleService();

// Create example
exampleRoutes.post('/', authMiddleware, async (c) => {
  try {
    const data = await c.req.json() as CreateExampleRequest;
    const example = await exampleService.createExample(data);
    return c.json({ example }, 201);
  } catch (error) {
    return c.json({ 
      error: { 
        message: error instanceof Error ? error.message : 'An error occurred' 
      } 
    }, 400);
  }
});

// Get all examples
exampleRoutes.get('/', authMiddleware, async (c) => {
  try {
    const examples = await exampleService.getAllExamples();
    return c.json({ examples });
  } catch (error) {
    return c.json({ 
      error: { 
        message: error instanceof Error ? error.message : 'An error occurred' 
      } 
    }, 500);
  }
});

// Get example by ID
exampleRoutes.get('/:id', authMiddleware, async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ error: { message: 'Invalid ID' } }, 400);
    }
    
    const example = await exampleService.getExample(id);
    return c.json({ example });
  } catch (error) {
    const status = error instanceof Error && error.message === 'Example not found' ? 404 : 500;
    return c.json({ 
      error: { 
        message: error instanceof Error ? error.message : 'An error occurred' 
      } 
    }, status);
  }
});

// Delete example
exampleRoutes.delete('/:id', authMiddleware, async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ error: { message: 'Invalid ID' } }, 400);
    }
    
    await exampleService.deleteExample(id);
    return c.json({ message: 'Example deleted successfully' });
  } catch (error) {
    const status = error instanceof Error && error.message === 'Example not found' ? 404 : 500;
    return c.json({ 
      error: { 
        message: error instanceof Error ? error.message : 'An error occurred' 
      } 
    }, status);
  }
});

export default exampleRoutes;
```

### Step 6: Register Routes

Update `backend/src/index.ts`:

```typescript
import exampleRoutes from './routes/example.routes';

// ... other imports and setup

app.route('/api/examples', exampleRoutes);

// ... rest of the app setup
```

### Step 7: Update API Documentation

Add endpoint documentation to `docs/API_CONTRACT.md`:

````markdown
### POST /api/examples

Create a new example.

**Request Body:**

```json
{
  "name": "Example Name",
  "count": 5
}
```

**Response (201 Created):**

```json
{
  "example": {
    "id": 1,
    "name": "Example Name", 
    "count": 5,
    "createdAt": "2026-01-04T12:00:00Z",
    "updatedAt": "2026-01-04T12:00:00Z"
  }
}
```
````

### Step 8: Generate and Run Migration

```bash
cd backend

# Generate migration file
bun run db:generate

# Run migration
bun run db:migrate
```

---

## Adding a New Feature

### Frontend Feature

1. **Plan the feature structure:**

```
src/features/example-feature/
├── components/
│   ├── ExampleComponent.tsx
│   └── ExampleForm.tsx
├── hooks/
│   └── useExample.ts
├── services/
│   └── exampleService.ts
├── types/
│   └── example.ts
└── index.ts
```

2. **Create types:**

```typescript
// src/features/example-feature/types/example.ts
export interface Example {
  id: number;
  name: string;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExampleRequest {
  name: string;
  count?: number;
}
```

3. **Create service:**

```typescript
// src/features/example-feature/services/exampleService.ts
import type { Example, CreateExampleRequest } from '../types/example';

const API_URL = import.meta.env.VITE_API_URL;

export const exampleService = {
  async createExample(data: CreateExampleRequest): Promise<Example> {
    const response = await fetch(`${API_URL}/examples`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('access_token')}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to create example');
    }

    const result = await response.json();
    return result.example;
  },

  async getExamples(): Promise<Example[]> {
    const response = await fetch(`${API_URL}/examples`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('access_token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch examples');
    }

    const result = await response.json();
    return result.examples;
  },
};
```

4. **Create custom hook:**

```typescript
// src/features/example-feature/hooks/useExample.ts
import { useState, useEffect } from 'react';
import { exampleService } from '../services/exampleService';
import type { Example, CreateExampleRequest } from '../types/example';

export function useExamples() {
  const [examples, setExamples] = useState<Example[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchExamples = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await exampleService.getExamples();
      setExamples(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const createExample = async (data: CreateExampleRequest) => {
    setError(null);
    try {
      const newExample = await exampleService.createExample(data);
      setExamples(prev => [...prev, newExample]);
      return newExample;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      throw err;
    }
  };

  useEffect(() => {
    fetchExamples();
  }, []);

  return { 
    examples, 
    loading, 
    error, 
    createExample, 
    refetch: fetchExamples 
  };
}
```

5. **Create component:**

```tsx
// src/features/example-feature/components/ExampleForm.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useExamples } from '../hooks/useExample';

export function ExampleForm() {
  const [name, setName] = useState('');
  const [count, setCount] = useState(1);
  const { createExample, loading, error } = useExamples();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      await createExample({ name, count });
      setName('');
      setCount(1);
    } catch (err) {
      // Error handled by hook
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Example name"
          required
        />
      </div>
      
      <div>
        <Input
          type="number"
          value={count}
          onChange={(e) => setCount(parseInt(e.target.value) || 1)}
          min={1}
          placeholder="Count"
        />
      </div>

      <Button type="submit" disabled={loading || !name.trim()}>
        {loading ? 'Creating...' : 'Create Example'}
      </Button>

      {error && (
        <p className="text-red-500 text-sm">{error}</p>
      )}
    </form>
  );
}
```

---

## Running Tests

### Backend Tests

```bash
# Run all tests
cd backend && bun test

# Run specific test file  
cd backend && bun test src/services/example.service.test.ts

# Run tests in watch mode
cd backend && bun test --watch
```

### Frontend Tests

```bash
# Run all tests
cd frontend && bun test

# Run in watch mode
cd frontend && bun test --watch

# Run specific test
cd frontend && bun test src/features/example/components/ExampleForm.test.tsx
```

---

## Database Migrations

### Using Drizzle Kit

1. **Generate migration:**

   ```bash
   cd backend
   bun run db:generate
   ```

2. **Run migrations:**

   ```bash
   bun run db:migrate
   ```

3. **Push schema changes directly (development only):**

   ```bash
   bun run db:push
   ```

4. **Open database studio:**

   ```bash
   bun run db:studio
   ```

---

## Deployment

### Docker Production Build

1. **Build images:**

   ```bash
   docker-compose -f docker-compose.prod.yml build
   ```

2. **Run in production mode:**

   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

### Environment Setup

Ensure production environment variables are set:

- Set strong `JWT_SECRET_KEY`
- Use secure `DATABASE_URL`
- Configure `CORS_ORIGINS` appropriately
- Set proper API keys for AI services

---

## Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker-compose ps

# View logs
docker-compose logs postgres

# Restart database
docker-compose restart postgres
```

### Backend Issues

```bash
# Check TypeScript errors
cd backend && bun run lint

# Reinstall dependencies
cd backend && rm -rf node_modules && bun install

# Check environment variables
cat backend/.env
```

### Frontend Build Errors

```bash
# Clear cache and reinstall
cd frontend
rm -rf node_modules
bun install

# Check for TypeScript errors
bun run build
```

### Port Already in Use

```bash
# Find process using port 8000
lsof -i :8000

# Kill process
kill -9 <PID>

# Or change port in backend/.env
echo "PORT=8001" >> backend/.env
```

---

## Best Practices

1. **Always run linters before committing:**

   ```bash
   cd backend && bun run lint
   cd frontend && bun run lint
   ```

2. **Keep commits atomic and well-described:**

   ```bash
   git commit -m "feat(auth): add password reset endpoint"
   ```

3. **Update documentation when changing APIs:**

   - Update `docs/API_CONTRACT.md`
   - Add types to TypeScript interfaces
   - Update frontend service files

4. **Write tests for new features:**

   - Backend: Unit tests for services, integration tests for APIs
   - Frontend: Component tests, hook tests

5. **Follow clean code guidelines:**

   - Reference `docs/CLEAN_CODE.md`
   - Keep functions small and focused
   - Maintain proper separation of concerns
   - Use TypeScript's type system effectively

6. **Database best practices:**

   - Always generate migrations for schema changes
   - Test migrations on development data before production
   - Use Drizzle Studio to inspect database state
   - Keep backup before major migrations

---

## Performance Optimization

### Backend

- Use database indexes for frequently queried fields
- Implement pagination for large datasets
- Use connection pooling (built into Bun's postgres)
- Cache frequently accessed data
- Optimize database queries with Drizzle's query builder

### Frontend

- Use React.memo for expensive components
- Implement proper loading states
- Use React Query for server state caching
- Optimize bundle size with tree shaking
- Lazy load routes and components

---

## Monitoring and Debugging

### Backend Monitoring

```bash
# View application logs
docker-compose logs -f backend

# Database performance
bun run db:studio

# Health check endpoint
curl http://localhost:8000/api/health
```

### Frontend Debugging- Use React Developer Tools
- Monitor network requests in browser dev tools
- Use TypeScript strict mode for better error catching
- Implement error boundaries for graceful error handling
