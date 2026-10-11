# Prefetching

- The web app loads a page's code and opening data once the user looks about to open it, so most pages render without a loading state.
- The API answers JSON with `Cache-Control: private, no-store`, so the browser cache cannot hold prefetched data. React Router's `<Link prefetch>` only works in framework mode and does nothing under `createBrowserRouter`. Prefetched data lives in a small in-memory cache instead.

## Intent

`usePrefetchIntent` in `@slidesage/ui/hooks/usePrefetchIntent` returns handlers to spread onto the target.

| Signal | When it prefetches |
| --- | --- |
| Mouse | After resting on the target for 100ms. Leaving earlier cancels it. |
| Touch or pen | At once, on `pointerdown`. |
| Keyboard | At once, on focus. |

- `withPrefetchIntent(props, intent)` merges the handlers with ones the target already has, such as those a Radix `asChild` parent passes.
- `PrefetchLink` in `apps/web/src/app/PrefetchLink.tsx` is a `Link` that prefetches its destination. It and the header use `useRoutePrefetch`, which skips the page already open.
- `DeckViewer` takes `onBackPrefetch` for its Back button.
- Data is read only for a signed-in user. Code is fetched for anyone.

## Cache

`@slidesage/ui/lib/prefetch` keeps one promise per key.

| Function | Use |
| --- | --- |
| `prefetch(key, load)` | Start a load or join one under way, and keep it for 20 seconds. |
| `takePrefetched(key, load)` | Read for a page. Joins a kept load or starts one, then forgets it once it settles. |
| `evictPrefetched(prefix)` | Forget every key under a prefix. |

- A page takes a prefetched answer once. The next visit loads current data, so the cache needs few invalidation rules.
- Callers that arrive while a load is still running share it. React StrictMode's second effect run therefore reuses the first one's request.
- A rejected load is forgotten at once, so the page tries again.
- Signing out clears the cache, so one account never reads another's prefetched data.

## What is prefetched

| Trigger | Code | Data |
| --- | --- | --- |
| Library card | Presentation page | Detail; the saved document when the deck is ready |
| Header: Presentations | Library | First page of `/presentations` |
| Header: Generate, Marketplace | That page | None |
| Account menu: Profile | Eagerly loaded | `/profile` |
| Account menu: Settings | Eagerly loaded | `/ai/config` |
| Points button | Purchase page | `/billing/balance` |
| Generation indicator | Presentation page or library | None: a generating deck streams its own progress |
| Deck viewer Back | Library, marketplace, or landing page | First page of `/presentations` when going back to the library |
| Landing orb | Its destination | As its destination's row above |
| Marketplace card, Open marketplace link | Preview page, marketplace | None: templates are bundled |

- Pages reached only after an action (outline, research, generation submit), share links, and requests that are not GETs are never prefetched.
- Route code is imported through `routeModules` in `apps/web/src/app/router/route-modules.ts`, so the router and a prefetch load the same chunk. `ROUTE_PREFETCHES` in `apps/web/src/app/prefetch.ts` maps a path to its code and data.

## Presentations

- `presentation-data.ts` holds the detail, document, and library reads that the grid, the presentation page, and the prefetches share.
- A grid click reads the detail through `prefetchPresentationDetail`, which joins the hover's request and keeps the answer for the presentation page.
- The presentation page uses the cache on its first load of a deck only. Reloads after a generation, an AI revision, or `onReload` always ask the server, as does any load after the page has seen the deck generating.
- A deck's entries are evicted when it is deleted, when `PRESENTATIONS_UPDATED_EVENT` reports it changed, when the open is refused, and when the click goes to a retry page instead.

## Failed chunks after a deploy

- `installPreloadErrorRecovery` reloads the page when a code chunk fails to load.
- A hover can fetch a chunk that a deploy removed. The handler ignores failures while a module prefetch is pending and no navigation is under way, so a hover never reloads the page.
- The click that follows imports the module again. That failure happens during a navigation, and recovery reloads the page then.
