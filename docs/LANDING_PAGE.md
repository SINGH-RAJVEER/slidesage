# Landing Page

The landing page is the public entry point at `/` for visitors without a session. It is a single full-viewport hero: rendered template slides orbiting a black-hole event-horizon visual on the app's signature deep navy. There is no header, copy, or footer — the ring is the page.

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
- A sparse Canvas 2D star field and 115 faint outward perspective flights sit behind the center. Flight speed, size, and trail length increase toward the viewer; a small distance-weighted bend grows with the horizon. Paths are sampled from elapsed time and fade at recycling boundaries. Distant slides have restrained softness and lower brightness, while a broad vignette adds depth to the backdrop. The shader paints immediately, pauses off-screen or in a hidden tab, and renders a static frame for reduced motion. The CSS fallback uses the same black surface and localized reflections.
- Cursor proximity drives a reversible capture sequence. Outside 43% of the shorter viewport dimension, the horizon rests at one-third of its former radius. Moving inside that threshold grows it toward 1.22 times the former radius, reaching full size within 8% of the shorter dimension. Exponential smoothing prevents jumps when the cursor moves quickly.
- Slides fall individually along staggered radial paths, with small independent bends and stretching toward the center; the belt never rotates inward as a group. They shrink and fade into the darkness. Once capture is complete, the preserved SlideSage PNG fades onto the black surface. Capture locks on the first entry into the growing horizon, including when the growing surface reaches a stationary cursor. It completes expansion even if the cursor immediately crosses the center toward the opposite edge, and stays locked until the cursor exits the expanded boundary plus a six-pixel allowance. The black surface responds with at most three pixels of displacement, 0.65 degrees of skew, and 0.8% stretch, settling quickly without trailing the cursor. Leaving the horizon releases the lock and restores the ring. Touch movement does not trigger hover capture; reduced motion removes path bending, stretching, surface deformation, and the interpolated approach.
- The former orb wordmark is preserved exactly as a transparent PNG at `apps/web/public/landing/slidesage-wordmark-current.png` for later reuse.
- Thirty plates ride a tilted ellipse on a desktop-width screen. That is well past what the ellipse would hold end to end, so each plate is offset from its nominal place on the line — in and out of the ring's radius, above and below its plane, and off its evenly spaced slot — which turns the line into a belt with thickness. The offsets are seeded from the plate's ring position rather than drawn at random, so the belt is laid out identically on every frame and across a resize; a plate that jittered per frame would shake rather than orbit.
- The count steps down on narrower screens (eighteen under 1024px, ten under 640px). The ring's radius scales with the viewport while a plate stays the same fraction of it, so a crowd sized for the desktop belt would land on a phone as a cluster of specks. It is fixed at mount: the plate count is structural, and rebuilding the ring mid-resize would restart every plate's orbit.
- Plates behind the black hole render at a lower z-index, while every distinct foreground depth receives its own higher layer. Slides therefore cross in the same geometric order as their projected depth, without one abruptly popping in front of another.
- A plate does not carry the same slide for the life of the page. As it passes the back of the ring it is refilled with the next slide from the pool, so the plate that comes back round the other side is showing something else. It fades to nothing over the last six percent of the orbit either side of that crossing and back up again, and the refill happens at the bottom of the dip. The orb used to do that hiding on its own, but the belt's spread means a plate now crosses the back clear of the orb's silhouette as often as behind it; a plate is already at its smallest and faintest there, so dimming the last of the way reads as distance rather than as a plate disappearing. A reduced-motion visitor gets a single static frame with no dip, since a plate parked at the crossing would otherwise be missing from the ring for good. The outgoing slide returns to the end of the queue, so the pool cycles rather than running dry, and its second time round costs no bytes.
- Slides are fetched four ahead of the plate that will show them, and a plate whose turn comes with nothing decoded yet keeps the slide it has and takes the next pass instead. That is what keeps a swap from ever showing a half-loaded image, and it means a slow connection simply recycles less often rather than flickering. Preloading waits on `decode()` rather than the load event: a loaded image is downloaded, not yet rasterised, and handing one to a plate leaves the decode to happen on the frame it first paints, which is the hitch the preloading exists to avoid.
- Plate images are fetched eagerly. A plate is never at rest — it orbits through the viewport whether or not it started there — so `loading="lazy"` guarantees it pops in mid-flight. The full ring is around a megabyte at roughly 42KB a slide.
- A plate's body — slide, hairline ring and drop shadow together — starts at zero opacity and fades up over 420ms once its slide can paint, so plates arrive rather than pop. The body rather than the image alone, because fading only the image would leave an empty outlined box orbiting until the slide landed. This is a CSS transition on an element nested inside the one the frame loop writes to, so the two opacities multiply and the reveal does not depend on the loop running. A plate whose slide and cover both fail stays hidden rather than parading an empty box.
- The reveal is also triggered on mount, not just from the load event. A cached image is already complete before React can attach a handler and `load` does not bubble, so on a warm cache the load handler never fires — without the mount check the entire ring sits at zero and is simply not there.
- The ring starts in a slow ambient orbit of one revolution every 26 seconds. Dragging horizontally accelerates it in the drag direction; releasing stores that angular velocity and lets it coast back toward the ambient turn under exponential friction. Repeated throws in the same direction add speed, while a reverse throw brakes and can reverse it. A drag under six pixels counts as a click instead.
- Clicking a plate opens a hovering preview: the same slide at 68 percent of the hero's width over a blurred backdrop, captioned with the template name and the slide's position in the deck. The dialog holds its own copy of the slide, so the ring may recycle the plate it was opened from without the preview changing under the reader. Clicking anywhere outside it or pressing Escape dismisses it, while the ring keeps turning behind it.
- The black hole is the page's call to action: it is a link to `/sign-up` (keyboard focusable, pointer cursor), and its no-WebGL fallback links there too. Ring drags that pass over it never fire the navigation — pointer travel across the link is tracked and past six pixels the click is suppressed, matching the plates' tap-versus-drag slop.
- `prefers-reduced-motion: reduce` disables the orbit entirely; the ring renders one static frame, and with nothing passing the back of the ring, nothing recycles.

## The Plates

Each plate is one rendered slide of a published template — a cover, a section divider, or a content page — read from `GET /template-previews/{id}/{version}/{digest}/{index}`, the same full-slide previews the marketplace viewer shows. The landing page ships no slide fixtures of its own, so it cannot drift from what the product actually produces.

The route is public and the digest is part of the path, so the page addresses a slide straight from the catalog it already holds: no preview manifest is fetched, and the ring paints on the first render rather than after a round trip.

`apps/web/src/routes/landing/landing-plates.ts` draws them:

- The templates are every marketplace entry that is published (a digest exists in the catalog) and 16:9, so a plate never letterboxes and never points at a missing image.
- Every slide of those templates is a candidate except the last. Each package closes with the same credits slide — the "free for everyone to use, thanks to the following" attribution page — which is the one slide that says nothing about the design. `templatemanifest` holds the authority for that: its `TestClosingIsAlwaysTheFinalSlide` pins the closing archetype to the final slide, so the arithmetic here cannot quietly start cutting a content page instead.
- `randomLandingPool` shuffles the templates, shuffles each one's slides, then takes one slide per template per round until it has seventy-two. Round-robin rather than a flat shuffle because the opening entries are what the ring paints first: taking a round at a time spends every template before showing a second page of any of them, where a flat shuffle over four hundred odd slides would regularly seat three pages of the same deck side by side — which reads far worse on a crowded ring than on a sparse one. The ring holds more plates than the catalog holds templates, so a repeat is unavoidable, but not before every template is on it.
- Seventy-two is a surplus over the thirty the ring carries, which is what a plate is refilled from as it passes behind the orb. Bounding the draw bounds what the page downloads: one pass through the pool takes several minutes, after which every image is already in the browser cache and the ring costs nothing to keep turning.
- The draw is made once per mount, so the ring differs between visits and no single template becomes the page's face. The random source is injectable, which is how the tests pin a draw.
- If the catalog holds fewer slides than asked for, the pool is simply shorter and the ring cycles it sooner.
- A slide preview that will not load falls back to its template's cover, and a queued slide that will not load is dropped from the pool. A template published before slide previews existed therefore contributes its cover and nothing else, and were previews ever unpublished wholesale the page would degrade to the all-covers ring it used to be rather than showing holes.

## Files

- `apps/web/src/routes/landing/LandingPage.tsx` — full-viewport page shell.
- `apps/web/src/routes/landing/SlideRingHero.tsx` — ring geometry, orbit, drag, slide recycling, and preview interactions.
- `apps/web/src/routes/landing/WordmarkOrb.tsx` — the WebGL black-hole stage, star layer, and CSS fallback.
- `apps/web/src/routes/landing/wordmark-orb-shaders.ts` — the black liquid surface and reflection GLSL programs.
- `apps/web/src/routes/landing/landing-plates.ts` — the slide pool and its randomiser.
- `libs/ui/lib/template-thumbnails.ts` — the cover and slide-preview URL builders.
- `libs/ui/lib/catalog.ts` — marketplace items, including the published digest, slide count, and `presentableSlideCount`.
- `apps/web/src/app/router/EntranceRoute.tsx` — auth- and preference-aware index route.
- `libs/ui/components/Settings/LandingPreference.tsx` — the default-page picker, including the landing option.
- `apps/web/src/app/Header.tsx` — app header; its icon links to `/landing`.
- `apps/web/src/test/routes/landing/LandingPage.test.tsx` — render, route, and plate tests.
- `apps/web/src/test/routes/landing/WordmarkOrb.test.tsx` — orb labelling, canvas layering, and fallback tests.

## Clicking through the horizon

Clicking the black hole expands its silhouette to cover the viewport, fades its reflections and lettering, and blends into the exact shared page-background gradient. The cover persists across navigation and page loading; it never swaps to an orb loader.

- New signed-out visitors go to Sign Up. A browser that has previously held a successful session goes to Sign In. This uses only the local `slidesage-signed-in-before` boolean, never stored credentials or account details; clearing browser storage resets this hint.
- Signed-in visitors go to their Generate or Presentations default. Choosing Landing as the default sends this click to Generate.
- Lazy destination code warms during expansion. Auth forms and Generate report readiness after mounting; Presentations waits for its initial data request to succeed or fail, so an error can be revealed instead of trapping the user behind the cover.
- After readiness and font loading, the header, title, form groups, and app sections appear in a short stagger. Controls stay inert until the reveal ends, then keyboard focus moves to the destination heading or main region. Reduced motion uses a brief fade without stagger or movement.
- If a request stalls, the cover offers a direct-page recovery link after twelve seconds. Ordinary navigation outside this landing interaction keeps its existing loading behavior.

The coordinator lives in `apps/web/src/app/transitions/HorizonTransition.tsx`, above the route outlet. Destination pages use `useHorizonPageReady` to signal when their initial content is ready.

Transition refinements: pointer clicks are accepted only inside the visible horizon (with a six-pixel allowance), while Enter retains keyboard activation. Browser history changes cancel the cover and invalidate late animation completions. Cover sizing allows for window growth, and reduced motion uses a full-screen fade rather than a rapid spatial expansion. Destination elements use a lighter blur, shorter travel, and a stagger that starts just after the cover begins fading.
