# Landing Page

The landing page is the public entry point at `/` for visitors without a session. It is a single full-viewport hero: sample slides orbiting a black-hole event-horizon visual on the app's signature deep navy. There is no header, copy, or footer — the ring is the page.

## Route Behaviour

- The index route renders `EntranceRoute` (`apps/web/src/app/router/EntranceRoute.tsx`).
- Anonymous visitors see the landing page instead of being redirected straight to sign-in.
- Signed-in visitors go wherever their default-page setting points. `generate` and `presentations` forward through `HomePage` as before; `landing` keeps them on the landing page.
- `/landing` renders the landing page for everyone, signed in or not. The app header's SlideSage icon links there (`ROUTES.landing`), so clicking the icon from anywhere in the app always reaches the landing page.
- All other guarded routes keep the existing `RequireSignedInLayout` redirect to sign-in with a `redirect_url`.

## Hero: Slide Ring

`SlideRingHero` (`apps/web/src/routes/landing/SlideRingHero.tsx`) is a DOM ring adapted from the ThreeUI Gallery Heading reference (matte variant, rising-diagonal axis):

- The background is the SlideSage signature navy (`#161b27`) with the app's soft top glow.
- `WordmarkOrb` renders a stylized black liquid horizon. The orbiting slides represent the light around it, so the center has no separate accretion disk, photon ring, or external glow.
- The nearly black surface has broad, distorted steel and navy reflections. Highlights drift slowly and the silhouette flexes slightly to give it a playful, transient appearance. Reflections fade before the edge so they never form a luminous outline.
- A sparse Canvas 2D star field and 115 faint outward perspective flights sit behind the center. Flight speed, size, and trail length increase toward the viewer; a small distance-weighted bend grows with the horizon. Paths are sampled from elapsed time and fade at recycling boundaries. Distant slides are dimmed rather than softened, while a broad vignette adds depth to the backdrop. The shader paints immediately, pauses off-screen or in a hidden tab, and renders a static frame for reduced motion. The CSS fallback uses the same black surface and localized reflections.
- Cursor proximity drives a reversible capture sequence. Outside 43% of the shorter viewport dimension, the horizon rests at one-third of its former radius. Moving inside that threshold grows it toward 1.22 times the former radius, reaching full size within 8% of the shorter dimension. Exponential smoothing prevents jumps when the cursor moves quickly.
- Slides fall individually along staggered radial paths, with small independent bends and stretching toward the center; the belt never rotates inward as a group. They shrink and fade into the darkness. Once capture is complete, the preserved SlideSage PNG fades onto the black surface. Capture locks on the first entry into the growing horizon, including when the growing surface reaches a stationary cursor. It completes expansion even if the cursor immediately crosses the center toward the opposite edge, and stays locked until the cursor exits the expanded boundary plus a six-pixel allowance. The black surface responds with at most three pixels of displacement, 0.65 degrees of skew, and 0.8% stretch, settling quickly without trailing the cursor. Leaving the horizon releases the lock and restores the ring. Touch movement does not trigger hover capture; reduced motion removes path bending, stretching, surface deformation, and the interpolated approach.
- The former orb wordmark is preserved exactly as a transparent PNG at `apps/web/public/landing/slidesage-wordmark-current.png` for later reuse.
- Thirty plates ride a tilted ellipse on a desktop-width screen. That is well past what the ellipse would hold end to end, so each plate is offset from its nominal place on the line — in and out of the ring's radius, above and below its plane, and off its evenly spaced slot — which turns the line into a belt with thickness. The offsets are seeded from the plate's ring position rather than drawn at random, so the belt is laid out identically on every frame and across a resize; a plate that jittered per frame would shake rather than orbit.
- The count steps down on narrower screens (eighteen under 1024px, ten under 640px). The ring's radius scales with the viewport while a plate stays the same fraction of it, so a crowd sized for the desktop belt would land on a phone as a cluster of specks. It is fixed at mount: the plate count is structural, and rebuilding the ring mid-resize would restart every plate's orbit.
- Plates behind the black hole render at a lower z-index, while every distinct foreground depth receives its own higher layer. Slides therefore cross in the same geometric order as their projected depth, without one abruptly popping in front of another.
- A plate does not carry the same card for the life of the page. As it passes the back of the ring it is refilled with the next slide from the pool, so the plate that comes back round the other side is showing something else. It fades to nothing over the last six percent of the orbit either side of that crossing and back up again, and the refill happens at the bottom of the dip. The orb used to do that hiding on its own, but the belt's spread means a plate now crosses the back clear of the orb's silhouette as often as behind it; a plate is already at its smallest and faintest there, so dimming the last of the way reads as distance rather than as a plate disappearing. A reduced-motion visitor gets a single static frame with no dip, since a plate parked at the crossing would otherwise be missing from the ring for good. The outgoing card returns to the end of the queue, so the pool cycles rather than running dry.
- A plate's card is drawn in the DOM rather than downloaded, so the whole ring paints with its first frame; there is nothing to preload, decode, or fade in. Each plate's card is memoised, so refilling one plate re-renders only that plate.
- The ring starts in a slow ambient orbit of one revolution every 26 seconds. Dragging horizontally accelerates it in the drag direction; releasing stores that angular velocity and lets it coast back toward the ambient turn under exponential friction. Repeated throws in the same direction add speed, while a reverse throw brakes and can reverse it. A drag under six pixels counts as a click instead.
- Clicking a plate opens a hovering preview: the same card at 68 percent of the hero's width over a blurred backdrop, captioned with the sample deck's title and the card's position in it. The dialog holds its own copy of the card, so the ring may recycle the plate it was opened from without the preview changing under the reader. Clicking anywhere outside it or pressing Escape dismisses it, while the ring keeps turning behind it.
- The black hole is the page's call to action: it is a link to `/sign-up` (keyboard focusable, pointer cursor), and its no-WebGL fallback links there too. Ring drags that pass over it never fire the navigation — pointer travel across the link is tracked and past six pixels the click is suppressed, matching the plates' tap-versus-drag slop.
- `prefers-reduced-motion: reduce` disables the orbit entirely; the ring renders one static frame, and with nothing passing the back of the ring, nothing recycles. There is no frame loop at all in that case — a still ring does not need one, and the loop used to keep rewriting every plate with the values it already held. Drag and resize render directly, so the page stays live without it. The loop also stops while the ring is off screen or the tab is hidden.

## What the frame loop costs

The ring writes to thirty elements sixty times a second, so the loop is written to do as little as it can get away with per frame:

- A plate's spread is a pure function of its index and costs four sines to derive. They are computed once at mount rather than the two or three times a frame each plate used to ask for them.
- The projection array, the repulsion forces, the stacking buffers and the per-plate style cache are all allocated once and rewritten in place. A steady frame allocates nothing, so there is no sawtooth of garbage behind a page that is meant to idle indefinitely.
- Plate repulsion is O(n squared) by nature — thirty plates is 435 pairs — so it compares squared lengths and only takes a root where the value is used.
- Transform changes every frame, but opacity, brightness, z-index and pointer events usually do not. Each plate remembers what was last written to it and skips the rest, because a style rewritten to its own value still costs a recalculation. Brightness and opacity are quantized so they settle rather than jitter in the last decimal.
- Depth is carried by brightness alone. The blur that used to go with it topped out under half a pixel — invisible, while a blur radius that changes every frame is a fresh filter pass per plate per frame.
- The star field is a separate concern: it repaints at 30fps rather than per frame, at CSS resolution, from pre-rendered sprites rather than a filled path per star, and without the `screen` composite it used to blend with. Stars drift over minutes; the orb itself still runs at the display's rate. The orb's own budget is 1.5x device pixels with multisampling off, since the shader antialiases the only edge in it, and its noise runs three octaves rather than four.

## The Plates

Each plate is one card of a sample deck, drawn by `CardView` from `@slidesage/ui/components/Cards`, the renderer the presentation viewer uses. The landing page therefore shows exactly what SlideSage generates, in each of the `slate`, `paper`, and `ember` themes, and ships no images of its own.

`apps/web/src/routes/landing/landing-plates.ts` holds the samples and draws them:

- Six short sample decks are written in the draft format the model writes and converted by `convertCards` and `assembleDocument` from `@slidesage/cards` when the module loads, so a sample that stops fitting the schema fails its test instead of rendering. They cover the text layouts: title, statement, bullets, comparison, process, quote, and stats. Photo layouts are left out, because stored photos are served only to their owner.
- `randomLandingPool` shuffles the decks, shuffles each one's cards, then takes one card per deck per round. Round-robin rather than a flat shuffle because the opening entries are what the ring shows first: every deck, and so every theme, is on the ring before a second card of any of them.
- The pool holds every sample card, a few more than the thirty the ring carries, which is what a plate is refilled from as it passes behind the orb.
- The draw is made once per mount, so the ring differs between visits. The random source is injectable, which is how the tests pin a draw.

## Files

- `apps/web/src/routes/landing/LandingPage.tsx` — full-viewport page shell.
- `apps/web/src/routes/landing/SlideRingHero.tsx` — ring geometry, orbit, drag, card recycling, and preview interactions.
- `apps/web/src/routes/landing/WordmarkOrb.tsx` — the WebGL black-hole stage, star layer, and CSS fallback.
- `apps/web/src/routes/landing/wordmark-orb-shaders.ts` — the black liquid surface and reflection GLSL programs.
- `apps/web/src/routes/landing/landing-plates.ts` — the sample decks, the card pool, and its randomiser.
- `apps/web/src/app/router/EntranceRoute.tsx` — auth- and preference-aware index route. The landing page is split out of the initial bundle here: a signed-in visitor whose default is an app page never downloads the shader, the star field or the sample decks. A browser with no sign-in history is the page's audience, so the chunk is warmed as the module loads and fetches alongside the session check rather than after it.
- `libs/ui/components/Settings/LandingPreference.tsx` — the default-page picker, including the landing option.
- `apps/web/src/app/Header.tsx` — app header; its icon links to `/landing`.
- `apps/web/src/test/routes/landing/LandingPage.test.tsx` — render, route, and plate tests.
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
