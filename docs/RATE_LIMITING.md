| `POST /feedback` | Authenticated user | 10 | 1 hour |
# Rate limiting

- Fixed-window counters live in PostgreSQL `api_rate_limits`, shared across API instances.
- Migration 12 creates the table and expiry index; migration 13 repairs them.

## Policies

| Route group | Identity | Limit | Window |
| --- | --- | --- | --- |
| `/auth/email-otp/*` | Normalized email | 5 | 1 hour |
| `/auth/email-otp/*` | Client IP | 20 | 1 hour |
| `/auth/sign-in/*` | Normalized email | 10 | 15 minutes |
| `/auth/sign-in/*` | Client IP | 30 | 15 minutes |
| `/auth/sign-up/*` | Normalized email | 5 | 1 hour |
| `/auth/sign-up/*` | Client IP | 20 | 1 hour |
| `PUT /profile`, `POST /profile/email/verify`, `POST /profile/avatar`, `POST /profile/avatar/upload` | Authenticated user | 10 shared | 15 minutes |
| `POST /ai/connections`, `PUT /ai/connections/:provider` | Authenticated user | 6 shared | 10 minutes |
| `DELETE /ai/connections/:provider`, `PUT /ai/selection`, `PUT /ai/connections/:provider/enabled` | Authenticated user | 20 shared | 10 minutes |
| `POST /presentation-jobs` | Authenticated user | 15 | 1 minute |
| `POST /billing/checkout` | Authenticated user | 10 | 10 minutes |
| `POST /billing/verify` | Authenticated user | 20 | 15 minutes |
| `POST /billing/webhook` | Client IP | 120 | 1 minute |
| `GET /shared/:token` | Client IP | 60 | 1 minute |
| `GET /shared/:token/assets/:sha256` | Client IP | 600 | 1 minute |
| `POST /presentations/:id/share` | Authenticated user | 20 | 1 hour |
| `GET /images/search` | Authenticated user | 60 | 1 hour |
| `GET /presentations/:id/export/pptx` | Authenticated user | 30 | 1 hour |

- Evaluate both email and IP limits when a parseable email is present; IP limits always apply. Either exhausted counter rejects the request.
- Invalid requests count because limiting precedes validation. `OPTIONS` bypasses limiting.
- Client IP defaults to the socket address. With `TRUST_PROXY_HEADERS=true`, precedence is `CF-Connecting-IP`, first `X-Forwarded-For`, then `X-Real-IP`.
- Enable proxy headers only behind a proxy that replaces client-supplied values.

## Response

- Exceeded limits return `429 Too Many Requests`, numeric `Retry-After` seconds, and:

```json
{
	"error": {
		"message": "Too many requests",
		"code": "RATE_LIMITED"
	},
	"retry_after": 42
}
```

- Wait for `Retry-After` before retrying. Remaining-quota headers are not emitted.

## Identity storage

- Store SHA-256 hashes of scope and identity rather than raw email, user ID, or IP.
- Use an independent deployment-specific `RATE_LIMIT_HASH_SECRET`. `AUTH_SECRET` is the fallback.
- Rotating the hash secret starts new counters.

## Failure mode

- Counter-store errors or missing production hash secrets return `503 RATE_LIMIT_UNAVAILABLE` and log a safe error.
- Apply migrations 12 and 13 before deployment; monitor `rate_limit_store_failed`.
- Cleanup deletes at most 500 expired rows per maintenance sweep using `SKIP LOCKED`, outside request handlers. See [Recovery and cleanup](GENERATION_WORKER.md#recovery-and-cleanup).

## Verification

- Go tests cover identity hashing and policy selection.
- For limiter changes, verify concurrent instances, store failure, and `429` behavior behind the staging proxy.
