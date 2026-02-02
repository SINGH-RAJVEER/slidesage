# Frontend Routing

The frontend app (apps/frontend) is a React SPA using React Router.

## Route Map

Public:

- `/sign-in/*` – Clerk sign-in flow
- `/sign-up/*` – Clerk sign-up flow

Protected (requires auth):

- `/` – Home
- `/generate` – Generate a presentation
- `/presentations` – Presentations grid
- `/presentation` – Viewer (driven by navigation state)
- `/presentation-error` – Viewer error page
- `/purchase` – Purchase points

## Auth Guard

Protected routes are wrapped by `RequireSignedInLayout`, which redirects signed-out users to:

- `/sign-in?redirect_url=<current-path>`

`redirect_url` is then applied in the sign-in/up pages as the post-auth redirect.

## Where Things Live

- Router definition: apps/frontend/src/router/router.tsx
- Auth guard: apps/frontend/src/router/RequireSignedInLayout.tsx
- Routes (route-level components): apps/frontend/src/routes/
