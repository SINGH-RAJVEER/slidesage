# Request Flows

Request flow diagrams for key SlideSage endpoints.

## Email Sign-up and Verification Flow

```mermaid
sequenceDiagram
    participant Client as Client
    participant Hono as Hono Router
    participant EmailAuth as EmailAuthService
    participant DB as PostgreSQL
    participant Email as Email Provider

    Client->>Hono: POST /api/auth/signup/email
    Note over Client,Hono: { email, name, password }

    Hono->>EmailAuth: signUpWithEmail()
    EmailAuth->>DB: INSERT users, accounts, verifications
    EmailAuth->>Email: Send verification code
    Hono->>Client: 201 Created + { userId }

    Client->>Hono: POST /api/auth/verify-code
    Note over Client,Hono: { email, code }

    Hono->>EmailAuth: verifyEmailCode()
    EmailAuth->>DB: UPDATE users.emailVerified
    EmailAuth->>DB: DELETE verifications
    Hono->>Client: 200 OK + { success: true }
```

## Email Sign-in Flow

```mermaid
sequenceDiagram
    participant Client as Client
    participant Hono as Hono Router
    participant Auth as better-auth
    participant DB as PostgreSQL

    Client->>Hono: POST /api/auth/sign-in/email
    Note over Client,Hono: { email, password }

    Hono->>Auth: verify credentials
    Auth->>DB: Read accounts, create session
    Auth->>Hono: Set-Cookie (session)
    Hono->>Client: 200 OK
```

## Presentation Generation Flow (SSE)

```mermaid
sequenceDiagram
    participant Client as Client
    participant Hono as Hono + Auth
    participant PresService as PresentationService
    participant AI as AIService
    participant Stream as Stream Processor
    participant PresRepo as PresentationRepository
    participant DB as PostgreSQL

    Client->>Hono: POST /api/generate-presentation-stream
    Note over Client,Hono: Cookie: better-auth.session_token
    Note over Client,Hono: { topic, slide_count, detail_level, tonality }

    Hono->>Hono: Validate session cookie
    Hono->>PresService: generatePresentationStream()

    PresService->>AI: call LLM (streaming)

    loop Stream Processing
        AI->>Stream: parseChunk()
        Stream->>Client: SSE: event:theme
        Stream->>Client: SSE: event:slide
    end

    Stream->>Client: SSE: event:complete
    PresRepo->>DB: INSERT presentations
    Hono->>Client: SSE: event:saved
```

## Get Presentations Flow

```mermaid
sequenceDiagram
    participant Client as Client
    participant Hono as Hono + Auth
    participant PresService as PresentationService
    participant PresRepo as PresentationRepository
    participant DB as PostgreSQL

    Client->>Hono: GET /api/presentations
    Note over Client,Hono: Cookie: better-auth.session_token

    Hono->>Hono: Validate session cookie
    Hono->>PresService: getUserPresentations(userId)
    PresService->>PresRepo: findByUserId(userId)
    PresRepo->>DB: SELECT presentations by user_id
    Hono->>Client: 200 OK + { presentations: [...] }
```

## OAuth Flow (Google or GitHub)

```mermaid
sequenceDiagram
    participant Client as Client
    participant Provider as OAuth Provider
    participant Hono as Hono Router
    participant Auth as better-auth
    participant DB as PostgreSQL

    Client->>Hono: GET /api/auth/callback/google?callbackURL=...
    Hono->>Provider: OAuth redirect
    Provider->>Auth: OAuth callback
    Auth->>DB: Upsert account + session
    Auth->>Client: Set-Cookie + redirect to callbackURL
```

## Database Schema Relationships

```mermaid
erDiagram
    users {
        string id PK
        string email UK
        string name
        boolean email_verified
        float slide_tokens
        boolean is_unlimited
        timestamp created_at
        timestamp updated_at
    }

    accounts {
        string id PK
        string user_id FK
        string provider_id
        string account_id
    }

    sessions {
        string id PK
        string user_id FK
        timestamp expires_at
    }

    verifications {
        string id PK
        string identifier
        timestamp expires_at
    }

    presentations {
        string id PK
        string user_id FK
        string title
        string prompt
        jsonb slides_data
        timestamp created_at
        timestamp updated_at
    }

    users ||--o{ presentations : "has many"
    users ||--o{ accounts : "has many"
    users ||--o{ sessions : "has many"
```

For APIs architecture details, see [APIs_ARCHITECTURE.md](APIs_ARCHITECTURE.md).
