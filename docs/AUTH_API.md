# Authentication

- `apps/api/internal/auth` owns email/password sign-in, verification and reset OTPs, Google and GitHub OAuth, JWT cookies, and sign-out.
- Browser requests must include credentials. API clients may send the same JWT as `Authorization: Bearer <jwt>`.

## Configuration

Required production values:

```dotenv
AUTH_SECRET=replace-with-at-least-32-random-characters
BASE_URL=https://api.slidesage.app
BETTER_AUTH_TRUSTED_ORIGINS=https://slidesage.app,https://www.slidesage.app
CORS_ORIGINS=https://slidesage.app,https://www.slidesage.app
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=auth@example.com
```

- Set `VITE_API_URL=https://api.slidesage.app` when building the web app, without an `/api` suffix.
- Allow frontend origins in CORS and the OAuth callback trusted-origin list. Trusted origins fall back to `CORS_ORIGINS`.
- HTTPS auth initialization requires `AUTH_SECRET` to contain at least 32 characters.
- Local defaults are API `http://localhost:8000` and frontend `http://localhost:5173`.
- Google OAuth needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; GitHub needs `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
- Register `${BASE_URL}/auth/callback/google` and `${BASE_URL}/auth/callback/github` with the providers.

## Primary endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/sign-up/email` | Create an account |
| `POST` | `/auth/email-otp/send-verification-otp` | Send or replace a verification OTP |
| `POST` | `/auth/email-otp/verify-email` | Verify email and issue a JWT |
| `POST` | `/auth/sign-in/email` | Sign in |
| `POST` | `/auth/sign-in/social` | Start OAuth |
| `POST` | `/auth/email-otp/request-password-reset` | Send or replace a reset OTP |
| `POST` | `/auth/email-otp/reset-password` | Reset a password using an OTP |
| `GET` | `/auth/get-session` | Validate the JWT and return the current user |
| `POST` | `/auth/sign-out` | Clear the cookie |
| `GET` | `/auth/callback/google` | Complete Google OAuth |
| `GET` | `/auth/callback/github` | Complete GitHub OAuth |
| `POST` | `/profile/email/verify` | Complete an authenticated email change |

- Use `libs/ui/lib/auth-client.ts` for browser flows. Its `AuthError` exposes backend codes such as `EMAIL_NOT_VERIFIED` and `INVALID_EMAIL_OR_PASSWORD`.
- Auth failures with codes use top-level `code` and `message` fields.

## Signing out in the browser

- `AuthContext.signOut` immediately clears the local user, cached balance, and pending auth refreshes.
- It sends `/auth/sign-out` with `keepalive` and redirects to `/sign-in` when the request settles or after one second.
- Failed requests are logged without throwing. Repeated presses during sign-out are ignored.

## Password and email changes

- Profile keeps unfinished name, email, and avatar URL edits in browser storage per account, including which forms were open. Returning or refreshing restores them after loading the saved profile. Save and Cancel clear the corresponding name or email draft. Password fields are never stored and must be entered again after leaving the page.
- `PUT /profile` requires a JWT and current-password verification for security changes.
- Password changes require `currentPassword` and `newPassword`, write a salted scrypt hash, and cannot include name or email changes.
- Email changes require `currentPassword`. The API sends a user-bound six-digit OTP to the normalized new address and returns `pending_email` and `verification_required`; the existing email stays unchanged.
- `/profile/email/verify` accepts `email` and `otp`, atomically consumes the code, updates the verified email, and invalidates relevant OTPs for both addresses.
- Users who forgot their password must complete the reset OTP flow before changing email.
- Password changes and resets leave existing JWTs valid until expiry.
- Migration 36 replaced unsalted SHA-256, PBKDF2, and old `email`-provider credentials with unusable markers. Affected users must reset their password.

## OTP delivery

- Addresses are trimmed and lowercased. Codes contain six digits and expire after 15 minutes.
- Replacement is serialized by identifier. The previous code remains valid until Resend accepts the replacement email.
- Delivery failure deletes only the new code and preserves the previous one. A delivered email-change replacement invalidates older pending codes for that user.
- Resend errors, the delivery timeout, and missing production credentials return `503` with `Email delivery is temporarily unavailable`.
- `EMAIL_DELIVERY_TIMEOUT_MS` defaults to 10 seconds.
- Development without a Resend key skips delivery and may return success, but never logs the code. Configure a test sender to receive OTPs.
- Email and IP [rate limits](RATE_LIMITING.md) apply to OTP, sign-in, and sign-up routes.

## Behavior

- Email/password users must verify their email. Successful verification signs them in.
- Correct-password sign-in and repeated sign-up for an unverified address send a fresh OTP and open verification. Sign-up for a verified address returns `Email already in use`.
- Reset requests for unknown addresses return `404 ACCOUNT_NOT_FOUND` and send nothing. This exposes account existence; email and IP limits bound probing.
- Unverified credential-only accounts expire after 24 hours. Cleanup preserves accounts with active verification codes or linked OAuth providers and removes associated OTPs with deleted accounts.
- Resend controls stay disabled during cooldown; the cooldown text confirms resending.
- Session responses include server-owned `slideTokens`.
- The frontend retries transient session lookup failures. Focus revalidation runs only when the last check is at least five minutes old, and overlapping checks share a request.
- Auth transitions invalidate older checks. Generation and payment responses update balances directly.

## JWT tokens

- `github.com/golang-jwt/jwt/v5` signs HS256 tokens with `AUTH_SECRET` and verifies the signing method and required, unexpired `exp`.
- Claims include user ID in `sub`, email, `exp`, and `iat`.
- The HTTP-only `slidesage_token` cookie contains the JWT. Local HTTP uses `SameSite=Lax`; HTTPS uses `Secure` and `SameSite=None`.
- Remember me is enabled by default and sets cookie expiry. Clearing it creates a browser-session cookie; JWT expiry still applies.
- Sign-out clears the cookie. Issued bearer tokens remain valid until expiry because there is no server-side session store.
