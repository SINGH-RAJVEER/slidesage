# Presentations API

Endpoints for managing presentations and AI generation.

## Base URL

- **Development**: `http://localhost:8000/api`
- **Production**: Configure via `VITE_API_URL` environment variable

## Authentication

All presentation endpoints require JWT authentication:

```bash
Authorization: Bearer <access_token>
```

---

## POST /api/generate-presentation-stream

Generate a new presentation with Server-Sent Events (SSE) streaming.

### Headers

```bash
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Request Body

```json
{
  "topic": "Introduction to Machine Learning",
  "slide_count": 8,
  "detail_level": "balanced",
  "tonality": "professional",
  "research": {
    "enabled": true,
    "freshness": "week",
    "maxResults": 5
  }
}
```

### Field Details

- `topic` (required): String, 1-500 characters
- `slide_count` (required): Integer, 1-50
- `detail_level` (optional): One of `brief`, `concise`, `balanced`, `detailed`, `comprehensive`. Default: `balanced`
- `tonality` (optional): One of `professional`, `casual`, `enthusiastic`, `persuasive`. Default: `professional`
- `research` (optional): Web research settings. When enabled, the backend performs a search prepass and injects sources into the prompt.
  - `enabled` (boolean): Enable/disable web research.
  - `freshness` (optional): One of `day`, `week`, `month`, `year`.
  - `maxResults` (optional): Number of results to fetch (1–10). Default: 5.

### Response (200 OK - SSE Stream)

Content-Type: `text/event-stream`

#### Events Sequence

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

3. **slide** - Individual slide generated (repeated for each slide)

```
event: slide
data: {"slide": {...}, "title": "Presentation Title"}
```

4. **complete** - Generation complete

```
event: complete
data: {"slides": [...], "theme": "modern", "title": "...", "tokens_used": 5000}
```

5. **saved** - Presentation saved to database

```
event: saved
data: {"presentation_id": 123, "success": true}
```

6. **error** - Error occurred

```
event: error
data: {"error": "Error message"}
```

### Client-side SSE Implementation

```javascript
const eventSource = new EventSource("/api/generate-presentation-stream", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    topic: "Introduction to AI",
    slide_count: 5,
  }),
});

eventSource.addEventListener("created", (event) => {
  const data = JSON.parse(event.data);
  console.log("Presentation created:", data.presentation_id);
});

eventSource.addEventListener("slide", (event) => {
  const data = JSON.parse(event.data);
  console.log("New slide:", data.slide);
});

eventSource.addEventListener("complete", (event) => {
  const data = JSON.parse(event.data);
  console.log("Generation complete:", data);
});
```

### Error Responses

- `400`: Validation failed
- `401`: Invalid or expired token
- `402`: Insufficient tokens
- `404`: User not found

---

## GET /api/presentations

Get all presentations for the authenticated user.

### Headers

```bash
Authorization: Bearer <access_token>
```

### Success Response (200 OK)

```json
{
  "presentations": [
    {
      "id": 1,
      "title": "Introduction to ML",
      "slide_count": 8,
      "created_at": "2026-01-04T12:00:00Z",
      "updated_at": "2026-01-04T12:00:00Z"
    },
    {
      "id": 2,
      "title": "React Hooks Guide",
      "slide_count": 6,
      "created_at": "2026-01-04T12:00:00Z",
      "updated_at": "2026-01-04T12:00:00Z"
    }
  ]
}
```

### Response Fields

- `id`: Presentation identifier
- `title`: Presentation title
- `slide_count`: Number of slides
- `created_at`: Creation timestamp (ISO 8601)
- `updated_at`: Last update timestamp (ISO 8601)

### Error Responses

- `401`: Invalid or expired token

---

## GET /api/presentations/:id

Get a specific presentation with full slide data.

### Headers

```bash
Authorization: Bearer <access_token>
```

### Success Response (200 OK)

```json
{
  "presentation": {
    "id": 1,
    "user_id": 1,
    "title": "Introduction to ML",
    "slide_count": 8,
    "slides": {
      "slides": [
        {
          "id": 1,
          "title": "What is Machine Learning?",
          "content": [
            {
              "type": "text",
              "text": "Machine learning is..."
            },
            {
              "type": "bullet",
              "items": ["Supervised learning", "Unsupervised learning"]
            }
          ],
          "layout": "title-content"
        }
      ],
      "theme": "modern",
      "title": "Introduction to ML",
      "totalSlides": 8
    },
    "created_at": "2026-01-04T12:00:00Z",
    "updated_at": "2026-01-04T12:00:00Z"
  }
}
```

### Slide Structure

Each slide contains:

- `id`: Unique slide identifier
- `title`: Slide title
- `content`: Array of content blocks
- `layout`: Layout template name

### Content Block Types

- `text`: Plain text content
- `bullet`: Bulleted list items
- `chart`: Data visualization configuration
- `image`: Image with caption

### Error Responses

- `401`: Invalid or expired token
- `403`: Unauthorized access (not owner)
- `404`: Presentation not found

---

## DELETE /api/presentations/:id

Delete a specific presentation.

### Headers

```bash
Authorization: Bearer <access_token>
```

### Success Response (200 OK)

```json
{
  "message": "Presentation deleted successfully"
}
```

### Error Responses

- `401`: Invalid or expired token
- `403`: Unauthorized access (not owner)
- `404`: Presentation not found

---

## Token System

### Token Costs

- **1 slide token** ≈ **2500 AI tokens**
- **New users** receive **10 slide tokens**
- **Token deduction** occurs when generation starts

### Token Management

```json
{
  "slide_tokens": 8.5,
  "tokens_used_this_generation": 1.5
}
```

### Token Responses

- `402`: Insufficient tokens error
- Token balance included in user profile responses
- Token deduction logged in presentation metadata

---

## Export Functionality

While not a separate API endpoint, presentations can be exported:

### Export Formats

- **PPTX**: PowerPoint presentation (most compatible)
- **PDF**: PDF document (print-friendly)
- **Images**: Individual slide images

### Export Process

1. Retrieve presentation data via `GET /api/presentations/:id`
2. Process slides with appropriate formatting
3. Generate export file using client-side libraries
4. Download file via browser

For authentication endpoints, see [AUTH_API.md](AUTH_API.md).
