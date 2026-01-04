# Architecture Decision Records (ADRs)

This document tracks significant architectural and design decisions for the SlideSage project.

---

## ADR-001: Layered Backend Architecture

**Date**: 2026-01-04  
**Status**: Accepted

### Context

The original backend code mixed business logic, database access, and HTTP handling in route handlers, making the codebase difficult to test, maintain, and extend.

### Decision

Implement a clean, layered architecture:

1. **API Layer** (`app/api/`): Thin route handlers

   - Request parsing and validation
   - Response formatting
   - Minimal logic

2. **Services Layer** (`app/services/`): Business logic

   - Core business rules
   - Orchestration of multiple repositories
   - Transaction management

3. **Repositories Layer** (`app/repositories/`): Data access

   - Database queries
   - ORM operations
   - Persistence logic

4. **Schemas Layer** (`app/schemas/`): Validation

   - Request/response validation
   - Serialization/deserialization
   - Using Marshmallow

5. **Models Layer** (`app/models/`): Domain models
   - ORM models (SQLAlchemy)
   - Domain entities

### Consequences

**Positive:**

- Clear separation of concerns
- Easier to test each layer independently
- Business logic reusable across different interfaces
- Cleaner, more maintainable code

**Negative:**

- More files and initial setup
- Slight learning curve for new developers
- Need to maintain consistency across layers

---

## ADR-002: Marshmallow for Validation

**Date**: 2026-01-04  
**Status**: Accepted

### Context

Input validation was scattered across route handlers using manual checks and regex patterns. This led to duplicated validation logic and inconsistent error responses.

### Decision

Use Marshmallow for all request/response validation and serialization:

- Define schemas in `app/schemas/`
- Validate at API layer before calling services
- Consistent error format across all endpoints

### Consequences

**Positive:**

- Centralized validation logic
- Declarative schema definitions
- Automatic error message generation
- Built-in serialization/deserialization
- Type coercion and data transformation

**Negative:**

- Additional dependency
- Need to maintain schema definitions alongside models

---

## ADR-003: Repository Pattern for Data Access

**Date**: 2026-01-04  
**Status**: Accepted

### Context

Direct database queries were made throughout the codebase using SQLAlchemy ORM, making it difficult to mock data access in tests and change persistence strategies.

### Decision

Implement repository pattern:

- One repository per domain model
- Static methods for common queries
- Encapsulate all database access
- Return domain models, not ORM-specific objects

### Consequences

**Positive:**

- Testable business logic (mock repositories)
- Database queries in one place per model
- Easy to change persistence implementation
- Clear data access API

**Negative:**

- More abstraction layers
- Potential for leaky abstractions

---

## ADR-004: Application Factory Pattern

**Date**: 2026-01-04  
**Status**: Accepted (Already implemented)

### Context

Flask application needs to support multiple configurations (dev, test, production) and be testable.

### Decision

Use application factory pattern with `create_app(config_class)`:

- Configuration passed as parameter
- Extensions initialized within factory
- Blueprints registered via helper function

### Consequences

**Positive:**

- Multiple app instances for testing
- Clean configuration management
- Follows Flask best practices

**Negative:**

- Slightly more complex initial setup

---

## ADR-005: Consistent Error Response Format

**Date**: 2026-01-04  
**Status**: Accepted

### Context

Error responses had inconsistent formats across endpoints, making client-side error handling difficult.

### Decision

Standardize all error responses:

```json
{
  "error": {
    "message": "Human-readable message",
    "details": {} // Optional
  }
}
```

Map business exceptions to appropriate HTTP status codes:

- `ValueError` → 400 (with specific logic for 404, 403, 402)
- `ValidationError` → 400
- Generic exceptions → 500 (log internally, hide details from client)

### Consequences

**Positive:**

- Predictable error handling on frontend
- Consistent user experience
- Security: no stack traces exposed

**Negative:**

- Need to map exceptions consistently
- Service layer must use appropriate exception types

---

## ADR-006: Server-Sent Events for Streaming

**Date**: 2026-01-04  
**Status**: Accepted (Already implemented)

### Context

Presentation generation takes significant time. Users need real-time feedback as slides are generated.

### Decision

Use Server-Sent Events (SSE) for streaming presentation generation:

- One-way server-to-client communication
- Native browser support
- Event-based protocol

### Consequences

**Positive:**

- Real-time user feedback
- Simple implementation (no WebSocket complexity)
- Built into HTTP/1.1

**Negative:**

- Connection kept open during generation
- Requires proper error handling and connection management
- Limited browser support for some features

---

## ADR-007: JWT for Authentication

**Date**: 2026-01-04  
**Status**: Accepted (Already implemented)

### Context

Need stateless authentication for API.

### Decision

Use JSON Web Tokens (JWT) with Flask-JWT-Extended:

- Access tokens: 15 minutes expiry
- Refresh tokens: 30 days expiry
- User ID stored as string in token

### Consequences

**Positive:**

- Stateless authentication
- Scalable across multiple servers
- Industry standard

**Negative:**

- Cannot invalidate tokens before expiry (without token blacklist)
- Token size larger than session IDs

---

## ADR-008: Feature-Based Frontend Structure (Planned)

**Date**: 2026-01-04  
**Status**: Proposed

### Context

Current frontend organizes code by type (components, pages, services), leading to related code being spread across multiple directories.

### Decision

Reorganize frontend to feature-based structure:

```
src/
  features/
    auth/
      components/
      hooks/
      services/
      types/
    presentations/
      components/
      hooks/
      services/
      types/
```

### Consequences

**Positive:**

- Related code collocated
- Easier to find and modify features
- Better encapsulation
- Scales better for large apps

**Negative:**

- Requires significant refactoring
- Shared components need clear guidelines

---

## ADR-009: Separation of Routes and API

**Date**: 2026-01-04  
**Status**: Accepted

### Context

Clean code guidelines require thin API handlers that only handle HTTP concerns, not business logic.

### Decision

Create separate `app/api/` directory for new thin route handlers:

- Keep existing `app/routes/` for backward compatibility during transition
- New code uses `app/api/`
- Gradual migration path

### Consequences

**Positive:**

- Clean separation of HTTP and business logic
- Follows clean code guidelines
- Easy testing of business logic

**Negative:**

- Temporary duplication during migration
- Need to update imports and blueprints

---

## Future Considerations

1. **Token Blacklist**: Implement JWT token blacklist for logout and security
2. **Rate Limiting**: Add rate limiting for production use
3. **Caching**: Consider Redis for caching user sessions and presentation metadata
4. **API Versioning**: Implement `/api/v1/` versioning for future API changes
5. **Async/Await**: Consider async views for improved concurrency in streaming endpoints
6. **GraphQL**: Evaluate GraphQL as alternative to REST for complex queries
