# Landing Page

The landing page is the public entry point at `/` for visitors without a session. It is a single full-viewport hero: rendered template slides orbiting the SlideSage wordmark on the app's signature deep navy. There is no header, copy, or footer — the ring is the page.

## Route Behaviour

- The index route renders `EntranceRoute` (`apps/web/src/app/router/EntranceRoute.tsx`).
- Anonymous visitors see the landing page instead of being redirected straight to sign-in.
- Signed-in visitors go wherever their default-page setting points. `generate` and `presentations` forward through `HomePage` as before; `landing` keeps them on the landing page.
- `/landing` renders the landing page for everyone, signed in or not. The app header's SlideSage icon links there (`ROUTES.landing`), so clicking the icon from anywhere in the app always reaches the landing page.
- All other guarded routes keep the existing `RequireSignedInLayout` redirect to sign-in with a `redirect_url`.

## Hero: Slide Ring

`SlideRingHero` (`apps/web/src/routes/landing/SlideRingHero.tsx`) is a DOM ring adapted from the ThreeUI Gallery Heading reference (matte variant, rising-diagonal axis):

- The background is the SlideSage signature navy (`#161b27`) with the app's soft top glow.
- The wordmark is a rotating smoke sphere (`WordmarkOrb`), adapted from the ThreeUI energy-orb reference: raw WebGL renders a procedural fbm smoke sphere with a fresnel rim, outer glow, and a Canvas 2D star layer, all recoloured to the SlideSage palette — deep navy `#04172f`, icon blue `#0d3762`, steel highlights. "SlideSage" is painted twice onto an offscreen canvas texture (Yellowtail script with the wordmark's halo fill and dark navy outline) and mapped onto the sphere through the rotating normal's spherical coordinates, so one wordmark rotates out of view exactly as the next rotates in — one per visible hemisphere. The sphere completes one revolution per 26 seconds, matching the ring.
- A particle warp radiates from behind the sphere, adapted from the ThreeUI Constellation Field particle-network reference: particles spawn on a disc at far z behind the orb and fly toward the viewer, drawn as hairline streaks from their previous projection to their current one in restrained steel-white and brand-blue hues. The streak layer sits directly under the sphere canvas on a full-bleed transparent canvas whose trails are kept crisp by erasing toward nothing each frame (`destination-out`), so they never smear over the hero gradient or clip at the sphere stage's edge.
- The orb paints its first frame synchronously so it is never blank on first paint, pauses when off-screen or when the tab is hidden, and honours `prefers-reduced-motion: reduce` by rendering one static frame. Without WebGL it falls back to the flat SVG wordmark the hero used before the orb.
- Thirty plates ride a tilted ellipse on a desktop-width screen. That is well past what the ellipse would hold end to end, so each plate is offset from its nominal place on the line — in and out of the ring's radius, above and below its plane, and off its evenly spaced slot — which turns the line into a belt with thickness. The offsets are seeded from the plate's ring position rather than drawn at random, so the belt is laid out identically on every frame and across a resize; a plate that jittered per frame would shake rather than orbit.
- The count steps down on narrower screens (eighteen under 1024px, ten under 640px). The ring's radius scales with the viewport while a plate stays the same fraction of it, so a crowd sized for the desktop belt would land on a phone as a cluster of specks. It is fixed at mount: the plate count is structural, and rebuilding the ring mid-resize would restart every plate's orbit.
- Plates behind the orb render at a lower z-index, plates in front above it, so orbiting plates pass over the sphere exactly as in the reference.
- A plate does not carry the same slide for the life of the page. As it passes the back of the ring it is refilled with the next slide from the pool, so the plate that comes back round the other side is showing something else. It fades to nothing over the last six percent of the orbit either side of that crossing and back up again, and the refill happens at the bottom of the dip. The orb used to do that hiding on its own, but the belt's spread means a plate now crosses the back clear of the orb's silhouette as often as behind it; a plate is already at its smallest and faintest there, so dimming the last of the way reads as distance rather than as a plate disappearing. A reduced-motion visitor gets a single static frame with no dip, since a plate parked at the crossing would otherwise be missing from the ring for good. The outgoing slide returns to the end of the queue, so the pool cycles rather than running dry, and its second time round costs no bytes.
- Slides are fetched four ahead of the plate that will show them, and a plate whose turn comes with nothing decoded yet keeps the slide it has and takes the next pass instead. That is what keeps a swap from ever showing a half-loaded image, and it means a slow connection simply recycles less often rather than flickering. Preloading waits on `decode()` rather than the load event: a loaded image is downloaded, not yet rasterised, and handing one to a plate leaves the decode to happen on the frame it first paints, which is the hitch the preloading exists to avoid.
- Plate images are fetched eagerly. A plate is never at rest — it orbits through the viewport whether or not it started there — so `loading="lazy"` guarantees it pops in mid-flight. The full ring is around a megabyte at roughly 42KB a slide.
- A plate's body — slide, hairline ring and drop shadow together — starts at zero opacity and fades up over 420ms once its slide can paint, so plates arrive rather than pop. The body rather than the image alone, because fading only the image would leave an empty outlined box orbiting until the slide landed. This is a CSS transition on an element nested inside the one the frame loop writes to, so the two opacities multiply and the reveal does not depend on the loop running. A plate whose slide and cover both fail stays hidden rather than parading an empty box.
- The reveal is also triggered on mount, not just from the load event. A cached image is already complete before React can attach a handler and `load` does not bubble, so on a warm cache the load handler never fires — without the mount check the entire ring sits at zero and is simply not there.
- The ring is in constant orbit — one revolution every 26 seconds — irrespective of the cursor or anything else. Dragging horizontally spins it directly in proportion to the drag's length — dragging right pushes the front plates right, like grabbing the ring — and on release the constant orbit resumes from where the drag left it, with no flick or momentum. A drag under six pixels counts as a click instead.
- Clicking a plate opens a hovering preview: the same slide at 68 percent of the hero's width over a blurred backdrop, captioned with the template name and the slide's position in the deck. The dialog holds its own copy of the slide, so the ring may recycle the plate it was opened from without the preview changing under the reader. Clicking anywhere outside it or pressing Escape dismisses it, while the ring keeps turning behind it.
- The sphere is the page's call to action: it is a link to `/sign-up` (keyboard focusable, pointer cursor), and the no-WebGL fallback wordmark links there too. Ring drags that pass over the sphere never fire the navigation — pointer travel across the link is tracked and past six pixels the click is suppressed, matching the plates' tap-versus-drag slop.
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
- `apps/web/src/routes/landing/WordmarkOrb.tsx` — the rotating wordmark sphere (WebGL orb, star layer, SVG fallback).
- `apps/web/src/routes/landing/wordmark-orb-shaders.ts` — the orb's GLSL programs.
- `apps/web/src/routes/landing/landing-plates.ts` — the slide pool and its randomiser.
- `libs/ui/lib/template-thumbnails.ts` — the cover and slide-preview URL builders.
- `libs/ui/lib/catalog.ts` — marketplace items, including the published digest, slide count, and `presentableSlideCount`.
- `apps/web/src/app/router/EntranceRoute.tsx` — auth- and preference-aware index route.
- `libs/ui/components/Settings/LandingPreference.tsx` — the default-page picker, including the landing option.
- `apps/web/src/app/Header.tsx` — app header; its icon links to `/landing`.
- `apps/web/src/test/routes/landing/LandingPage.test.tsx` — render, route, and plate tests.
- `apps/web/src/test/routes/landing/WordmarkOrb.test.tsx` — orb labelling, canvas layering, and fallback tests.
