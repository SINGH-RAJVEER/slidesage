# Card documents

- A presentation is an ordered set of editable cards stored as an immutable JSONB revision.
- The browser renders that revision directly. [Card architecture](CARD_ARCHITECTURE.md) records remaining work.

## Schema

- `libs/cards`, published internally as `@slidesage/cards`, owns schema version 3. Converter and browser use the same validation.
- Versions 1 and 2 upgrade on read; saves write version 3.
- Documents contain `schemaVersion`, `title`, `theme`, `cardOrder`, and `cards` keyed by ID.
- Cards contain `takeaway`, `role`, `layout`, `nodes`, `sourceIds`, and optional `notes`.
- Nodes are `heading`, `paragraph`, `bullets`, `quote`, `stat`, `steps`, `columns`, `image`, `chart`, `progress`, `table`, and `callout`.
- Rich text permits bold and italic runs, without links. Image nodes reference asset SHA-256 IDs and alt text, never URLs.
- Cards, nodes, list items, chart series, meters, and table rows have stable IDs.
- Layouts are `title`, `statement`, `bullets`, `comparison`, `process`, `quote`, `stats`, `image-left`, `image-right`, `cover`, `chart`, `table`, and `dashboard`.
- `LAYOUT_RULES` defines allowed and required nodes, item counts, photo support, and widget capacity.
- Themes are `slate`, `paper`, `ember`, `ocean`, `grove`, `orchid`, `sand`, `cobalt`, and `mono`. `themes.ts` owns their colors, fonts, and chart palettes; documents carry no styling.
- `LIMITS` bounds documents to 1 to 40 cards and caps all text and widget fields.
- Validation rejects unknown fields/types, duplicate IDs, oversized text, incompatible layouts, and assets outside `knownAssets`. Errors include a field path and message.

## Converter

- `apps/converter` is a private Bun HTTP service. Conversion requests send `X-Card-Schema-Version: 3`; mismatches return `409`.
- Conversion, assembly, and validation receive owned `assetIds`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness and schema version |
| `GET` | `/v1/schema` | Rules, limits, roles, themes, draft shapes, widget guide |
| `POST` | `/v1/templates` | Return a curated document and assets by `templateId` |
| `POST` | `/v1/cards` | Convert cards independently into valid cards or issues |
| `POST` | `/v1/documents` | Assemble and validate; invalid documents return `422` |
| `POST` | `/v1/documents/validate` | Validate edits |
| `POST` | `/v1/documents/drafts` | Return drafts keyed by card ID for AI revision |
| `POST` | `/v1/documents/pptx` | Export editable PowerPoint |

- Conversion strips HTML formatting tags, control/zero-width characters, and bidirectional overrides, while preserving literal comparisons such as `a<b`.
- Markdown bold and italic become rich-text runs. Operation ID and card position produce repeatable IDs.
- Numeric strings such as `"1,200"` become chart values; values with units such as `"4%"` are rejected.
- Run `just converter` locally or `just converter-bundle` for the image bundle. Default address is `127.0.0.1:8090`.
- Production sidecars have no public ingress. Go services use `CARD_CONVERTER_URL=http://127.0.0.1:8090`.

## Generation

`cardDrafter` in `apps/api/internal/generation/cards.go`:

1. Plans a title and exactly one entry per requested card, including takeaway, role, layout, evidence, sources, and optional photo search. Invalid plans receive up to two repairs. Approved outlines skip planning.
2. Resolves photos for at most `min(6, max(2, (count+1)/2))` cards. Extra photo cards and empty searches fall back to text layouts.
3. Drafts batches of four with the complete plan and completed takeaways.
4. Converts cards as they arrive and emits each valid card with its photo. Missing or invalid cards receive up to two targeted repairs after the batch. OpenRouter streams; BYOK batches arrive together.
5. Assembles and checks the final count.
6. Commits assets, JSONB revision, current-revision pointer, and point settlement in one transaction.

- Data-card plans must cite figures in their evidence. Drafting preserves those figures.
- Provenance records provider, model, prompt version `cards-v2`, plan version, and source IDs.
- Converter network errors and `5xx` are temporary; `4xx` fail the job.
- Submission requires `CARD_CONVERTER_URL`, otherwise `503` occurs before reserving points.
- Text-only generation and document reads need no GCS bucket; stored image bytes do.

## Widgets

Every widget has size `small`, `medium`, `large`, or `full`:

| Node | Data and limits |
| --- | --- |
| `chart` | 2 to 12 unique categories, 1 to 4 named series, one finite value per category; optional prefix, suffix, caption |
| `progress` | 1 to 6 labeled meters, percentages 0 to 100 |
| `table` | 2 to 5 columns, 1 to 8 rows with matching cell counts; empty cells allowed |
| `callout` | Rich text and `note`, `positive`, or `caution` tone, identified by icon |

- Chart kinds are `column`, `bar`, `stacked-column`, `line`, `area`, `pie`, and `donut`.
- Pie/donut require one series with 2 to 6 non-negative values; stacked columns require at least two series. `chartKindMismatch` checks suitability.
- Chart/table cards hold a heading, their required widget, and optional supported text. Beside text, sizes occupy one-third, one-half, or two-thirds width; `full` places the widget above text. Without text, it fills the card.
- Dashboard cards hold 2 to 4 widgets. `widgetRows` packs spans 4, 6, 8, and 12 into at most two twelve-column rows. Three large widgets are invalid.
- Browser and PPTX share geometry from `libs/cards/src/widgets.ts`.
- Unsized chart/table widgets default to `large` beside text or `full` alone; other widgets default to `medium`.
- Themes expose six ordered series colors and positive/caution colors through `--card-series-1` to `--card-series-6`, `--card-positive`, and `--card-caution`.
- Browser charts use SVG, multi-series legends, value labels, hover titles, and a hidden data table. Some light-theme colors fall below 3:1 contrast, so labels and accessible data remain required.
- AI revisions retain figures unless the instruction supplies replacements.

## AI revisions

- Submit `parent_presentation_id`, instruction in `topic`, `base_revision`, and optional `card_ids` to `/presentation-jobs`. Omitted IDs target every card.
- Revisions never add, remove, or reorder cards. A stale base returns `409` before reservation.
- Worker loads base drafts and rewrites batches of four with the instruction, outline, sources, and current content.
- Rewritten cards pass normal conversion and repair, retain their card IDs, and preserve photos when the layout supports them. Untargeted cards remain unchanged.
- The final document commits as `ai_revision` against the base. Concurrent changes fail the job and refund points.
- Provenance records model, instruction, and target IDs. Title, sources, and original prompt remain.
- Browser Iterate targets all slides or the current slide. Pending edits save first; the deck stays visible and read-only until the new revision loads.

## Outline

- `/presentation-outlines` accepts generation fields plus a client `outline_id`, returning `plan`, photo availability, charged points, and remaining points.
- Planning has its own `outline` reservation/settlement; repeated IDs return `409`.
- Users can edit, reorder, add, or remove entries and change layouts or photo searches.
- The browser keeps the latest unfinished outline and its request settings per account. Returning or refreshing restores edits and photo availability without another planning charge. Starting a new outline replaces this draft; an accepted generation clears it.
- Submit the approved `plan` to `/presentation-jobs` with `slide_count` matching its length. Submission and worker validate it; drafting follows its order.

## Photos

- Unsplash is the only stock-search provider. Results and rendered cards link the photographer and library with attribution.
- New stock photos remain hotlinked. The API resolves photo IDs, records download tracking, and skips a photo when tracking fails.
- `card_assets.remote_url` uses `images.unsplash.com` sizing for JPEGs up to 2400px wide. IDs hash `unsplash:<photo ID>`.
- Browser and share views load the remote URL; asset routes redirect. PPTX downloads the photo into the file without retaining a copy.
- Upload limits are 15 MB, 50 megapixels, and 12000px per side; costly formats may be rejected below those limits.
- Decoding has a 192 MB per-process budget, with at most four uploads read concurrently. Images exceeding the decode budget are rejected.
- Stored images normalize to at most 2400px width, then JPEG or transparent PNG. GCS keys are `presentations/{id}/assets/{sha256}`; metadata includes MIME, dimensions, size, and source.
- Remote downloads allow only approved hosts and redirects. Historical Pexels assets and credits remain readable.
- `STOCK_LIBRARIES` shares attribution metadata between browser and converter.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/images/search?q=&provider=` | Search Unsplash; provider defaults to Unsplash |
| `POST` | `/presentations/{id}/assets/stock` | Add a photo by `provider` and `photoId` |
| `POST` | `/presentations/{id}/assets/upload` | Upload multipart `file` |
| `GET` | `/presentations/{id}/assets/{sha256}` | Serve owned stored image or redirect to hotlink |

- Without `UNSPLASH_ACCESS_KEY`, stock routes return `503` and generation uses text layouts. Uploads remain available.
- Production stock photos are disabled by default. Enable them through [Production bootstrap](PRODUCTION_INFRASTRUCTURE.md#bootstrap).
- AI image generation remains disabled until priced.

## Storage

- `card_revisions` stores required immutable JSONB bodies, digest, size, count, schema version, author, operation/base IDs, and provenance. A trigger rejects updates.
- Writes use expected-revision compare-and-swap; repeated operation IDs return the first result. All referenced assets must belong to the presentation at commit.
- Document reads return revision metadata, body, and referenced assets together, with no GCS fallback.
- Digest and size describe submitted compact JSON or verified imported GCS bytes. Never compare them with JSONB's reserialized bytes.
- Deleting a user removes presentations and revisions; image bytes remain in GCS.
- Migration 33 imported bodies into JSONB. Migration 35 deletes decks without complete card bodies, removes legacy object keys and pgvector tables, and cannot downgrade. Unlinked point operations remain as billing history.
- After migrations, `cmd/migrate` deletes legacy `presentations/<id>/objects/`, `revisions/`, and `cards/` keys, keeping `assets/`. Sweep failure is logged without failing migrations; reruns remove remaining objects.
- Verify GCS soft-delete retention with `gcloud storage buckets describe` before sweeping. Database deletions require the pre-migration backup for recovery.

## Editing

- `PUT /presentations/{id}/document` accepts `{baseRevision, operationId, document}` for a ready deck, validates owned assets, and saves a new revision and title.
- Stale bases return `409` with `currentRevision`; repeated operation IDs return the original result.
- Schema or JSONB-incompatible content returns `422` before commit.
- `libs/cards/src/edit.ts` owns pure edits for text, fields, lists, layouts, order, duplication, insertion, deletion, photos, and widgets. Invalid layout/widget changes leave the document unchanged.
- Text supports bold and italic. Undo coalesces keystrokes within 800 ms; autosave waits 1.2 seconds after the last change.
- Lost save responses retry the same operation before newer saves. The deck stays unsaved until confirmation, even if edits were undone.
- Conflicts stop autosave and offer reload. Navigation saves pending edits first; dropping unsavable edits requires confirmation. Closing an unsaved tab requests browser confirmation.
- Edit activates the centered slide and header controls for title, theme, undo, and redo. The toolbar offers compatible layouts, widget insertion, AI revision, photos, movement, duplication, and insertion.
- Widget controls edit chart data/kind, meter values, table cells, tone, size, and removal where valid. Chart data passes schema checks before saving.
- Deleting the displayed slide takes one click and autosaves the deck without it. An Undo action on the floating notice puts the card back at its position for a few seconds.

## Sharing

- Owners create one read-only link per deck. Tokens contain 256 random bits; `presentation_shares` stores only the SHA-256 digest.
- Creating a new link revokes the previous one. Tokens are returned only at creation.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/presentations/{id}/share` | Report active link status |
| `POST` | `/presentations/{id}/share` | Create or replace link |
| `DELETE` | `/presentations/{id}/share` | Revoke link |
| `GET` | `/shared/{token}` | Public current document, photos, citation titles/URLs |
| `GET` | `/shared/{token}/assets/{sha256}` | Serve only currently referenced photos |

- Shared routes serve ready decks without sign-in and exclude provenance, author, and prompt.
- Views use the latest saved revision. Malformed, unknown, or revoked tokens return `404`.
- Previously loaded photos may remain in a viewer's private browser cache after revocation.
- Share opens `/s/:token` in the read-only viewer with Present mode.

## PPTX export

- Owner `GET /presentations/{id}/export/pptx` exports the current saved revision.
- API sends document, sources, and up to 64 MiB of referenced images to `/v1/documents/pptx`; converter body limit is 96 MiB for base64 encoding.
- Unsplash images download and normalize for that export. Unavailable photos return `502`.
- `apps/converter/src/pptx.ts` uses pptxgenjs to write one 13.333 × 7.5 inch slide per card.
- Text, lists, comparison/process content, pictures, charts with editable data, tables, meters, and callouts use native PowerPoint objects.
- Image crops and widget geometry follow browser layouts. Theme translucency flattens onto the card surface; cover gradients use a PNG overlay.
- Citations hyperlink HTTP/HTTPS sources, photos retain linked credits, and notes become speaker notes. Donut totals are omitted.
- Text shrinks to half its designed size instead of splitting cards. Fit uses average glyph-width estimates; PowerPoint shrink-on-overflow activates after text editing.
- Download names use the title. Browser download is disabled during editing or unsaved changes.
- Exports are unrecorded and include creation time, so repeated downloads are not byte-identical. Fonts are referenced, never embedded.

## Browser

- `DeckViewer.tsx` at `/presentations/:presentationId` shows a carousel and synchronized thumbnails.
- During generation, drafted cards appear beside planned placeholders, and the viewer moves to each card as it arrives until the user picks a slide. Completion loads and validates the saved document.
- Failed decks open `/presentation-error`, which loads the deck and shows its saved `failure.message`. Initial load failures return to the library with a notice; later reload failures keep the current deck visible.
- Changing decks resets loading and editor state. Late responses from the previous deck are ignored.
- Cards stay 16:9 and scale in container units. `CardView` refits text and spacing down to half size on edits and resize; `data-text-scale` records shrinking.
- Content exceeding the minimum fit clips at the bottom. `CardSlide` letterboxes other viewport ratios.
- Present supports full screen and timed playback. Left/right or J/L move cards, up/down jump first/last, and N shows notes. Exiting full screen stops presenting.
- Generate and research pass through `/generate/outline`; accepted jobs open their deck. The library and generation indicator open the same viewer.
- Generate keeps the prompt, template selection, slide count, detail level, tone, research toggle, and result count in browser storage per account. Leaving for another section or refreshing restores the setup. A new retry starts with that presentation's settings; its edited setup retains the retry ID and AI selection until generation is accepted.
- Presentation edits also have a browser recovery draft, including incomplete text and uncertain saves. Returning restores the draft and retries the same operation ID when a save response was lost. A newer server revision blocks autosaving until the user reloads the latest version. Reloading explicitly discards the recovery draft; successful saves clear it.
- Drafts use versioned local storage keys and stay on the same browser. Invalid stored data falls back to the page defaults. If browser storage is unavailable or full, the form remains usable but recovery is unavailable.
