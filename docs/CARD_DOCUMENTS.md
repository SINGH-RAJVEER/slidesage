# Card documents

A generated presentation is a versioned card document: an ordered set of cards, each making one point, stored as an immutable JSON revision. The browser renders the saved revision directly. The design and its remaining work are in [GAMMA_ARCHITECTURE.md](GAMMA_ARCHITECTURE.md).

## Schema

`libs/cards` (`@slidesage/cards`) defines schema version 2 and is the single authority for it. The Bun converter uses it to validate model output, and the browser uses it to check every document it loads. Version 1 documents are still readable: they are upgraded on read, and saves write version 2.

- A document has `schemaVersion`, `title`, `theme`, `cardOrder`, and `cards` keyed by card ID.
- A card has a `takeaway`, a narrative `role`, a `layout`, content `nodes`, cited `sourceIds`, and optional `notes`.
- Node types are `heading`, `paragraph`, `bullets`, `quote`, `stat`, `steps`, `columns`, and `image`. An image node names a stored asset by its sha256 and carries alt text; it never carries a URL. Rich text is a list of runs with optional `bold` and `italic`; there are no links.
- Every card, node, and list item has a stable ID, so edits can address content directly.
- Layouts are `title`, `statement`, `bullets`, `comparison`, `process`, `quote`, `stats`, `image-left`, `image-right`, and `cover`. `LAYOUT_RULES` states which node types and how many items each layout accepts, which node types a layout requires one of, and whether it shows a photo. A card whose nodes do not fit its layout is invalid.
- Themes are `slate`, `paper`, and `ember`. A document names a theme; it can never carry styling.
- `LIMITS` bounds the card count (1 to 40) and every text field.

A document may only reference assets the caller says the presentation owns (`knownAssets`). Validation is strict: unknown fields, unknown node types, duplicate IDs, and text over its limit are rejected with a path and a message, for example `card.nodes[0].text: is 91 characters, the limit is 90`.

## Converter

`apps/converter` is a private Bun HTTP service. Every conversion request sends `X-Card-Schema-Version: 2`; a different version is refused with `409`.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/health` | Liveness and served schema version |
| `GET`  | `/v1/schema` | Layout rules, limits, roles, themes, and draft shapes that drafting prompts are built from |
| `POST` | `/v1/cards` | Converts drafted cards independently; each result is a card or an issue |
| `POST` | `/v1/documents` | Assembles converted cards into a validated document, or returns `422` with an issue |
| `POST` | `/v1/documents/validate` | Validates an edited document before it is saved |

Conversion, assembly, and validation take `assetIds`, the assets the presentation owns; an image node naming any other asset is an issue.

Conversion strips markup tags, control characters, zero-width characters, and bidirectional overrides, and parses `**bold**` and `*italic*` into runs. IDs are derived from the operation ID and card position, so repeating a conversion produces identical IDs.

Run it with `just converter`, or bundle it with `just converter-bundle` for the `converter` bake target. It listens on `127.0.0.1:8090` unless `CARD_CONVERTER_HOST` or `CARD_CONVERTER_PORT` say otherwise.

## Generation

The worker drafts through `cardDrafter` (`apps/api/internal/generation/cards.go`):

1. The planner returns a title and one plan entry per requested card: takeaway, role, layout, evidence, source IDs, and a photo search for photo layouts. The plan must have exactly the requested count, positions without gaps, known roles and layouts, and only supplied sources; otherwise the planner is asked again, up to twice. When the user approved an outline first (see [Outline](#outline)), the worker uses that plan and skips this step.
2. Photos are resolved for cards with photo layouts, up to `min(6, max(2, (count+1)/2))` per deck. Further photo cards, and cards whose search finds nothing, fall back to a text layout rather than failing the deck. A `plan` event reports the plan to the browser.
3. Cards are drafted in batches of four with the whole plan and the takeaways already written.
4. The converter validates each batch. An invalid or missing card is redrafted on its own against the reported issue, up to twice, and the rest of the batch is kept. Each finished batch is reported as a `cards` event with the photos it shows, so the browser can preview the deck before it is saved.
5. The converter assembles the document, and the drafter checks it holds the requested number of cards.
6. The document is uploaded to GCS under `presentations/{id}/cards/{sha256}.json` before the database commit, so a retried commit finds the object already in place.
7. The completion transaction records the photo assets, commits the revision, advances `presentations.current_card_revision`, and settles points together.

Revision provenance records the provider, model, prompt version, plan version, and source IDs. Converter `5xx` responses and network failures are retried as temporary; `4xx` responses fail the job.

The API accepts submissions only when `CARD_CONVERTER_URL` and `PRESENTATION_GCS_BUCKET` are both set; otherwise it returns `503` before reserving points. AI revision of an existing card document is not implemented, so a submission with `parent_presentation_id` returns `409`.

## Outline

`POST /presentation-outlines` plans a deck without drafting it. It takes the same fields as a generation submission plus a client-chosen `outline_id`, and returns `plan`, `photos` (whether stock photos are available), and the points charged and remaining. The planning call is reserved, settled, and refunded on its own under operation kind `outline`; repeating an `outline_id` returns `409`.

The user can reword points, reorder, add, or remove cards, and change layouts and photo searches. The approved outline is then submitted to `POST /presentation-jobs` as `plan`, with `slide_count` equal to its length. Positions follow the submitted order. The plan is checked at submission and again by the worker, and drafting follows it exactly.

## Photos

Stock photos come from Pexels, whose license allows download and modification. The API searches and downloads by photo ID only, from allowlisted Pexels hosts, and refuses redirects off the allowlist. Uploads are accepted up to 15 MB.

Every image is normalized before storage: decoding is bounded, the image is scaled down to at most 2400 pixels wide, and it is re-encoded as JPEG, or PNG when it has transparency. The result is stored immutably under `presentations/{id}/assets/{sha256}` and recorded in `card_assets` with its size, dimensions, MIME type, and source. A stock photo keeps its photographer and page so the card can show "Photo by X on Pexels" with a link.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/images/search?q=` | Searches stock photos |
| `POST` | `/presentations/{id}/assets/stock` | Stores a stock photo named by `photoId` |
| `POST` | `/presentations/{id}/assets/upload` | Stores an uploaded photo (multipart `file`) |
| `GET`  | `/presentations/{id}/assets/{sha256}` | Serves a stored photo to the owner, cached as immutable |

Without `PEXELS_API_KEY` the stock routes return `503` and generation drafts without photos. AI image generation sits behind the same image source interface but is disabled until it has a per-image price.

## Storage

`card_revisions` holds one row per revision: digest, size, card count, schema version, author, operation kind and ID, base revision, and provenance. Writers commit with compare-and-swap against the expected current revision; a stale base is a conflict, and repeating an operation ID returns the first result. Deleting a user removes their presentations and revisions.

`GET /presentations/{id}/document` returns the current revision, its document, and the assets it shows to the owner. The object is checked against the revision's size and digest before it is served. A revision's referenced assets must all be recorded for the presentation when it commits.

## Editing

`PUT /presentations/{id}/document` saves an edited document as a new revision. The body is `{baseRevision, operationId, document}`. The presentation must be ready; the converter validates the document against the presentation's assets; the revision commits with compare-and-swap. A stale `baseRevision` returns `409` with `currentRevision`, and repeating an `operationId` returns the first result. A save also updates the presentation's title.

Edits are pure functions in `libs/cards/src/edit.ts`: text, fields, list items, layout, order, duplication, insertion, deletion, and photos. The layout menu offers only layouts the card's content fits. Text is edited in place and supports bold and italic only. Undo history coalesces keystrokes within 800 ms, and the document autosaves 1.2 seconds after the last change. After a conflict the editor stops saving and offers to reload.


## Sharing

An owner can create one read-only link per presentation. The token has 256 random bits and is returned only when the link is created; `presentation_shares` keeps its SHA-256 digest. Creating a link revokes the previous one, and revoking leaves the row as a record.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`    | `/presentations/{id}/share` | Reports whether the owner's presentation has a live link, and since when |
| `POST`   | `/presentations/{id}/share` | Creates a link, replacing any earlier one, and returns its token |
| `DELETE` | `/presentations/{id}/share` | Revokes the live link |
| `GET`    | `/shared/{token}` | Returns the current document, its photos, and the source titles and URLs its citations need |
| `GET`    | `/shared/{token}/assets/{sha256}` | Serves a photo of the shared presentation |

The shared routes need no sign-in. They serve only ready presentations, and they never return the revision's provenance, author, or prompt. A viewer always sees the latest saved revision. A malformed, unknown, or revoked token returns `404`. Photos are cached privately by the browser, so a viewer who already loaded one keeps it after the link is revoked.

## Browser

`/presentations/:presentationId` shows the deck as it is drafted while that presentation generates: written cards render as they will look, and cards still being written show their planned point. It then loads the saved document, validates it with `@slidesage/cards`, and renders it with `CardDeck` from `@slidesage/ui/components/Cards`. A failed presentation redirects to `/presentation-error`.

Cards are at least 16:9, and text is sized in container units so a card scales like a fixed slide. A card never crops its content: one whose content needs more room grows taller and is marked `data-overflows-slide`. Filling every field to its schema limit makes most layouts taller than one slide, which PPTX export will have to split or refuse.

Present shows the deck one card at a time over the whole screen, in full screen where the browser allows it. The arrow keys, Page Up and Page Down, and Space move between cards; Home and End jump to the first and last; N shows the card's speaker notes; Escape or leaving full screen stops presenting.

The generate and research pages lead to the outline at `/generate/outline`, which moves to the presentation as soon as the job is accepted. The library opens ready presentations there, and the generation indicator links back to the running one.
