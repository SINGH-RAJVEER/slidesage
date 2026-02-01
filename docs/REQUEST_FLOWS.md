# Request Flows

Detailed request flow diagrams for SlideSage application endpoints.

## User Registration Flow

```mermaid
sequenceDiagram
    participant Client as Client
    participant Hono as Hono Router
    participant Auth as Auth Service
    participant UserRepo as User Repository
    participant DB as PostgreSQL

    Client->>Hono: POST /api/auth/register
    Note over Client,Hono: { email, name, password }

    Hono->>Auth: validateEmail()
    Auth->>Auth: checkDuplicate()

    UserRepo->>Auth: findByEmail()
    DB->>UserRepo: SELECT * FROM users WHERE email = ?
    UserRepo->>Auth: null (email available)

    Auth->>UserRepo: hashPassword()
    UserRepo->>DB: INSERT INTO users (email, name, password_hash, ...)
    DB->>UserRepo: User record created
    UserRepo->>Auth: User object

    Auth->>Hono: generateJWT()
    Hono->>Client: 201 Created + JWT tokens
```

## Presentation Generation Flow (SSE)

```mermaid
sequenceDiagram
    participant Client as Client
    participant Hono as Hono + Auth
    participant PresService as Presentation Service
    participant AI as AI Service
    participant Stream as Stream Processor
    participant PresRepo as Presentation Repository
    participant DB as PostgreSQL

    Client->>Hono: POST /api/generate-presentation-stream
    Note over Client,Hono: + Authorization: Bearer <token>
    Note over Client,Hono: { topic, slide_count, detail_level, tonality }

    Hono->>Hono: Verify JWT token
    Hono->>PresService: generatePresentation()

    PresService->>PresService: checkUserTokens()
    PresService->>PresService: deductTokens()

    PresService->>AI: buildPrompt()
    AI->>AI: callLLMAPI(streaming=true)

    loop Stream Processing
        AI->>Stream: parseChunk()
        Stream->>Stream: extractTheme()
        Stream->>Client: SSE: event:theme

        Stream->>Stream: extractSlide()
        Stream->>Client: SSE: event:slide
    end

    AI->>Stream: generationComplete()
    Stream->>Client: SSE: event:complete

    PresService->>PresRepo: savePresentation()
    PresRepo->>DB: INSERT INTO presentations (...)
    DB->>PresRepo: Presentation saved

    PresService->>Client: SSE: event:saved
```

## Get Presentations Flow

```mermaid
sequenceDiagram
    participant Client as Client
    participant Hono as Hono + Auth
    participant PresService as Presentation Service
    participant PresRepo as Presentation Repository
    participant DB as PostgreSQL

    Client->>Hono: GET /api/presentations
    Note over Client,Hono: + Authorization: Bearer <token>

    Hono->>Hono: Verify JWT
    Hono->>PresService: getUserPresentations(userId)

    PresService->>PresRepo: findByUserId(userId)
    PresRepo->>DB: SELECT * FROM presentations WHERE user_id = ? ORDER BY created_at DESC
    DB->>PresRepo: Array of presentations
    PresRepo->>PresService: Presentations data
    PresService->>Hono: Transform to JSON
    Hono->>Client: 200 OK + { presentations: [...] }
```

## Google OAuth Flow

```mermaid
sequenceDiagram
    participant Client as Client
    participant Google as Google OAuth
    participant Hono as Hono Router
    participant Auth as Auth Service
    participant UserRepo as User Repository
    participant DB as PostgreSQL

    Client->>Google: Google Sign-In
    Google->>Client: OAuth token

    Client->>Hono: POST /api/auth/google
    Note over Client,Hono: { credential: "google_oauth_token" }

    Hono->>Auth: verifyGoogleToken()
    Auth->>Google: Verify token
    Google->>Auth: User profile data

    Auth->>UserRepo: findByEmail()
    DB->>UserRepo: SELECT * FROM users WHERE email = ?

    alt User exists
        UserRepo->>Auth: Existing user
    else New user
        UserRepo->>DB: INSERT INTO users (email, name, profile_picture_url, ...)
        DB->>UserRepo: New user created
        UserRepo->>Auth: New user
    end

    Auth->>Hono: generateJWT()
    Hono->>Client: 200 OK + JWT tokens + user data
```

## Database Schema Relationships

```mermaid
erDiagram
    users {
        integer id PK
        string email UK
        string name
        string password_hash
        float slide_tokens
        string profile_picture_url
        timestamp created_at
        timestamp updated_at
    }

    presentations {
        integer id PK
        integer user_id FK
        string title
        integer slide_count
        jsonb slides_data
        string theme
        integer tokens_used
        timestamp created_at
        timestamp updated_at
    }

    users ||--o{ presentations : "has many"
```

## Error Handling Flow

```mermaid
sequenceDiagram
    participant Client as Client
    participant Hono as Hono Router
    participant Middleware as Error Middleware
    participant Service as Service Layer
    participant Repo as Repository

    Client->>Hono: Request

    Hono->>Service: processRequest()

    alt Business Logic Error
        Service->>Service: validateData()
        Service->>Middleware: BusinessError("Invalid input")
        Middleware->>Middleware: mapToHTTPStatus(400)
        Middleware->>Client: 400 Bad Request
    else Database Error
        Service->>Repo: databaseOperation()
        Repo->>Service: DatabaseError("Connection failed")
        Service->>Middleware: mapToHTTPStatus(500)
        Middleware->>Client: 500 Internal Server Error
    else Success
        Service->>Hono: SuccessResponse
        Hono->>Client: 200 OK + data
    end
```

## Performance Considerations

### Caching Strategy

- **Turbo Cache**: Build artifacts cached by file dependencies
- **Database Queries**: Frequently accessed data cached in memory
- **API Responses**: Static responses cached with appropriate TTL

### Parallel Processing

- **Build Tasks**: Multiple apps built simultaneously when possible
- **API Requests**: Non-blocking I/O operations
- **Slide Generation**: Stream processing for real-time updates

### Resource Management

- **Connection Pooling**: Database connections reused efficiently
- **Memory Optimization**: Lightweight runtime (Bun vs Node.js)
- **Request Batching**: Multiple operations combined when possible

For backend architecture details, see [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md).
