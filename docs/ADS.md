# Ads

- Signed-in readers with a balance below 250 points see AdSense ads. At 250 points or more there are none. The threshold is `AD_FREE_POINTS` in `@slidesage/types`.
- Eligibility follows the current balance. New accounts start at 10 points, so they see ads. Buying a Pro or larger pack removes them, and spending below 250 brings them back during the session, because the header balance updates live.
- Nothing shows until the session has loaded, so readers at 250 points or more never see an ad flash in.
- The AdSense script loads only when an eligible reader first renders a slot. It is not in `index.html`, so ad-free readers never load it.
- BYOK direct generation spends no points, so a reader who uses only their own key stays below 250 and keeps seeing ads.

## Placements

| Page | Desktop layout | Mobile layout |
| --- | --- | --- |
| `/generate` | Up to 728 x 90 below the prompt, at the bottom of the page | 320 x 50 anchored banner |
| `/presentations` | Up to 970 x 90 between the search bar and the grid | 320 x 50 anchored banner |
| `/marketplace` | Up to 970 x 90 as a full-width row after the first row of templates | 320 x 50 anchored banner |

- Each page shows one ad at a time: the inline unit on the desktop layout, or the anchored banner on the mobile layout. The two follow the app's shared breakpoint, so a phone held sideways gets the banner; see [Mobile UI](MOBILE_UI.md). Slots that are hidden at the current size are not rendered, so AdSense never fills a zero-width unit.
- The marketplace row follows the first two templates when the grid has two columns and the first three when it has three. A search that leaves no second row shows no ad.
- The anchored banner is fixed to the bottom of the screen through a portal, directly above the tab bar when one is showing, and leaves a spacer at the end of the page so the last item can scroll above it.
- Every slot that shows an ad carries a "Sponsored" label and a Remove ads link to `/purchase`.
- A slot stays invisible until AdSense marks it `data-ad-status="filled"`. While AdSense decides, the unit keeps its full size so AdSense requests the right ad, but it is transparent, out of the page layout, and inert. The anchored banner's bar and spacer also wait for the ad.
- A blocked script, an unfilled unit (`data-ad-status="unfilled"`), or no answer within 15 seconds removes the slot. A page without an ad looks the same as an ad-free page, with no label, gap, or reserved space.
- Shared decks (`/s/:token`), the deck viewer and editor, export, purchase, auth, landing, settings, and error pages never show display ads. The purchase page offers opt-in rewarded ads for points, which play only when the user asks; see [Ad rewards](AD_REWARDS.md).

## Code

| Piece | Location |
| --- | --- |
| Config, eligibility, script loader | `libs/ui/lib/ads.ts` |
| `useAdsEligible`, `useAdUnit` | `libs/ui/hooks/useAds.ts` |
| `AdSlot` | `libs/ui/components/AdSlot.tsx` |
| `InlineAd`, `AnchoredAd` | `apps/web/src/app/Ads.tsx` |
| `ads.txt` generation | `apps/web/vite.config.ts` |

## Configuration

| Variable | Purpose |
| --- | --- |
| `VITE_ADSENSE_CLIENT_ID` | AdSense publisher ID, `ca-pub-` followed by digits |
| `VITE_ADSENSE_SLOT_GENERATE` | Ad unit ID for `/generate` |
| `VITE_ADSENSE_SLOT_PRESENTATIONS` | Ad unit ID for `/presentations` |
| `VITE_ADSENSE_SLOT_MARKETPLACE` | Ad unit ID for `/marketplace` |
| `VITE_ADSENSE_SLOT_ANCHOR` | Ad unit ID for the mobile anchored banner |

- Without a valid publisher ID there are no ads anywhere, which is how development, tests, and preview builds run. A placement without a valid numeric unit ID stays empty.
- Create the units in AdSense as display units. The slots set their own width and height, so AdSense serves a size that fits.
- Production values are Cloudflare Pages build environment variables with the names above. Unset variables keep ads disabled. Changes take effect after rebuilding the Pages production deployment.
- A build with a publisher ID emits `ads.txt` with `google.com, pub-..., DIRECT, f08c47fec0942fa0`.

## Before turning ads on

- Every ad page requires sign-in. Add crawler login in AdSense so Google can see the pages it targets.
- Serve a Google-certified consent message to EEA, UK, and Swiss readers. AdSense Privacy & Messaging provides one without code changes.
- Publish a privacy policy that covers ad cookies before enabling the publisher ID.
