# Feedback and bug reports

- The account menu in the app header lists Profile, Settings, Feedback, Report a bug, and Sign Out.
- Feedback opens `/feedback`, a signed-in page with one free-text field.
- Report a bug opens the [GitHub issues page](https://github.com/SINGH-RAJVEER/slidesage/issues) in a new tab. The URL is `BUG_REPORT_URL` in `libs/ui/components/Header.tsx`.

## Feedback page

- Messages are trimmed and may be 1 to 4,000 characters (`FEEDBACK_MAX_LENGTH` in `@slidesage/types`). Send stays disabled while the field is blank.
- A successful send clears the field and shows a success notice. A failed send keeps the draft and shows the API error. Both use [`FloatingNotice`](USER_NOTICES.md).
- Unsent feedback is saved in browser storage per account and restored after navigation or refresh. Sending successfully clears the saved draft. Drafts do not sync between browsers.

## API

| Method | Path | Auth | Body | Result |
| --- | --- | --- | --- | --- |
| `POST` | `/feedback` | User | `{ "message": string }` | `201` with `{ feedback: { id, created_at } }` |

- Unknown fields, malformed JSON, blank messages, and messages over 4,000 characters (counted as Unicode code points) return `400`. Bodies over 32 KiB return `413`. Missing sessions return `401`.
- Submissions are limited to 10 per user per hour. See [Rate limiting](RATE_LIMITING.md).

## Storage

- Migration 38 creates the `feedback` table: `id`, `user_id`, `message`, and `created_at`, with an index on `created_at` for newest-first reads.
- Rows cascade-delete with their user.
- There is no read API or admin view yet. Query the table directly until the feedback dashboard exists.

## Rust port

The isolated `rust-backend` workspace implements this route in `apps/backend-rust/src/feedback.rs`. It uses SQLx checked queries against the existing `feedback` and `api_rate_limits` tables; no migration changed. Authentication follows the existing bearer/cookie selection and JWT identity behavior. Validation preserves Go's field matching, duplicate/null handling and Unicode replacement rules.

The existing Go handler tests support `API_UNDER_TEST_URL`; their persistence assertions read actual PostgreSQL rows when targeting Axum. A separate compatibility test compares Go/Rust rate counters and responses. See [Rust development](DEVELOPMENT_SETUP.md#rust-port-development) for disposable-database setup and commands. These checks cover the current cases; the complete backend still needs the full compatibility gate before cutover.
