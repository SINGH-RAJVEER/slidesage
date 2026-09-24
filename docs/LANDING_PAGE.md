# Landing Page

The landing page is the public entry point at `/` for visitors without a session. It is a single full-viewport hero: a black-hole event-horizon visual on the app's signature deep navy. There is no header, copy, or footer — the horizon is the page.

## Route Behaviour

- The index route renders `EntranceRoute` (`apps/web/src/app/router/EntranceRoute.tsx`).
- Anonymous visitors see the landing page instead of being redirected straight to sign-in.
- Signed-in visitors go wherever their default-page setting points. `generate` and `presentations` forward through `HomePage` as before; `landing` keeps them on the landing page.
- `/landing` renders the landing page for everyone, signed in or not. The app header's SlideSage icon links there (`ROUTES.landing`), so clicking the icon from anywhere in the app always reaches the landing page.
- All other guarded routes keep the existing `RequireSignedInLayout` redirect to sign-in with a `redirect_url`.

## Hero: Wordmark Orb

`LandingPage` (`apps/web/src/routes/landing/LandingPage.tsx`) paints the background and mounts `WordmarkOrb` (`apps/web/src/routes/landing/WordmarkOrb.tsx`):

- The background is the SlideSage signature navy (`#161b27`) with the app's soft top glow.
- `WordmarkOrb` renders a stylized black liquid horizon with no separate accretion disk, photon ring, or external glow.
- The nearly black surface has broad, distorted steel and navy reflections. Highlights drift slowly and the silhouette flexes slightly to give it a playful, transient appearance. Reflections fade before the edge so they never form a luminous outline.
- A sparse Canvas 2D star field and 115 faint outward perspective flights sit behind the center. Flight speed, size, and trail length increase toward the viewer; a small distance-weighted bend grows with the horizon. Paths are sampled from elapsed time and fade at recycling boundaries. The shader paints immediately, pauses off-screen or in a hidden tab, and renders a static frame for reduced motion. The CSS fallback uses the same black surface and localized reflections.
- Cursor proximity drives a reversible capture sequence. Outside 43% of the shorter viewport dimension, the horizon rests at one-third of its former radius. Moving inside that threshold grows it toward 1.22 times the former radius, reaching full size within 8% of the shorter dimension. Exponential smoothing prevents jumps when the cursor moves quickly. Once capture is complete, the preserved SlideSage PNG fades onto the black surface. Leaving the horizon releases the lock. Touch movement does not trigger hover capture; reduced motion removes surface deformation and the interpolated approach.
- The former orb wordmark is preserved exactly as a transparent PNG at `apps/web/public/landing/slidesage-wordmark-current.png` for later reuse.
- The black hole is the page's call to action: it is a link to `/sign-up` (keyboard focusable, pointer cursor), and its no-WebGL fallback links there too.
- The star field repaints at 30fps rather than per frame, at CSS resolution, from pre-rendered sprites. The orb's own budget is 1.5x device pixels with multisampling off, since the shader antialiases the only edge in it, and its noise runs three octaves rather than four.

The orbiting ring of template slides that used to surround the horizon was removed with the PPTX template catalog it drew from.

## Files

- `apps/web/src/routes/landing/LandingPage.tsx` — full-viewport page shell.
- `apps/web/src/routes/landing/WordmarkOrb.tsx` — the WebGL black-hole stage, star layer, and CSS fallback.
- `apps/web/src/routes/landing/wordmark-orb-shaders.ts` — the black liquid surface and reflection GLSL programs.
- `apps/web/src/app/router/EntranceRoute.tsx` — auth- and preference-aware index route. The landing page is split out of the initial bundle here: a signed-in visitor whose default is an app page never downloads the shader or the star field. A browser with no sign-in history is the page's audience, so the chunk is warmed as the module loads and fetches alongside the session check rather than after it.
- `libs/ui/components/Settings/LandingPreference.tsx` — the default-page picker, including the landing option.
- `apps/web/src/app/Header.tsx` — app header; its icon links to `/landing`.
- `apps/web/src/test/routes/landing/LandingPage.test.tsx` — render and route tests.
- `apps/web/src/test/routes/landing/WordmarkOrb.test.tsx` — orb labelling, canvas layering, and fallback tests.

## Clicking through the horizon

Clicking the black hole expands its silhouette to cover the viewport, fades its reflections and lettering, and blends into the exact shared page-background gradient. The cover persists across navigation and page loading; it never swaps to an orb loader.

- New signed-out visitors go to Sign Up. A browser that has previously held a successful session goes to Sign In. This uses only the local `slidesage-signed-in-before` boolean, never stored credentials or account details; clearing browser storage resets this hint.
- Signed-in visitors go to their Generate or Presentations default. Choosing Landing as the default sends this click to Generate.
- Lazy destination code warms during expansion. Auth forms and Generate report readiness after mounting; Presentations waits for its initial data request to succeed or fail, so an error can be revealed instead of trapping the user behind the cover.
- After readiness and font loading, the header, title, form groups, and app sections appear in a short stagger. Controls stay inert until the reveal ends, then keyboard focus moves to the destination heading or main region. That landing focus is an announcement for assistive technology and carries no focus ring, because on a full-bleed landmark such as the generate page's main region the ring reads as a stray line across the page; the temporary tabindex and the ring suppression are both dropped on blur. Reduced motion uses a brief fade without stagger or movement.
- If a request stalls, the cover offers a direct-page recovery link after twelve seconds. Ordinary navigation outside this landing interaction keeps its existing loading behavior.

The coordinator lives in `apps/web/src/app/transitions/HorizonTransition.tsx`, above the route outlet. Destination pages use `useHorizonPageReady` to signal when their initial content is ready.

Transition refinements: pointer clicks are accepted only inside the visible horizon (with a six-pixel allowance), while Enter retains keyboard activation. Browser history changes cancel the cover and invalidate late animation completions. Cover sizing allows for window growth, and reduced motion uses a full-screen fade rather than a rapid spatial expansion. Destination elements use a lighter blur, shorter travel, and a stagger that starts just after the cover begins fading.
