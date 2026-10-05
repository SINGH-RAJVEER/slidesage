# API reference

- Local origin: `http://localhost:8000`.
- Browser requests include credentials for the HTTP-only JWT cookie. API clients may use `Authorization: Bearer <jwt>`.
- JSON errors use `{ "error": { "message": "Description" } }`; coded auth errors use top-level `code` and `message`.
- [Rate limits](RATE_LIMITING.md) return `429`, `Retry-After`, and `RATE_LIMITED`.

## Health

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `GET` | `/health` | No | `{ status: "ok", timestamp }` |

## Authentication

- Auth routes cover registration, OTP verification/reset, JWTs, sign-out, and Google/GitHub OAuth.
- See [Authentication](AUTH_API.md) for endpoints and security behavior.

## Profile

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| `GET` | `/profile` | None | Current profile |
| `PUT` | `/profile` | `name`, `email`, `currentPassword`, `newPassword`, `landingPage` | Update profile or preferences |
| `POST` | `/profile/email/verify` | `email`, `otp` | Complete email change |
| `POST` | `/profile/avatar` | `imageUrl` | Set avatar URL |
| `POST` | `/profile/avatar/upload` | Multipart `file` | Upload avatar |
| `GET` | `/profile/avatar/image/{id}` | None | Public uploaded avatar |

- Management requires authentication; uploaded avatar URLs are public.
- Password and email changes require current-password proof. Email changes finish through OTP verification. See [Security changes](AUTH_API.md#password-and-email-changes).
- Avatar URLs must be HTTPS, at most 2,048 characters, and contain no embedded credentials or control characters.
- Avatar uploads accept PNG, JPEG, WebP, and GIF up to 800 KB and replace the previous image.
- `landingPage` accepts `generate`, `presentations`, or `landing`, defaults to `generate`, updates independently, and appears in profile/session responses.

## Presentations

Owner authentication is required except for `/shared` routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/presentation-jobs` | Submit generation, revision, retry, or research preview |
| `GET` | `/generation-jobs/{id}` | Job status |
| `GET` | `/generation-jobs/{id}/events` | Persisted SSE events |
| `POST` | `/generation-jobs/{id}/cancel` | Cancel active job |
| `POST` | `/presentation-outlines` | Plan before drafting |
| `GET` | `/presentations` | List decks |
| `GET` | `/presentations/{id}` | Deck metadata |
| `DELETE` | `/presentations/{id}` | Delete deck, `204` with no body |
| `GET` | `/presentations/{id}/document` | Current card document |
| `PUT` | `/presentations/{id}/document` | Save edited document revision |
| `GET` | `/presentations/{id}/assets/{sha256}` | Stored image or remote redirect |
| `POST` | `/presentations/{id}/assets/stock` | Register Unsplash photo |
| `POST` | `/presentations/{id}/assets/upload` | Upload image |
| `GET` | `/images/search` | Search Unsplash |
| `GET` | `/presentations/{id}/export/pptx` | Export current revision |
| `GET` | `/presentations/{id}/share` | Share status |
| `POST` | `/presentations/{id}/share` | Create or replace share link |
| `DELETE` | `/presentations/{id}/share` | Revoke share link |
| `GET` | `/shared/{token}` | Public shared document |
| `GET` | `/shared/{token}/assets/{sha256}` | Currently referenced shared photo |
| `POST` | `/templates/{templateId}/presentations` | Create deck from curated template |
| `POST` | `/presentations/{id}/templates/{templateId}` | Register template assets for replacement |

- New generation requires `topic` and `slide_count`; optional fields include `detail_level`, `tonality`, `research`, `research_payload`, `theme`, and approved `plan`.
- `theme` must be known to the converter and defaults to `slate`. AI revisions reject a theme request and retain the saved theme.
- AI revisions require `parent_presentation_id`, instruction in `topic`, and `base_revision`; optional `card_ids` target selected cards. Stale bases return `409` before reservation.
- Retry uses `retry_presentation_id` for an owned failed deck and reuses that row.
- Request fields use snake case, except nested research options documented below.
- Missing `CARD_CONVERTER_URL` returns `503` before reserving points; research previews remain available.
- Documents use versioned cards in PostgreSQL JSONB. Stored images require `PRESENTATION_GCS_BUCKET`; text-only documents do not.
- Editing, outlines, photos, shares, and export contracts are in [Card documents](CARD_DOCUMENTS.md).
- List pagination uses `limit` from 1 to 100, default 20, and non-negative `offset`, default 0, bounded by JavaScript's maximum safe integer. Responses include `presentations`, `total`, `limit`, `offset`, and `has_more`.
- Summaries expose `generating`, `ready`, or `failed` status and `has_research`. Failed decks retain `failure.retry` settings for recovery.

### Input limits

- Generation, research-preview, revision, and outline submissions allow bodies up to 256 KiB.
- Oversized bodies return `413`; malformed JSON, non-object bodies, invalid types, and out-of-range values return `400`.
- `topic` and revision instructions contain 1 to 400 trimmed characters; slide counts are integers from 5 to 40.
- Detail levels: `brief`, `concise`, `balanced`, `detailed`, `comprehensive`.
- Tonalities: `casual`, `professional`, `enthusiastic`, `persuasive`.
- Direct-provider model IDs are at most 200 characters.
- `research` requires boolean `enabled`. Preview requires it to be true.
- `maxResults` is 1 to 8. Each domain list has at most ten entries of at most 253 characters.
- Publication dates use valid `YYYY-MM-DD` values with start no later than end. `maxAgeHours` is an integer from 0 to 8,760.
- Supplied research has at most eight sources. Titles cap at 500 characters, snippets at 2,000, URLs at 2,048, authors at 200, summaries at 4,000, and date strings at 64. Each source has at most eight highlights of 1,200 characters.
- Research links may use HTTP/HTTPS; presentation image URLs remain HTTPS-only.

### Streaming

- Submission returns JSON. Open `/generation-jobs/{id}/events` separately for SSE.
- Events report creation, theme, planning/drafting/finalizing stages, repairs, and card previews.
- `complete` contains the final document; `saved` acknowledges durable persistence and settlement. Treat `saved` as success; `error` terminates failures.
- Streams send keepalive comments. Disconnecting does not cancel the job.
- Provider failures persist actionable retry metadata. Credit/quota failures refund points and require account funding or smaller requests rather than automatic retries.
- Browser clients handle non-JSON proxy errors as service failures.

### Durable job status and replay

- New submissions return `202` with `job_id`, `presentation_id`, and `status: "queued"`; matching committed resubmissions return `200` and `status: "existing"`.
- Client `job_id` values contain 16 to 128 URL-safe characters; the server generates one when omitted. Changed input with the same ID returns `409`.
- After a lost submission response, poll that ID before resubmitting.
- Statuses are `queued`, `running`, `retrying`, `succeeded`, `failed`, and `cancelled`.
- Resume SSE with `Last-Event-ID` or `?after=<id>`; the header wins. Only later events replay.
- Cancellation returns `202` with `status: "cancellation_requested"`, or `409` for non-cancellable jobs.
- `preview: true` returns research `sources`, `estimated_tokens`, and `slide_tokens_remaining` synchronously without a job.
- Queue retries, reservations, refunds, and external-call guarantees are in [Generation worker](GENERATION_WORKER.md).

### Point accounting

- One point is 1,000 milli-points; one provider token is one milli-point.
- Server-funded generation reserves a bounded authorization and settles authoritative provider usage. Missing usage fails generation and releases the reservation.
- Every balance change enters immutable `point_ledger`; balances cannot become negative.
- `saved` includes `slide_tokens_charged` and `slide_tokens_remaining` in display points.
- BYOK reserves zero model points. Each successful Exa search costs one point with separate idempotent accounting and refunds on failure.

## Billing

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/billing/balance` | User | Return `slide_tokens` |
| `POST` | `/billing/checkout` | User | Create Razorpay order |
| `POST` | `/billing/verify` | User | Verify captured payment and credit points |
| `POST` | `/billing/webhook` | Signature | Process `payment.captured` |

| Plan | Points | INR price |
| --- | --- | --- |
| `starter` | 25 | ₹50 |
| `pro` | 250 | ₹450 |
| `premium` | 625 | ₹1000 |
| `custom` | 25 to 10,000 | ₹2/point, 10% discount at 250 and 20% at 625 |

- Checkout validates provider order amounts, currency, receipt, status, and partial-payment fields.
- Verification checks strict hexadecimal HMAC, fetches the payment, and requires matching captured INR payment/order IDs and amount.
- Webhooks verify the exact raw body and require complete `payment.captured` entities.
- Claiming payment and crediting points are one transaction. Repeated payment is idempotent; conflicting details return `409`.
- Another user's order returns `403`. A webhook arriving before the local order returns `503` for retry.

## Feedback

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/feedback` | User | Store a 1 to 4,000 character `message` |

- Validation, limits, and storage are in [Feedback and bug reports](FEEDBACK.md).

## CORS

- `CORS_ORIGINS` or `CORS_ORIGIN` allow credentialed requests. Local origins are `http://localhost:5173` and `http://127.0.0.1:5173`.
- Allowed methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`.
- Allowed headers: `Content-Type`, `Authorization`, `Last-Event-ID`.

## AI provider connections

- `/ai` manages encrypted keys and model selection for `openai`, `google`, and `anthropic`.
- Generation may supply `ai: { provider, model }`; revisions resolve the current selection server-side.
- Keys are never returned. Eligibility, routes, switches, and errors are in [BYOK connections](BYOK_CONNECTIONS.md).
