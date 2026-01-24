# API Contract Documentation

This document defines the complete API contract for the SlideSage application.

## Base URL

- **Development**: `http://localhost:8000/api`
- **Production**: Configure via `VITE_API_URL` environment variable

## Authentication

All authenticated endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Token Lifecycle

- **Access Token**: 15 minutes expiry
- **Refresh Token**: 30 days expiry

---

## Authentication Endpoints

### POST /api/auth/register

Register a new user account.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass1",
  "name": "John Doe"
}
```

**Validation:**

- Email: Valid email format
- Password: Minimum 8 characters, at least 1 uppercase letter and 1 number
- Name: Required, non-empty string

**Response (201 Created):**

```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "profile_picture_url": null,
    "slide_tokens": 10.0,
    "created_at": "2026-01-04T12:00:00Z",
    "updated_at": "2026-01-04T12:00:00Z"
  },
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

**Error Responses:**

- `400`: Validation failed
- `409`: Email already registered

---

### POST /api/auth/login

Login with email and password.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass1"
}
```

**Response (200 OK):**

```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "profile_picture_url": null,
    "slide_tokens": 10.0,
    "created_at": "2026-01-04T12:00:00Z",
    "updated_at": "2026-01-04T12:00:00Z"
  },
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

**Error Responses:**

- `400`: Validation failed
- `401`: Invalid email or password

---

### POST /api/auth/google

Authenticate via Google OAuth.

**Request Body:**

```json
{
  "credential": "google_oauth_token_here"
}
```

**Response (200 OK):**

```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "profile_picture_url": "https://...",
    "slide_tokens": 10.0,
    "created_at": "2026-01-04T12:00:00Z",
    "updated_at": "2026-01-04T12:00:00Z"
  },
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

**Error Responses:**

- `400`: Validation failed
- `401`: Invalid Google token

---

### POST /api/auth/refresh

Refresh access token using refresh token.

**Headers:**

```
Authorization: Bearer <refresh_token>
```

**Response (200 OK):**

```json
{
  "access_token": "eyJ..."
}
```

**Error Responses:**

- `401`: Invalid or expired refresh token
- `404`: User not found

---

### GET /api/auth/me

Get current authenticated user.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response (200 OK):**

```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "profile_picture_url": null,
    "slide_tokens": 10.0,
    "created_at": "2026-01-04T12:00:00Z",
    "updated_at": "2026-01-04T12:00:00Z"
  }
}
```

**Error Responses:**

- `401`: Invalid or expired token
- `404`: User not found

---

### PUT /api/auth/profile

Update user profile.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Request Body:**

```json
{
  "name": "Jane Doe",
  "email": "newemail@example.com",
  "current_password": "OldPass1",
  "new_password": "NewPass1"
}
```

**Note:** All fields are optional. Password change requires `current_password`.

**Response (200 OK):**

```json
{
  "user": {
    "id": 1,
    "email": "newemail@example.com",
    "name": "Jane Doe",
    "profile_picture_url": null,
    "slide_tokens": 10.0,
    "created_at": "2026-01-04T12:00:00Z",
    "updated_at": "2026-01-04T12:30:00Z"
  }
}
```

**Error Responses:**

- `400`: Validation failed or incorrect current password
- `401`: Invalid or expired token
- `404`: User not found
- `409`: Email already in use

---

### POST /api/auth/logout

Logout user (client should discard tokens).

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response (200 OK):**

```json
{
  "message": "Logged out successfully"
}
```

---

## Presentation Endpoints

### POST /api/generate-presentation-stream

Generate a new presentation with Server-Sent Events (SSE) streaming.

**Headers:**

```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "topic": "Introduction to Machine Learning",
  "slide_count": 8,
  "detail_level": "balanced",
  "tonality": "professional"
}
```

**Field Details:**

- `topic` (required): String, 1-500 characters
- `slide_count` (required): Integer, 1-50
- `detail_level` (optional): One of `brief`, `concise`, `balanced`, `detailed`, `comprehensive`. Default: `balanced`
- `tonality` (optional): One of `professional`, `casual`, `enthusiastic`, `persuasive`. Default: `professional`

**Response (200 OK - SSE Stream):**

Content-Type: `text/event-stream`

**Events:**

1. **created** - Presentation ID created

```
event: created
data: {"presentation_id": 123}
```

2. **theme** - Theme selected

```
event: theme
data: {"theme": "modern"}
```

3. **slide** - Individual slide generated

```
event: slide
data: {"slide": {...}, "title": "Presentation Title"}
```

4. **complete** - Generation complete

```
event: complete
data: {"slides": [...], "theme": "modern", "title": "...", "tokens_used": 5000}
```

5. **saved** - Presentation saved

```
event: saved
data: {"presentation_id": 123, "success": true}
```

6. **error** - Error occurred

```
event: error
data: {"error": "Error message"}
```

**Error Responses:**

- `400`: Validation failed
- `401`: Invalid or expired token
- `402`: Insufficient tokens
- `404`: User not found

---

### GET /api/presentations

Get all presentations for the authenticated user.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response (200 OK):**

```json
{
  "presentations": [
    {
      "id": 1,
      "title": "Introduction to ML",
      "slide_count": 8,
      "created_at": "2026-01-04T12:00:00Z",
      "updated_at": "2026-01-04T12:00:00Z"
    }
  ]
}
```

**Error Responses:**

- `401`: Invalid or expired token

---

### GET /api/presentations/:id

Get a specific presentation with full slide data.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response (200 OK):**

```json
{
  "presentation": {
    "id": 1,
    "user_id": 1,
    "title": "Introduction to ML",
    "slide_count": 8,
    "slides": {
      "slides": [...],
      "theme": "modern",
      "title": "Introduction to ML",
      "totalSlides": 8
    },
    "created_at": "2026-01-04T12:00:00Z",
    "updated_at": "2026-01-04T12:00:00Z"
  }
}
```

**Error Responses:**

- `401`: Invalid or expired token
- `403`: Unauthorized access
- `404`: Presentation not found

---

### DELETE /api/presentations/:id

Delete a specific presentation.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response (200 OK):**

```json
{
  "message": "Presentation deleted successfully"
}
```

**Error Responses:**

- `401`: Invalid or expired token
- `403`: Unauthorized access
- `404`: Presentation not found

---

## Health Check

### GET /api/health

Check if API is running (no authentication required).

**Response (200 OK):**

```json
{
  "status": "healthy",
  "message": "SlideSage API is running"
}
```

---

## Error Response Format

All errors follow a consistent format:

```json
{
  "error": {
    "message": "Human-readable error message",
    "details": {} // Optional additional details
  }
}
```

**Standard HTTP Status Codes:**

- `200`: Success
- `201`: Created
- `400`: Bad Request (validation, malformed input)
- `401`: Unauthorized (invalid/expired token, invalid credentials)
- `402`: Payment Required (insufficient tokens)
- `403`: Forbidden (unauthorized access to resource)
- `404`: Not Found
- `409`: Conflict (duplicate email, etc.)
- `422`: Unprocessable Entity (invalid token format)
- `500`: Internal Server Error

---

## Rate Limiting

Currently not implemented. Future consideration for production.

---

## CORS

CORS is enabled for all origins in development. Configure allowed origins for production via the `CORS_ORIGINS` environment variable (comma-separated list of origins).

---

## Notes

1. All timestamps are in ISO 8601 format (UTC)
2. All request/response bodies use `application/json` except SSE endpoints
3. Token-based authentication using JWT
4. Slide tokens: 1 slide token ≈ 2500 AI tokens
5. New users receive 10 slide tokens on registration
