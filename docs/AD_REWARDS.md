# Ad rewards

Signed-in users with a verified email can watch an optional rewarded video ad on the purchase page and receive a small number of points. The feature ships disabled (`AD_REWARDS_ENABLED=false`). This document records the economics, the trust model, and how it is built.

## Open prerequisites

These block turning the feature on, not deploying it.

1. **Ad account type.** On the web, rewarded inventory is served through Google Ad Manager GPT with an out-of-page rewarded slot. AdSense Offerwall is a content gate that a visitor clears by watching an ad, so it cannot grant in-app currency. Confirm that an Ad Manager account, or an MCM partner offering web rewarded demand, is available.
2. **Policy fit.** Confirm that Google's rewarded-inventory policies allow granting virtual points that can also be bought. Rewards must be opt-in and must not be cash or a cash equivalent. Points are neither withdrawable nor transferable, but have this checked against the current policy text before applying.
3. **Consent.** Google requires a certified CMP for EEA, UK and Swiss traffic. Choose either a CMP or non-personalized ads only (`setPrivacySettings({ nonPersonalizedAds: true })`) for those regions.

## Trust model

Web rewarded ads have **no server-side verification**. AdMob's signed SSV callback exists only for apps. The GPT `rewardedSlotGranted` event fires only in the browser, so a script can call the claim endpoint without ever watching an ad. The design therefore assumes some claims are forged and keeps them cheap:

- The server issues a single-use ad session before the ad is shown. A claim names that session.
- The server rejects a claim that arrives sooner than the minimum watch time after issue, or after the session expires.
- Each session credits at most once. This is enforced by a unique ledger key, using the same pattern as `UNIQUE (payment_id, entry_type)`.
- Only users with `email_verified = true` and an account at least 24 hours old can earn.
- Hard per-user daily and monthly caps are checked inside the crediting transaction, under the existing `users` row lock.
- A per-IP limit through `api_rate_limits` slows multi-account farming from one host.

Worst case is a forged claim on every capped slot. At the recommended caps that is 60 points per verified account per month (see below), which is acceptable as long as the points are cheap to serve.

## Economics

### What a point is worth and what it buys

| Fact | Value | Source |
| --- | --- | --- |
| Sale price of a point | Rs 2.00 (Starter 25 for Rs 50, custom 200 paise/pt), Rs 1.80 (Pro), Rs 1.60 (Premium) | `billing/razorpay.go` `ResolvePackPrice` |
| Provider tokens per point | 1,000 (`actualCharge` bills one millipoint per token) | `generation/billing.go` |
| Signup credit | 10 points, email and OAuth alike | `signupPoints` in `internal/auth/repository.go` |
| Research fee | 1 point flat | `presentation/research_accounting.go` |

The **reservation**, not the settled charge, decides whether a generation can start. That makes it the number to size rewards against. Computed from `outlineAuthorizationMillis` and `cardAuthorizationMillis` with a 40-character topic and no research:

| Slides | Outline reserve | Deck reserve | Balance needed |
| --- | --- | --- | --- |
| 5 | 3.8 | 11.2 | about 15 |
| 8 | 4.3 | 16.0 | about 20 |
| 10 | 4.6 | 21.1 | about 26 |
| 15 | 5.4 | 31.7 | about 37 |

The settled charge is usually lower and the difference is refunded, but the user must still hold the full reservation up front.

### Revenue per view

Published rewarded eCPMs are app (mostly game) figures. Web rewarded fill and pricing are lower, so treat them as an upper bound. The audience is India-weighted (INR checkout). At Rs 85 per USD and after fill:

| Scenario | Effective net eCPM | Revenue per completed view |
| --- | --- | --- |
| Conservative | $0.50 | Rs 0.04 |
| Base | $2.00 | Rs 0.17 |
| Optimistic | $4.00 | Rs 0.34 |

Replace these with Ad Manager reporting after the first two weeks.

### Cost per point

Points pay only for the server-owned `OPEN_ROUTER_MODEL`. BYOK generations quote zero.

| Platform model | Blended price | Cost per point |
| --- | --- | --- |
| Current default `nemotron-3-super-120b-a12b:free` | $0 | Rs 0. The model is rate-limited, so ad-funded decks consume shared free capacity. |
| Cheap paid, about $0.10 in / $0.40 out per 1M | about $0.25/1M | Rs 0.02 |
| Mid-tier, about $1 in / $4 out per 1M | about $2.50/1M | Rs 0.21 |

Research is the exception. The 1-point fee covers a real Exa call, which costs more than an ad view earns at conservative eCPM. Check the Exa plan's per-search price. The cap below bounds the loss.

### Break-even

Break-even points per view = revenue per view / cost per point.

| Model \ eCPM | Conservative | Base | Optimistic |
| --- | --- | --- | --- |
| Free | unbounded | unbounded | unbounded |
| Cheap paid | 2 | 8 | 17 |
| Mid-tier | 0.2 | 0.8 | 1.6 |

### Recommendation

- **2 points per completed view.** This stays profitable at the base case on any model up to cheap paid, and at the conservative case on the free model. Move to a mid-tier platform model only together with a lower reward.
- **At most 5 views per day** (10 points per day), with a **60-second cooldown** between views.
- **At most 60 points per calendar month.** That is two to three short decks a month for someone who keeps watching. It cannot replace buying: Starter delivers 25 points instantly for Rs 50, while the same 25 points through ads take 13 views over three days.
- **Minimum watch time 15 seconds** from session issue to claim. **Sessions expire after 10 minutes.**
- **Monthly exposure per user at the cap:** 30 views earn about Rs 5 at base eCPM. Serving them costs about Rs 0 on the free model, Rs 1.2 on cheap paid, or up to Rs 26 if every point goes to research at about Rs 0.43 per Exa call. That research worst case is the main reason for the monthly cap.

Every value above is server configuration, so it can be tuned from real fill and eCPM data without a deploy.

### Related finding

A new account starts with 10 points, below the roughly 15 needed for even a 5-slide deck. Ad rewards make that recoverable: 10 signup points plus 5 views reaches 20, enough for an 8-slide deck. The 24-hour minimum account age means a brand-new user waits a day before their first ad, so decide whether that onboarding gap is intended.

## Data model

Migration `00041_ad_rewards.sql` adds:

- `ad_reward_sessions`: one row per ad view, `issued`, then `claimed` or `expired`, with `reward_millis`, `issued_at`, `expires_at` and `claimed_at`. A partial unique index allows each user one `issued` session; issuing a new one expires the old.
- `point_ledger.ad_reward_session_id`, with `UNIQUE (ad_reward_session_id, entry_type)`, so a session can credit points once at the database level.
- `ad_reward` in the `entry_type` check, and `point_ledger_source_present` accepting an ad reward session as the source.

## API

The `internal/rewards` package owns the routes. Time comes from the database clock so caps and watch times agree across API instances.

| Route | Behavior |
| --- | --- |
| `GET /rewards/ads` | `{ enabled: false }` when off. Otherwise `ad_unit`, `eligible`, `reason`, `points_per_view`, `views_left_today`, `points_left_this_month`, `next_available_at` and `min_watch_seconds`. |
| `POST /rewards/ads/sessions` | Checks eligibility, caps and cooldown under the `users` row lock, then returns `{ session_id, claimable_at, expires_at }`. |
| `POST /rewards/ads/sessions/:id/claim` | Locks the `users` row, requires the session to be the caller's, `issued`, unexpired and past `claimable_at`, re-checks eligibility and caps, then marks it `claimed`, credits `balance_millis` and writes an `ad_reward` ledger row. A repeated claim returns the original award. |

| Status | Code | Meaning |
| --- | --- | --- |
| `403` | `AD_REWARD_INELIGIBLE` | Email not verified, or account younger than the minimum age |
| `429` | `AD_REWARD_LIMITED` | Daily cap, monthly cap or cooldown; `Retry-After` gives the wait |
| `409` | `AD_REWARD_TOO_EARLY` | Claimed before `claimable_at`; the session stays claimable |
| `410` | `AD_REWARD_SESSION_EXPIRED` | Expired, or retired because a cap was reached while the ad played |
| `404` | `AD_REWARD_SESSION_NOT_FOUND` or `AD_REWARDS_UNAVAILABLE` | Unknown session, or the feature is off |

When the monthly allowance left is smaller than a full view's reward, the view earns the remainder.

Rate limits are listed in [Rate limiting](RATE_LIMITING.md). Session creation is limited per user and per client IP, which slows one host farming many accounts. Configuration is listed in [Environment variables](ENVIRONMENT_VARIABLES.md#ad-rewards).

Telemetry: `rewards.ad.sessions` and `rewards.ad.claims` count outcomes by an `outcome` attribute (`issued`, `credited`, `too_early`, `expired`, or a denial reason). A high `too_early` share means claims are being forged.

## Web

- The ad unit path comes from `GET /rewards/ads`, so the web build needs no ad configuration and the section is hidden whenever the API reports the feature off.
- `routes/billing/rewarded-ad.ts` loads GPT (`securepubads.g.doubleclick.net/tag/js/gpt.js`) only when the user presses "Watch ad". It defines a `REWARDED` out-of-page slot, creates the server session on `rewardedSlotReady` before calling `makeRewardedVisible()`, records `rewardedSlotGranted`, and destroys the slot on `rewardedSlotClosed`. No fill within 8 seconds, an unsupported browser or a blocked script reports "No ad is available right now" without creating a session.
- `routes/billing/EarnPointsSection.tsx` sits under the balance on the purchase page. After a granted ad it waits out `min_watch_seconds` from when the session arrived, so device clock skew cannot cause an early claim, retries once if the server still answers `AD_REWARD_TOO_EARLY`, and publishes the new balance. It shows views and points left, or the reason the user cannot earn, and refreshes when a short cooldown ends.
- Insufficient-points errors on the outline page offer a "Get points" action that opens the purchase page.
- `apps/web/public/ads.txt` declares the AdSense publisher. Add the line Ad Manager gives you, if its publisher ID differs.
- If a CSP is added later, it must allow the GPT and DoubleClick origins. None is set today.

## Rust port

`rust-backend-migration` carries a compatibility gate over the Go routes. The three routes landed in Go on `dev`. Port them, and add them to the gate, once the port's current route batch merges.

## Rollout

1. Settle the open prerequisites and create the Ad Manager rewarded ad unit.
2. Deploy with `AD_REWARDS_ENABLED=false`, then set `AD_REWARD_GPT_AD_UNIT` and enable it.
3. After 14 days, compare fill, eCPM and the `too_early` share against the economics above, and retune the `AD_REWARD_*` defaults.
