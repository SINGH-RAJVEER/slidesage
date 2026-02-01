# Authentication API

All authentication endpoints for user management and JWT token handling.

## Base URL

- **Development**: `http://localhost:8000/api/auth`
- **Production**: Configure via `VITE_API_URL` environment variable

## Authentication Method

All endpoints require appropriate HTTP headers:

```bash
Content-Type: application/json
Authorization: Bearer <token> (for protected endpoints)
```

## Token Lifecycle

- **Access Token**: 15 minutes expiry
- **Refresh Token**: 30 days expiry

---

## POST /api/auth/register

Register a new user account.

### Request Body

```json
{
  "email": "user@example.com",
  "password": "SecurePass1",
  "name": "John Doe"
}
```

### Validation Rules

- **Email**: Valid email format, unique
- **Password**: Minimum 8 characters, at least 1 uppercase letter and 1 number
- **Name**: Required, non-empty string

### Success Response (201 Created)

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

### Error Responses

- `400`: Validation failed
- `409`: Email already registered

---

## POST /api/auth/login

Login with email and password.

### Request Body

```json
{
  "email": "user@example.com",
  "password": "SecurePass1"
}
```

### Success Response (200 OK)

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

### Error Responses

- `400`: Validation failed
- `401`: Invalid email or password

---

## POST /api/auth/google

Authenticate via Google OAuth.

### Request Body

```json
{
  "credential": "google_oauth_token_here"
}
```

### Success Response (200 OK)

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

### Error Responses

- `400`: Validation failed
- `401`: Invalid Google token

---

## POST /api/auth/refresh

Refresh access token using refresh token.

### Headers

```bash
Authorization: Bearer <refresh_token>
```

### Success Response (200 OK)

```json
{
  "access_token": "eyJ..."
}
```

### Error Responses

- `401`: Invalid or expired refresh token
- `404`: User not found

---

## GET /api/auth/me

Get current authenticated user.

### Headers

```bash
Authorization: Bearer <access_token>
```

### Success Response (200 OK)

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

### Error Responses

- `401`: Invalid or expired token
- `404`: User not found

---

## PUT /api/auth/profile

Update user profile.

### Headers

```bash
Authorization: Bearer <access_token>
```

### Request Body

```json
{
  "name": "Jane Doe",
  "email": "newemail@example.com",
  "current_password": "OldPass1",
  "new_password": "NewPass1"
}
```

**Note:** All fields are optional. Password change requires `current_password`.

### Success Response (200 OK)

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

### Error Responses

- `400`: Validation failed or incorrect current password
- `401`: Invalid or expired token
- `404`: User not found
- `409`: Email already in use

---

## POST /api/auth/logout

Logout user (client should discard tokens).

### Headers

```bash
Authorization: Bearer <access_token>
```

### Success Response (200 OK)

```json
{
  "message": "Logged out successfully"
}
```

---

## Error Response Format

All errors follow consistent format:

```json
{
  "error": {
    "message": "Human-readable error message",
    "details": {}
  }
}
```

## Standard HTTP Status Codes

- `200`: Success
- `201`: Created
- `400`: Bad Request (validation, malformed input)
- `401`: Unauthorized (invalid/expired token, invalid credentials)
- `404`: Not Found
- `409`: Conflict (duplicate email, etc.)
- `422`: Unprocessable Entity (invalid token format)
- `500`: Internal Server Error

For presentation API endpoints, see [PRESENTATIONS_API.md](PRESENTATIONS_API.md).
