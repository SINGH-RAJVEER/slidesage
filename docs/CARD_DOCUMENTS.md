# Card documents

A generated presentation is a versioned card document: an ordered set of cards, each making one point, stored as an immutable JSON revision. The browser renders the saved revision directly. The design and its remaining work are in [GAMMA_ARCHITECTURE.md](GAMMA_ARCHITECTURE.md).

## Schema

`libs/cards` (`@slidesage/cards`) defines schema version 1 and is the single authority for it. The Bun converter uses it to validate model output, and the browser uses it to check every document it loads.

- A document has `schemaVersion`, `title`, `theme`, `cardOrder`, and `cards` keyed by card ID.
- A card has a `takeaway`, a narrative `role`, a `layout`, content `nodes`, cited `sourceIds`, and optional `notes`.
- Node types are `heading`, `paragraph`, `bullets`, `quote`, `stat`, `steps`, and `columns`. Rich text is a list of runs with optional `bold` and `italic`; there are no links.
- Every card, node, and list item has a stable ID, so edits can address content directly.
- Layouts are `title`, `statement`, `bullets`, `comparison`, `process`, `quote`, and `stats`. `LAYOUT_RULES` states which node types and how many items each layout accepts. A card whose nodes do not fit its layout is invalid.
- Themes are `slate`, `paper`, and `ember`. A document names a theme; it can never carry styling.
- `LIMITS` bounds the card count (1 to 40) and every text field.

Validation is strict: unknown fields, unknown node types, duplicate IDs, and text over its limit are rejected with a path and a message, for example `card.nodes[0].text: is 91 characters, the limit is 90`.

## Converter

`apps/converter` is a private Bun HTTP service. Every conversion request sends `X-Card-Schema-Version: 1`; a different version is refused with `409`.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/health` | Liveness and served schema version |
| `GET`  | `/v1/schema` | Layout rules, limits, roles, themes, and draft shapes that drafting prompts are built from |
| `POST` | `/v1/cards` | Converts drafted cards independently; each result is a card or an issue |
| `POST` | `/v1/documents` | Assembles converted cards into a validated document, or returns `422` with an issue |

Conversion strips markup tags, control characters, zero-width characters, and bidirectional overrides, and parses `**bold**` and `*italic*` into runs. IDs are derived from the operation ID and card position, so repeating a conversion produces identical IDs.

Run it with `just converter`, or bundle it with `just converter-bundle` for the `converter` bake target. It listens on `127.0.0.1:8090` unless `CARD_CONVERTER_HOST` or `CARD_CONVERTER_PORT` say otherwise.

## Generation

The worker drafts through `cardDrafter` (`apps/api/internal/generation/cards.go`):

1. The planner returns a title and one plan entry per requested card: takeaway, role, layout, evidence, and source IDs. The plan must have exactly the requested count, positions without gaps, known roles and layouts, and only supplied sources; otherwise the planner is asked again, up to twice.
2. Cards are drafted in batches of four with the whole plan and the takeaways already written.
3. The converter validates each batch. An invalid or missing card is redrafted on its own against the reported issue, up to twice, and the rest of the batch is kept.
4. The converter assembles the document, and the drafter checks it holds the requested number of cards.
5. The document is uploaded to GCS under `presentations/{id}/cards/{sha256}.json` before the database commit, so a retried commit finds the object already in place.
6. The completion transaction commits the revision, advances `presentations.current_card_revision`, and settles points together.

Revision provenance records the provider, model, prompt version, plan version, and source IDs. Converter `5xx` responses and network failures are retried as temporary; `4xx` responses fail the job.

The API accepts submissions only when `CARD_CONVERTER_URL` and `PRESENTATION_GCS_BUCKET` are both set; otherwise it returns `503` before reserving points. AI revision of an existing card document is not implemented, so a submission with `parent_presentation_id` returns `409`.

## Storage

`card_revisions` holds one row per revision: digest, size, card count, schema version, author, operation kind and ID, base revision, and provenance. Writers commit with compare-and-swap against the expected current revision; a stale base is a conflict, and repeating an operation ID returns the first result. Deleting a user removes their presentations and revisions.

`GET /presentations/{id}/document` returns the current revision and its document to the owner. The object is checked against the revision's size and digest before it is served.

## Browser

`/presentations/:presentationId` shows live progress while that presentation generates, then loads the saved document, validates it with `@slidesage/cards`, and renders it with `CardDeck` from `@slidesage/ui/components/Cards`. A failed presentation redirects to `/presentation-error`.

Cards are at least 16:9, and text is sized in container units so a card scales like a fixed slide. A card never crops its content: one whose content needs more room grows taller and is marked `data-overflows-slide`. Filling every field to its schema limit makes most layouts taller than one slide, which PPTX export will have to split or refuse.

The generate pages move to the presentation as soon as the job is accepted. The library opens ready presentations there, and the generation indicator links back to the running one.
