# Development Workflows

Common development workflows and best practices for SlideSage monorepo.

## Table of Contents

1. [Adding New Features](#adding-new-features)
2. [Bug Fixing Process](#bug-fixing-process)
3. [Code Review Process](#code-review-process)
4. [Database Changes](#database-changes)
5. [Testing Workflow](#testing-workflow)

---

## Adding New Features

### 1. Planning and Design

#### Feature Requirements

```markdown
## Feature: User Dashboard

**User Story**: As a user, I want to see a dashboard with my presentation statistics
**Acceptance Criteria**:

- Display total presentations created
- Show tokens used/remaining
- List recent presentations
- Responsive design for mobile
```

#### Technical Design

```markdown
### Backend Changes

- New endpoint: GET /api/dashboard
- Dashboard service with statistics aggregation
- Repository methods for data aggregation

### Frontend Changes

- New route: /dashboard
- Dashboard component with statistics cards
- API service for dashboard data
- Redux state management for dashboard
```

### 2. Backend Implementation

#### Step 1: Add Types

```typescript
// apps/backend/src/types/dashboard.ts
export interface DashboardStats {
  totalPresentations: number;
  totalSlides: number;
  tokensUsed: number;
  tokensRemaining: number;
  recentPresentations: Array<{
    id: number;
    title: string;
    createdAt: string;
  }>;
}
```

#### Step 2: Update Database Schema (if needed)

```sql
-- apps/backend/src/db/schema.ts
-- Add any new tables or columns
-- Or create views for aggregated data
```

#### Step 3: Add Repository Methods

```typescript
// apps/backend/src/repositories/user.repository.ts
export class UserRepository {
  async getDashboardStats(userId: number): Promise<DashboardStats> {
    // Implement aggregated queries
    const totalPresentations = await db
      .select({ count: count() })
      .from(presentations)
      .where(eq(presentations.user_id, userId));

    // ... other aggregations
  }
}
```

#### Step 4: Add Service Logic

```typescript
// apps/backend/src/services/dashboard.service.ts
export class DashboardService {
  private userRepo = new UserRepository();

  async getDashboardStats(userId: number): Promise<DashboardStats> {
    return await this.userRepo.getDashboardStats(userId);
  }
}
```

#### Step 5: Add Route Handler

```typescript
// apps/backend/src/routes/dashboard.routes.ts
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.middleware";
import { DashboardService } from "../services/dashboard.service";

const dashboardRoutes = new Hono();
const dashboardService = new DashboardService();

dashboardRoutes.get("/", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const stats = await dashboardService.getDashboardStats(userId);
  return c.json({ dashboard: stats });
});

export default dashboardRoutes;
```

#### Step 6: Register Routes

```typescript
// apps/backend/src/index.ts
import dashboardRoutes from "./routes/dashboard.routes";

app.route("/api/dashboard", dashboardRoutes);
```

### 3. Frontend Implementation

#### Step 1: Add Types

```typescript
// apps/frontend/src/types/dashboard.ts
export interface DashboardStats {
  totalPresentations: number;
  totalSlides: number;
  tokensUsed: number;
  tokensRemaining: number;
  recentPresentations: Array<{
    id: number;
    title: string;
    createdAt: string;
  }>;
}
```

#### Step 2: Create API Service

```typescript
// apps/frontend/src/services/dashboardService.ts
import type { DashboardStats } from "../types/dashboard";

const API_URL = import.meta.env.VITE_API_URL;

export const dashboardService = {
  async getDashboardStats(): Promise<DashboardStats> {
    const response = await fetch(`${API_URL}/dashboard`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("access_token")}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch dashboard stats");
    }

    const result = await response.json();
    return result.dashboard;
  },
};
```

#### Step 3: Create React Hook

```typescript
// apps/frontend/src/hooks/useDashboard.ts
import { useState, useEffect } from "react";
import { dashboardService } from "../services/dashboardService";
import type { DashboardStats } from "../types/dashboard";

export function useDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await dashboardService.getDashboardStats();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  return { stats, loading, error };
}
```

#### Step 4: Create Components

```tsx
// apps/frontend/src/features/dashboard/components/Dashboard.tsx
import { useDashboard } from "../../hooks/useDashboard";

export function Dashboard() {
  const { stats, loading, error } = useDashboard();

  if (loading) return <div>Loading dashboard...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!stats) return <div>No data available</div>;

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Presentations</h3>
          <p>{stats.totalPresentations}</p>
        </div>
        <div className="stat-card">
          <h3>Tokens Remaining</h3>
          <p>{stats.tokensRemaining}</p>
        </div>
      </div>
    </div>
  );
}
```

#### Step 5: Add Route

```tsx
// apps/frontend/src/App.tsx
import { Dashboard } from "./features/dashboard/components/Dashboard";
import { BrowserRouter, Routes, Route } from "react-router-dom";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        {/* other routes */}
      </Routes>
    </BrowserRouter>
  );
}
```

---

## Bug Fixing Process

### 1. Bug Report Analysis

```markdown
## Bug: Presentation generation fails with special characters

**Steps to Reproduce**:

1. Create presentation with title containing emojis
2. Click generate
3. Generation fails with error

**Expected**: Presentation should generate successfully
**Actual**: Server returns 500 error
```

### 2. Investigation

```bash
# Check backend logs
docker-compose logs backend

# Reproduce issue manually
curl -X POST http://localhost:8000/api/generate-presentation-stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"topic": "🚀 Space Exploration", "slide_count": 5}'
```

### 3. Root Cause Analysis

```typescript
// Issue found in apps/backend/src/services/ai.service.ts
// Special characters not properly encoded for LLM API
const prompt = `Create presentation about: ${topic}`;
// Problem: emojis break JSON encoding
```

### 4. Fix Implementation

```typescript
// Fix: Properly encode special characters
const encodedTopic = JSON.stringify(topic);
const prompt = `Create presentation about: ${encodedTopic}`;
```

### 5. Testing

```typescript
// apps/backend/src/services/ai.service.test.ts
test("handles special characters in topic", async () => {
  const result = await aiService.generatePresentation({
    topic: "🚀 Space Exploration",
    slideCount: 5,
  });

  expect(result).toBeDefined();
  expect(result.slides).toBeDefined();
});
```

---

## Code Review Process

### 1. Pull Request Creation

```bash
# Create feature branch
git checkout -b feature/user-dashboard

# Make changes and commit
git add .
git commit -m "feat(dashboard): add user dashboard with statistics"

# Push and create PR
git push origin feature/user-dashboard
```

### 2. PR Template

```markdown
## Description

Adds user dashboard with presentation statistics

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [x] Unit tests pass
- [x] Integration tests pass
- [x] Manual testing completed

## Checklist

- [x] Code follows style guidelines
- [x] Self-review completed
- [x] Documentation updated
- [x] No console errors
```

### 3. Review Guidelines

- **Functionality**: Does it work as intended?
- **Code Quality**: Is it clean and maintainable?
- **Performance**: Any performance implications?
- **Security**: Any security considerations?
- **Testing**: Are tests adequate?
- **Documentation**: Is API documentation updated?

---

## Database Changes

### 1. Schema Changes

```typescript
// apps/backend/src/db/schema.ts
export const users = pgTable("users", {
  // existing fields...
  last_login_at: timestamp("last_login_at").defaultNow(),
});
```

### 2. Migration Generation

```bash
cd apps/backend
bun run db:generate
```

### 3. Migration Review

```sql
-- Generated migration file
ALTER TABLE users ADD COLUMN last_login_at timestamp DEFAULT now();
```

### 4. Apply Migration

```bash
bun run db:migrate
```

### 5. Update Types

```typescript
// apps/backend/src/types/user.ts
export interface User {
  id: number;
  email: string;
  name: string;
  // existing fields...
  last_login_at: Date | null;
}
```

---

## Testing Workflow

### 1. Unit Testing

```typescript
// apps/backend/src/services/auth.service.test.ts
import { describe, test, expect } from "bun:test";
import { AuthService } from "../auth.service";

describe("AuthService", () => {
  test("should register new user", async () => {
    const authService = new AuthService();
    const userData = {
      email: "test@example.com",
      password: "SecurePass123",
      name: "Test User",
    };

    const result = await authService.register(userData);

    expect(result.user.email).toBe(userData.email);
    expect(result.user.name).toBe(userData.name);
    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
  });
});
```

### 2. Integration Testing

```typescript
// apps/backend/src/routes/auth.routes.test.ts
import { describe, test, expect } from "bun:test";
import { app } from "../index";

describe("Auth Routes", () => {
  test("POST /api/auth/register", async () => {
    const response = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "SecurePass123",
        name: "Test User",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.user.email).toBe("test@example.com");
  });
});
```

### 3. Frontend Testing

```tsx
// apps/frontend/src/features/dashboard/components/Dashboard.test.tsx
import { render, screen } from "@testing-library/react";
import { Dashboard } from "./Dashboard";

// Mock the hook
vi.mock("../hooks/useDashboard", () => ({
  useDashboard: () => ({
    stats: {
      totalPresentations: 5,
      tokensRemaining: 10,
    },
    loading: false,
    error: null,
  }),
}));

test("renders dashboard with stats", () => {
  render(<Dashboard />);

  expect(screen.getByText("Dashboard")).toBeInTheDocument();
  expect(screen.getByText("Total Presentations")).toBeInTheDocument();
  expect(screen.getByText("5")).toBeInTheDocument();
});
```

### 4. Running Tests

```bash
# Run all tests
bun test

# Run tests with coverage
bun test --coverage

# Run tests in watch mode
bun test --watch

# Run specific test file
bun test src/services/auth.service.test.ts
```

### 5. Test Coverage

```bash
# Run tests with coverage report
cd apps/backend && bun test --coverage

# Target minimum coverage
# - Lines: 80%
# - Functions: 80%
# - Branches: 70%
# - Statements: 80%
```

For deployment workflows, see [DEPLOYMENT_WORKFLOWS.md](DEPLOYMENT_WORKFLOWS.md).
