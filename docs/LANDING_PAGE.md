# Landing page

- `/` shows anonymous visitors a full-viewport slide ring around a dark animated horizon.
- The page has no header or footer. The horizon opens the app; clicking a slide opens its preview.

## Route behaviour

- `EntranceRoute` chooses the index page from auth state and the default-page preference.
- Signed-in visitors go to Generate, Presentations, or Landing according to their preference.
- `/landing` is available to everyone. The app header's SlideSage icon links there.
- Other guarded routes redirect signed-out visitors to sign-in with `redirect_url`.
- The landing bundle loads separately. Browsers without sign-in history warm it alongside the session check.

## Hero: slide ring

- `SlideRingHero` projects DOM cards around a tilted ellipse on the navy `#161b27` background.
- Plate counts are fixed at mount: 24 on desktop, 18 below 1024px, and 10 below 640px.
- Seeded position offsets give the ring depth without frame-to-frame jitter. Projected depth controls stacking and brightness.
- Ambient orbit takes 26 seconds per revolution. Horizontal drag changes speed; release coasts back with exponential friction. Reverse throws brake or reverse the orbit.
- Movement under six pixels counts as a click. Larger drags suppress plate and horizon navigation.
- At the rear crossing, plates fade, take the next card from the queue, then return the outgoing card to its end.
- Previews keep their own card snapshot while the ring recycles. Click outside or press Escape to close.
- Reduced motion disables ambient orbit and recycling. Drag and resize still render directly.
- Animation pauses off-screen and in hidden tabs.

## Horizon interaction

- `WordmarkOrb` draws the dark WebGL surface, reflections, and background star field; CSS supplies the fallback.
- Cursor proximity grows the horizon from its resting size. Slides follow staggered paths into it, then the wordmark appears.
- Capture locks when the cursor enters the growing surface and releases outside the expanded boundary plus six pixels.
- Touch movement does not trigger hover capture. Reduced motion removes path bending, stretching, and surface deformation.
- The preserved wordmark asset is `apps/web/public/landing/slidesage-wordmark-current.png`.

## What the frame loop costs

- Compute plate offsets once. Reuse projection, repulsion, stacking, and style buffers.
- Compare squared distances for repulsion; take square roots only when needed.
- Write changed styles only and quantize brightness and opacity. Depth uses brightness without animated blur.
- Paint stars at 30fps at CSS resolution from cached sprites.
- Cap orb resolution at 1.5 times device pixels, disable multisampling, and use three noise octaves.
- Reduced motion runs no ambient frame loop.

## The plates

- `landing-plates.ts` draws cards from the six decks in `CARD_TEMPLATES` using the same `CardView` as the editor.
- Samples include template themes, photos, and attribution. See [Theme templates and marketplace](CARD_ARCHITECTURE.md#theme-templates-and-marketplace).
- Shuffle decks and their cards, then take one card per deck per round so the initial ring covers every deck.
- Shuffle once per mount. Tests inject the random source for repeatable draws.
- Memoized cards rerender only when their plate changes.

## Files

| File under `apps/web/src` | Responsibility |
| --- | --- |
| `routes/landing/LandingPage.tsx` | Page shell |
| `routes/landing/SlideRingHero.tsx` | Geometry, orbit, drag, recycling, previews |
| `routes/landing/WordmarkOrb.tsx` | WebGL horizon, stars, CSS fallback |
| `routes/landing/wordmark-orb-shaders.ts` | Surface and reflection shaders |
| `routes/landing/landing-plates.ts` | Sample pool and randomization |
| `app/router/EntranceRoute.tsx` | Auth-aware index route and bundle loading |
| `app/transitions/HorizonTransition.tsx` | Navigation cover and destination reveal |
| `app/Header.tsx` | Link to `/landing` |
| `test/routes/landing/LandingPage.test.tsx` | Page, routes, and plates |
| `test/routes/landing/WordmarkOrb.test.tsx` | Labeling, layering, fallback |

The default-page picker is `libs/ui/components/Settings/LandingPreference.tsx`.

## Clicking through the horizon

1. The horizon expands over the viewport and blends into the shared page background.
2. Destination code warms while the cover stays visible.
3. `useHorizonPageReady` signals readiness. Auth and Generate signal after mounting; Presentations waits for its initial request to settle.
4. After readiness and font loading, destination elements appear in a short stagger. Controls become active and focus moves to the heading or main region.

- New signed-out visitors go to Sign Up. Returning browsers go to Sign In using only the local `slidesage-signed-in-before` boolean.
- Signed-in visitors go to their Generate or Presentations default; Landing defaults open Generate.
- Pointer activation must fall within the visible horizon plus six pixels. Enter supports keyboard activation.
- Browser history changes cancel the cover and invalidate late animation completions.
- Reduced motion uses a short fade. Cover sizing allows window growth.
- A stalled destination offers a direct-page recovery link after 12 seconds.
- Ordinary navigation keeps its normal loading behavior.
