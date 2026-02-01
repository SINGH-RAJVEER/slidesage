# Deployment Workflows

Complete guide to deploying SlideSage applications to various environments.

## Table of Contents

1. [Environment Types](#environment-types)
2. [Docker Deployment](#docker-deployment)
3. [Cloud Deployment](#cloud-deployment)
4. [CI/CD Pipeline](#cicd-pipeline)
5. [Monitoring](#monitoring)

---

## Environment Types

### Development Environment

- **Purpose**: Local development and testing
- **Database**: Local PostgreSQL via Docker
- **Configuration**: `.env` files committed to git (example only)
- **URL**: `http://localhost:3000` (frontend), `http://localhost:8000` (backend)

### Staging Environment

- **Purpose**: Pre-production testing
- **Database**: Cloud PostgreSQL instance
- **Configuration**: Environment variables in deployment platform
- **URL**: `https://staging.slidesage.com`
- **Features**: Mirror of production, sample data

### Production Environment

- **Purpose**: Live application for users
- **Database**: Cloud PostgreSQL with backups
- **Configuration**: Secure environment variables
- **URL**: `https://app.slidesage.com`
- **Features**: Full monitoring, logging, alerts

---

## Docker Deployment

### 1. Development Docker Compose

```yaml
# docker-compose.yml
version: "3.8"

services:
  database:
    image: postgres:16
    environment:
      POSTGRES_DB: slide_sage
      POSTGRES_USER: slide_user
      POSTGRES_PASSWORD: slide_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    environment:
      DATABASE_URL: postgresql://slide_user:slide_password@database:5432/slide_sage
      JWT_SECRET_KEY: ${JWT_SECRET_KEY}
      GEMINI_API_KEY: ${GEMINI_API_KEY}
    ports:
      - "8000:8000"
    depends_on:
      - database

  frontend:
    build:
      context: .
      dockerfile: apps/frontend/Dockerfile
    environment:
      VITE_API_URL: http://localhost:8000/api
    ports:
      - "5173:5173"
    depends_on:
      - backend

volumes:
  postgres_data:
```

### 2. Production Docker Compose

```yaml
# docker-compose.prod.yml
version: "3.8"

services:
  database:
    image: postgres:16
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  backend:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile.prod
    environment:
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET_KEY: ${JWT_SECRET_KEY}
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    ports:
      - "8000:8000"
    depends_on:
      - database
    restart: unless-stopped

  frontend:
    build:
      context: .
      dockerfile: apps/frontend/Dockerfile.prod
    ports:
      - "80:80"
    restart: unless-stopped

volumes:
  postgres_data:
```

### 3. Backend Dockerfile

```dockerfile
# apps/backend/Dockerfile
FROM oven/bun:1.0-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb ./
COPY apps/backend/package.json ./apps/backend/
RUN bun install --frozen-lockfile

# Build application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY . .
RUN bun run build

# Production image
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 bun
RUN adduser --system --uid 1001 bun

COPY --from=builder /app/apps/backend/src ./src
COPY --from=builder /app/apps/backend/package.json ./

USER bun
EXPOSE 8000
CMD ["bun", "src/index.ts"]
```

### 4. Frontend Dockerfile

```dockerfile
# apps/frontend/Dockerfile.prod
FROM node:18-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 5. Deployment Commands

```bash
# Development deployment
docker-compose up --build

# Production deployment
docker-compose -f docker-compose.prod.yml up --build -d

# Scale services
docker-compose -f docker-compose.prod.yml up --scale backend=3

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

---

## Cloud Deployment

### 1. AWS Deployment

#### ECS (Elastic Container Service)

```yaml
# aws-ecs-task-definition.json
{
  "family": "slide-sage-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::account:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::account:role/ecsTaskRole",
  "containerDefinitions":
    [
      {
        "name": "backend",
        "image": "your-account.dkr.ecr.region.amazonaws.com/slide-sage-backend:latest",
        "portMappings": [{ "containerPort": 8000, "protocol": "tcp" }],
        "environment":
          [
            {
              "name": "DATABASE_URL",
              "value": "postgresql://user:pass@rds-endpoint:5432/db",
            },
            {
              "name": "JWT_SECRET_KEY",
              "valueFrom": "arn:aws:secretsmanager:region:account:secret:slide-sage/jwt-secret",
            },
          ],
        "logConfiguration":
          {
            "logDriver": "awslogs",
            "options":
              {
                "awslogs-group": "/ecs/slide-sage-backend",
                "awslogs-region": "us-west-2",
                "awslogs-stream-prefix": "ecs",
              },
          },
      },
    ],
}
```

#### RDS Database

```bash
# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier slide-sage-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --master-username postgres \
  --master-user-password SecurePassword123 \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-12345678 \
  --db-subnet-group-name default
```

#### CloudFront Distribution

```yaml
# cloudfront-distribution.json
{
  "DistributionConfig":
    {
      "CallerReference": "slide-sage-frontend",
      "Origins":
        {
          "Quantity": 1,
          "Items":
            [
              {
                "Id": "S3-slide-sage-frontend",
                "DomainName": "slide-sage-frontend.s3.amazonaws.com",
                "S3OriginConfig":
                  {
                    "OriginAccessIdentity": "origin-access-identity/cloudfront/E1234567890ABCDEF",
                  },
              },
            ],
        },
      "DefaultCacheBehavior":
        {
          "TargetOriginId": "S3-slide-sage-frontend",
          "ViewerProtocolPolicy": "redirect-to-https",
          "MinTTL": 0,
        },
      "Enabled": true,
      "HttpVersion": "http2",
    },
}
```

### 2. Vercel Deployment (Frontend)

#### vercel.json

```json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ],
  "env": {
    "VITE_API_URL": "@api_url"
  }
}
```

#### Deployment Commands

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to production
vercel --prod

# Deploy to preview
vercel

# Set environment variables
vercel env add VITE_API_URL production
```

### 3. Railway Deployment (Backend)

#### railway.toml

```toml
[build]
builder = "NIXPACKS"

[deploy]
healthcheckPath = "/api/health"
healthcheckTimeout = 100
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10

[[services]]
name = "slide-sage-backend"
sourceDir = "apps/backend"

[services.variables]
PORT = "8000"
NODE_ENV = "production"
```

---

## CI/CD Pipeline

### 1. GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - name: Install dependencies
        run: bun install
      - name: Run tests
        run: bun test
      - name: Run linting
        run: bun lint

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker images
        run: |
          docker build -f apps/backend/Dockerfile.prod -t slide-sage-backend .
          docker build -f apps/frontend/Dockerfile.prod -t slide-sage-frontend .

      - name: Push to registry
        run: |
          docker tag slide-sage-backend ${{ secrets.REGISTRY_URL }}/slide-sage-backend:${{ github.sha }}
          docker push ${{ secrets.REGISTRY_URL }}/slide-sage-backend:${{ github.sha }}

      - name: Deploy to ECS
        run: |
          aws ecs update-service --cluster slide-sage --service backend-service --force-new-deployment
```

### 2. Deployment Script

```bash
#!/bin/bash
# deploy.sh

set -e

echo "Starting deployment..."

# Build and test
echo "Building application..."
bun install
bun test
bun build

# Build Docker images
echo "Building Docker images..."
docker build -f apps/backend/Dockerfile.prod -t slide-sage-backend:latest .
docker build -f apps/frontend/Dockerfile.prod -t slide-sage-frontend:latest .

# Tag with version
VERSION=$(git rev-parse --short HEAD)
docker tag slide-sage-backend:latest slide-sage-backend:$VERSION
docker tag slide-sage-frontend:latest slide-sage-frontend:$VERSION

# Push to registry
echo "Pushing to registry..."
docker push slide-sage-backend:$VERSION
docker push slide-sage-frontend:$VERSION

# Update services
echo "Updating services..."
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

echo "Deployment completed successfully!"
```

---

## Monitoring

### 1. Health Checks

#### Backend Health Check

```typescript
// apps/backend/src/routes/health.ts
export const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  const checks = {
    database: await checkDatabase(),
    ai_service: await checkAIService(),
    memory: checkMemory(),
    uptime: process.uptime(),
  };

  const isHealthy = Object.values(checks).every((check) =>
    typeof check === "object" ? check.status === "ok" : check !== null,
  );

  return c.json(
    {
      status: isHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      checks,
    },
    isHealthy ? 200 : 503,
  );
});

async function checkDatabase() {
  try {
    await db.select().from(users).limit(1);
    return { status: "ok", latency: Date.now() };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}
```

### 2. Logging Configuration

#### Backend Logging

```typescript
// apps/backend/src/lib/logger.ts
import { createWriteStream } from "fs";
import { Hono } from "hono";

export const logger = (app: Hono) => {
  const logStream = createWriteStream("./logs/app.log", { flags: "a" });

  app.use("*", async (c, next) => {
    const start = Date.now();
    const method = c.req.method;
    const url = c.req.url;
    const userAgent = c.req.header("user-agent");

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    const logEntry = {
      timestamp: new Date().toISOString(),
      method,
      url,
      status,
      duration,
      userAgent,
      ip: c.req.header("x-forwarded-for") || "unknown",
    };

    logStream.write(JSON.stringify(logEntry) + "\n");
  });
};
```

### 3. Metrics Collection

#### Prometheus Metrics

```typescript
// apps/backend/src/lib/metrics.ts
import { register, Counter, Histogram, Gauge } from "prom-client";

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests",
  labelNames: ["method", "route"],
});

export const activeUsers = new Gauge({
  name: "active_users",
  help: "Number of active users",
});

register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestDuration);
register.registerMetric(activeUsers);
```

### 4. Alerting

#### Alertmanager Configuration

```yaml
# alertmanager.yml
global:
  smtp_smarthost: "localhost:587"
  smtp_from: "alerts@slidesage.com"

route:
  receiver: "web.hook"

receivers:
  - name: "web.hook"
    email_configs:
      - to: "team@slidesage.com"
        subject: "[SlideSage Alert] {{ .GroupLabels.alertname }}"
        body: |
          {{ range .Alerts }}
          Alert: {{ .Annotations.summary }}
          Description: {{ .Annotations.description }}
          {{ end }}
```

#### Alert Rules

```yaml
# prometheus-rules.yml
groups:
  - name: slide-sage
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value }} errors per second"

      - alert: DatabaseDown
        expr: up{job="database"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Database is down"
          description: "Database has been down for more than 1 minute"
```

### 5. Dashboard (Grafana)

#### Key Metrics to Monitor

- Request rate and response times
- Error rates (4xx, 5xx)
- Database performance
- Token usage and costs
- Active user counts
- Resource utilization (CPU, memory)

For development setup, see [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md).
