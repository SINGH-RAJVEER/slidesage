# API Overview

General API information, standards, and reference for SlideSage application.

## Base URL Configuration

### Environment Variables

- **Frontend**: `VITE_API_URL=http://localhost:8000/api`
- **Backend**: Base URL configured via Hono routes

### URL Structure

```
Development: http://localhost:8000/api
Production:  https://your-domain.com/api
```

## Authentication Standards

### JWT Token Format

```bash
Authorization: Bearer <access_token>
```

### Token Types

- **Access Token**: 15 minutes expiry, used for API calls
- **Refresh Token**: 30 days expiry, used to obtain new access tokens

### Token Management

```javascript
// Store tokens securely
localStorage.setItem('access_token', accessToken);
localStorage.setItem('refresh_token', refreshToken);

// Include in API requests
headers: {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
}
```

## Request/Response Standards

### HTTP Methods

- `GET`: Retrieve data
- `POST`: Create data
- `PUT`: Update data
- `DELETE`: Remove data

### Content Types

- `application/json`: Standard API requests/responses
- `text/event-stream`: Server-Sent Events for streaming

### Timestamp Format

All timestamps use ISO 8601 format (UTC):

```json
{
  "created_at": "2026-01-04T12:00:00Z",
  "updated_at": "2026-01-04T12:30:00Z"
}
```

## Error Handling

### Standard Error Response

```json
{
  "error": {
    "message": "Human-readable error message",
    "details": {}
  }
}
```

### HTTP Status Codes

| Status | Meaning               | Use Cases                                      |
| ------ | --------------------- | ---------------------------------------------- |
| `200`  | OK                    | Successful request                             |
| `201`  | Created               | Resource created successfully                  |
| `400`  | Bad Request           | Validation failed, malformed input             |
| `401`  | Unauthorized          | Invalid/expired token, authentication required |
| `402`  | Payment Required      | Insufficient tokens                            |
| `403`  | Forbidden             | Access denied to resource                      |
| `404`  | Not Found             | Resource doesn't exist                         |
| `409`  | Conflict              | Duplicate data (email already exists)          |
| `422`  | Unprocessable Entity  | Invalid data format                            |
| `500`  | Internal Server Error | Server-side error                              |

### Client-Side Error Handling

```javascript
try {
  const response = await fetch("/api/presentations", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error.message);
  }

  return await response.json();
} catch (error) {
  // Handle network errors or API errors
  console.error("API Error:", error.message);
  // Show user-friendly message
}
```

## Rate Limiting

Currently not implemented but planned for production:

- Per-user rate limits on generation endpoints
- Token-based limits to prevent abuse
- Exponential backoff for failed requests

## CORS Configuration

### Development Setup

```typescript
// Hono CORS middleware
app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  }),
);
```

### Production Setup

Configure via `CORS_ORIGINS` environment variable:

```
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

## API Versioning

Current version: **v1** (implicit in all endpoints)

Future versions may include version in URL:

```
/api/v1/presentations
/api/v2/presentations
```

## Health Check

### Endpoint

```
GET /api/health
```

### Response

```json
{
  "status": "healthy",
  "message": "SlideSage API is running",
  "timestamp": "2026-01-04T12:00:00Z"
}
```

### Usage

```javascript
// Check API health before making requests
const healthResponse = await fetch("/api/health");
if (healthResponse.ok) {
  // API is healthy, proceed with requests
}
```

## Pagination

Currently not implemented but planned for list endpoints:

### Future Implementation

```json
{
  "presentations": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Query Parameters

```
GET /api/presentations?page=1&limit=20&sort=created_at&order=desc
```

## Validation Rules

### Email Validation

- Valid email format
- Case-insensitive uniqueness
- Maximum 254 characters

### Password Requirements

- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 number
- No common passwords

### Input Sanitization

- HTML tags stripped from text inputs
- SQL injection prevention via parameterized queries
- XSS prevention via output encoding

## Security Headers

### Response Headers

```http
Content-Security-Policy: default-src 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

### HTTPS Enforcement

- Production environments require HTTPS
- HSTS headers for secure connections
- No sensitive data in URLs

## API Endpoints Summary

| Category                              | Endpoints   | Description                                  |
| ------------------------------------- | ----------- | -------------------------------------------- |
| [Authentication](AUTH_API.md)         | 7 endpoints | User registration, login, profile management |
| [Presentations](PRESENTATIONS_API.md) | 4 endpoints | Presentation CRUD and AI generation          |
| Health Check                          | 1 endpoint  | Service health monitoring                    |

For detailed endpoint documentation:

- [Authentication API](AUTH_API.md)
- [Presentations API](PRESENTATIONS_API.md)
