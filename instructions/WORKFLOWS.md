# Development Workflows

This document describes common development workflows and best practices for the SlideSage project.

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

- Python 3.9+
- Bun (for frontend)
- PostgreSQL
- Docker and Docker Compose (optional but recommended)

### Initial Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/SINGH-RAJVEER/SlideSage.git
   cd SlideSage
   ```

2. **Set up environment variables:**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Install dependencies:**

   ```bash
   make install
   ```

4. **Start services with Docker:**

   ```bash
   make docker-up
   ```

5. **Start development servers:**

   ```bash
   # Terminal 1: Backend
   make dev-backend

   # Terminal 2: Frontend
   make dev-frontend
   ```

---

## Adding a New API Endpoint

Follow the layered architecture pattern. Here's a complete workflow:

### Step 1: Define Schema (Validation)

Create or update schema in `backend/app/schemas/`:

```python
# backend/app/schemas/example.py
from marshmallow import Schema, fields, validate

class ExampleRequestSchema(Schema):
    """Schema for example request"""
    name = fields.Str(required=True, validate=validate.Length(min=1))
    count = fields.Int(validate=validate.Range(min=1, max=100))

class ExampleResponseSchema(Schema):
    """Schema for example response"""
    id = fields.Int()
    name = fields.Str()
    created_at = fields.DateTime()
```

### Step 2: Add Repository Method (Data Access)

Add or update repository in `backend/app/repositories/`:

```python
# backend/app/repositories/example_repository.py
from typing import List, Optional
from app.models import db, ExampleModel

class ExampleRepository:
    """Repository for Example model"""

    @staticmethod
    def create(name: str, count: int) -> ExampleModel:
        """Create a new example"""
        example = ExampleModel(name=name, count=count)
        db.session.add(example)
        db.session.commit()
        return example

    @staticmethod
    def find_by_id(example_id: int) -> Optional[ExampleModel]:
        """Find example by ID"""
        return ExampleModel.query.get(example_id)
```

### Step 3: Add Service Method (Business Logic)

Add or update service in `backend/app/services/`:

```python
# backend/app/services/example_service.py
from app.repositories.example_repository import ExampleRepository

class ExampleService:
    """Service for example business logic"""

    def __init__(self):
        self.example_repo = ExampleRepository()

    def create_example(self, name: str, count: int):
        """
        Create a new example

        Raises:
            ValueError: If validation fails
        """
        if count < 1:
            raise ValueError('Count must be positive')

        return self.example_repo.create(name, count)

    def get_example(self, example_id: int):
        """Get example by ID"""
        example = self.example_repo.find_by_id(example_id)
        if not example:
            raise ValueError('Example not found')
        return example
```

### Step 4: Add API Route (HTTP Handler)

Create or update route in `backend/app/api/`:

```python
# backend/app/api/example.py
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from marshmallow import ValidationError

from app.schemas.example import ExampleRequestSchema, ExampleResponseSchema
from app.services.example_service import ExampleService

example_bp = Blueprint('example', __name__, url_prefix='/api/examples')
example_service = ExampleService()

@example_bp.errorhandler(ValidationError)
def handle_validation_error(e):
    return jsonify({'error': {'message': 'Validation failed', 'details': e.messages}}), 400

@example_bp.errorhandler(ValueError)
def handle_value_error(e):
    return jsonify({'error': {'message': str(e)}}), 400

@example_bp.route('', methods=['POST'])
@jwt_required()
def create_example():
    """Create a new example"""
    # Validate and deserialize
    schema = ExampleRequestSchema()
    data = schema.load(request.get_json())

    # Call service
    example = example_service.create_example(
        name=data['name'],
        count=data.get('count', 1)
    )

    # Serialize response
    response_schema = ExampleResponseSchema()
    return jsonify({'example': response_schema.dump(example)}), 201

@example_bp.route('/<int:example_id>', methods=['GET'])
@jwt_required()
def get_example(example_id):
    """Get example by ID"""
    example = example_service.get_example(example_id)

    response_schema = ExampleResponseSchema()
    return jsonify({'example': response_schema.dump(example)}), 200
```

### Step 5: Register Blueprint

Update `backend/app/__init__.py`:

```python
def register_blueprints(app):
    """Register all application blueprints"""
    from app.api.auth import auth_bp
    from app.api.presentations import presentations_bp
    from app.api.example import example_bp  # Add this

    app.register_blueprint(auth_bp)
    app.register_blueprint(presentations_bp)
    app.register_blueprint(example_bp)  # Add this
```

### Step 6: Update API Documentation

Add endpoint documentation to `instructions/API_CONTRACT.md`:

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
````

**Response (201 Created):**

```json
{
  "example": {
    "id": 1,
    "name": "Example Name",
    "created_at": "2026-01-04T12:00:00Z"
  }
}
```

```

---

## Adding a New Feature

### Frontend Feature

1. **Plan the feature structure:**
```

src/features/example-feature/
├── components/
│ ├── ExampleComponent.tsx
│ └── ExampleForm.tsx
├── hooks/
│ └── useExample.ts
├── services/
│ └── exampleService.ts
└── types/
└── example.ts

````

2. **Create types:**
```typescript
// src/features/example-feature/types/example.ts
export interface Example {
  id: number;
  name: string;
  createdAt: string;
}
````

3. **Create service:**

   ```typescript
   // src/features/example-feature/services/exampleService.ts
   import { Example } from "../types/example";

   const API_URL = import.meta.env.VITE_API_URL;

   export const exampleService = {
     async createExample(data: {
       name: string;
       count: number;
     }): Promise<Example> {
       const response = await fetch(`${API_URL}/examples`, {
         method: "POST",
         headers: {
           "Content-Type": "application/json",
           Authorization: `Bearer ${localStorage.getItem("access_token")}`,
         },
         body: JSON.stringify(data),
       });

       if (!response.ok) throw new Error("Failed to create example");

       const result = await response.json();
       return result.example;
     },
   };
   ```

4. **Create custom hook:**

   ```typescript
   // src/features/example-feature/hooks/useExample.ts
   import { useState } from "react";
   import { exampleService } from "../services/exampleService";
   import { Example } from "../types/example";

   export function useExample() {
     const [loading, setLoading] = useState(false);
     const [error, setError] = useState<string | null>(null);

     const createExample = async (data: { name: string; count: number }) => {
       setLoading(true);
       setError(null);
       try {
         const example = await exampleService.createExample(data);
         return example;
       } catch (err) {
         setError(err instanceof Error ? err.message : "An error occurred");
         throw err;
       } finally {
         setLoading(false);
       }
     };

     return { createExample, loading, error };
   }
   ```

5. **Create component:**

   ```tsx
   // src/features/example-feature/components/ExampleForm.tsx
   import { useState } from "react";
   import { useExample } from "../hooks/useExample";

   export function ExampleForm() {
     const [name, setName] = useState("");
     const { createExample, loading, error } = useExample();

     const handleSubmit = async (e: React.FormEvent) => {
       e.preventDefault();
       try {
         await createExample({ name, count: 1 });
         // Handle success
       } catch (err) {
         // Error handled by hook
       }
     };

     return (
       <form onSubmit={handleSubmit}>
         <input
           value={name}
           onChange={(e) => setName(e.target.value)}
           placeholder="Name"
         />
         <button type="submit" disabled={loading}>
           {loading ? "Creating..." : "Create"}
         </button>
         {error && <p className="error">{error}</p>}
       </form>
     );
   }
   ```

---

## Running Tests

### Backend Tests

```bash
# Run all tests
make test-backend

# Run specific test file
cd backend && pytest tests/test_auth.py

# Run with coverage
cd backend && pytest --cov=app tests/
```

### Frontend Tests

```bash
# Run all tests
cd frontend && bun test

# Run in watch mode
cd frontend && bun test --watch
```

---

## Database Migrations

Currently, the project uses SQLAlchemy's `db.create_all()` for development. For production:

### Future: Use Alembic

1. **Install Alembic:**

   ```bash
   pip install alembic
   ```

2. **Initialize Alembic:**

   ```bash
   cd backend
   alembic init migrations
   ```

3. **Generate migration:**

   ```bash
   alembic revision --autogenerate -m "Description"
   ```

4. **Apply migration:**
   ```bash
   alembic upgrade head
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
- Set `FLASK_DEBUG=False`

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

### Backend Import Errors

```bash
# Ensure you're in the backend directory
cd backend

# Reinstall dependencies
pip install -r requirements.txt
```

### Frontend Build Errors

```bash
# Clear cache and reinstall
cd frontend
rm -rf node_modules
bun install
```

### Port Already in Use

```bash
# Find process using port 5000
lsof -i :5000

# Kill process
kill -9 <PID>
```

---

## Best Practices

1. **Always run linters before committing:**

   ```bash
   make lint
   ```

2. **Keep commits atomic and well-described:**

   ```bash
   git commit -m "feat(auth): add Google OAuth support"
   ```

3. **Update documentation when changing APIs:**

   - Update `instructions/API_CONTRACT.md`
   - Add ADRs to `instructions/DECISIONS.md`

4. **Write tests for new features:**

   - Backend: Unit tests for services, integration tests for APIs
   - Frontend: Component tests, hook tests

5. **Follow clean code guidelines:**
   - Reference `instructions/clean-code.md`
   - Keep functions small and focused
   - Maintain proper separation of concerns
