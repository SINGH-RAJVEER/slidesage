# Card documents

A generated presentation is a versioned card document: an ordered set of cards, each making one point, stored as an immutable JSON revision. The browser renders the saved revision directly. The design and its remaining work are in [CARD_ARCHITECTURE.md](CARD_ARCHITECTURE.md).

## Schema

`libs/cards` (`@slidesage/cards`) defines schema version 3 and is the single authority for it. The Bun converter uses it to validate model output, and the browser uses it to check every document it loads. Version 1 and 2 documents are still readable: they are upgraded on read, and saves write version 3. Version 2 added image nodes and photo layouts; version 3 added the widget nodes and layouts described under [Widgets](#widgets).

- A document has `schemaVersion`, `title`, `theme`, `cardOrder`, and `cards` keyed by card ID.
- A card has a `takeaway`, a narrative `role`, a `layout`, content `nodes`, cited `sourceIds`, and optional `notes`.
- Node types are `heading`, `paragraph`, `bullets`, `quote`, `stat`, `steps`, `columns`, `image`, and the widgets `chart`, `progress`, `table`, and `callout`. An image node names a stored asset by its sha256 and carries alt text; it never carries a URL. Rich text is a list of runs with optional `bold` and `italic`; there are no links.
- Every card, node, list item, chart series, meter, and table row has a stable ID, so edits can address content directly.
- Layouts are `title`, `statement`, `bullets`, `comparison`, `process`, `quote`, `stats`, `image-left`, `image-right`, `cover`, `chart`, `table`, and `dashboard`. `LAYOUT_RULES` states which node types and how many items each layout accepts, which node types a layout requires one of, whether it shows a photo, and how many widgets it holds. A card whose nodes do not fit its layout is invalid.
- Themes are `slate`, `paper`, `ember`, `ocean`, `grove`, `orchid`, `sand`, `cobalt`, and `mono`. A document names a theme; it can never carry styling. Each theme in `themes.ts` defines its surface, text, accent, and rule colors, a heading and body font, and a chart palette (see [Widgets](#widgets)).
- `LIMITS` bounds the card count (1 to 40), every text field, and every widget's categories, series, values, meters, rows, and columns.

A document may only reference assets the caller says the presentation owns (`knownAssets`). Validation is strict: unknown fields, unknown node types, duplicate IDs, and text over its limit are rejected with a path and a message, for example `card.nodes[0].text: is 91 characters, the limit is 90`.

## Converter

`apps/converter` is a private Bun HTTP service. Every conversion request sends `X-Card-Schema-Version: 3`; a different version is refused with `409`.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/health` | Liveness and served schema version |
| `GET`  | `/v1/schema` | Layout rules, limits, roles, themes, draft shapes, and the widget guide that drafting prompts are built from |
| `POST` | `/v1/cards` | Converts drafted cards independently; each result is a card or an issue |
| `POST` | `/v1/documents` | Assembles converted cards into a validated document, or returns `422` with an issue |
| `POST` | `/v1/documents/validate` | Validates an edited document before it is saved |
| `POST` | `/v1/documents/drafts` | Returns every card of a document in draft form, keyed by card ID, for AI revisions |
| `POST` | `/v1/documents/pptx` | Writes a document, with the images it shows, as an editable PowerPoint file |

Conversion, assembly, and validation take `assetIds`, the assets the presentation owns; an image node naming any other asset is an issue.

Conversion also reads chart values and meter percentages written as numeric strings, such as `"1,200"`, refuses values with units such as `"4%"`, and gives a widget the model left unsized a default size (see [Widgets](#widgets)).

Conversion strips HTML formatting tags such as `<b>` and `<span class="x">` (but not text like `a<b and c>d`), control characters, zero-width characters, and bidirectional overrides, and parses `**bold**` and `*italic*` into runs. IDs are derived from the operation ID and card position, so repeating a conversion produces identical IDs.

Run it with `just converter`, or bundle it with `just converter-bundle` for the `converter` bake target. It listens on `127.0.0.1:8090` unless `CARD_CONVERTER_HOST` or `CARD_CONVERTER_PORT` say otherwise. Production builds the bundle in the release workflow and runs a converter sidecar in each API and worker Cloud Run instance. Both Go containers use `CARD_CONVERTER_URL=http://127.0.0.1:8090`; the sidecar has no public ingress port.

## Generation

The worker drafts through `cardDrafter` (`apps/api/internal/generation/cards.go`):

1. The planner returns a title and one plan entry per requested card: takeaway, role, layout, evidence, source IDs, and a photo search for photo layouts. It may choose the chart, table, and dashboard layouts only for figures or comparisons the sources or topic state, and must list those figures in the card's evidence. The plan must have exactly the requested count, positions without gaps, known roles and layouts, and only supplied sources; otherwise the planner is asked again, up to twice. When the user approved an outline first (see [Outline](#outline)), the worker uses that plan and skips this step.
2. Photos are resolved for cards with photo layouts, up to `min(6, max(2, (count+1)/2))` per deck. Further photo cards, and cards whose search finds nothing, fall back to a text layout rather than failing the deck. A `plan` event reports the plan to the browser.
3. Cards are drafted in batches of four with the whole plan and the takeaways already written.
4. The converter validates each batch. An invalid or missing card is redrafted on its own against the reported issue, up to twice, and the rest of the batch is kept. Each finished batch is reported as a `cards` event with the photos it shows, so the browser can preview the deck before it is saved.
5. The converter assembles the document, and the drafter checks it holds the requested number of cards.
6. The worker prepares the document body and revision metadata for a PostgreSQL JSONB commit. It does not upload document JSON to GCS.
7. The completion transaction records the photo assets, commits the revision and its body, advances `presentations.current_card_revision`, and settles points together.

Revision provenance records the provider, model, prompt version (`cards-v2` since widgets were added), plan version, and source IDs. Converter `5xx` responses and network failures are retried as temporary; `4xx` responses fail the job.

The API accepts submissions only when `CARD_CONVERTER_URL` is set; otherwise it returns `503` before reserving points. `PRESENTATION_GCS_BUCKET` supplies image storage. Text-only document generation and reads do not require a bucket.

## Widgets

Widgets are the four data nodes. Each has a `size`: `small`, `medium`, `large`, or `full`.

- `chart` has a `kind`, `categories` (2 to 12, unique), and `series` (1 to 4), each with a name and one finite value per category. An optional `prefix` and `suffix` are written around every value, such as `$` and ` GW`, and an optional `caption` names where the figures come from. Kinds are `column`, `bar`, `stacked-column`, `line`, `area`, `pie`, and `donut`. `chartKindMismatch` decides which kinds suit the data: a pie or donut shows exactly one series of two to six non-negative values, and a stacked column needs two series or more.
- `progress` holds one to six meters, each a label and a percentage from 0 to 100.
- `table` has two to five column headings and one to eight rows, each with one cell per column. A cell may be empty.
- `callout` holds rich text with a `tone`: `note`, `positive`, or `caution`. The tone is shown with an icon, never by color alone.

The three widget layouts place them:

- A `chart` card holds a heading, one chart, and optionally a paragraph, two to four bullets, or a callout. A `table` card holds a heading, one table, and optionally a paragraph or callout. With text, the widget's size is its share of the card's width beside the text: a third, a half, or two thirds. A `full` widget sits above the text instead. Without text, the widget fills the card.
- A `dashboard` card holds a heading and two to four widgets of any type. `widgetRows` packs them in order on a twelve-column grid (small 4, medium 6, large 8, full 12): a widget starts a new row when it would overflow the current one, and the widgets of a row share its width by span. The sizes must pack into at most two rows, so three `large` widgets are refused.

The card view and PPTX export share this geometry from `libs/cards/src/widgets.ts`, so both place every widget at the same width. A chart grows to fill the height its card leaves; meters, tables, and callouts keep their own height and are centered in their row.

Every theme carries a chart palette: six categorical series colors, used in order and never cycled, and the positive and caution tone colors. Light themes share one hue order and dark themes the same hues stepped for dark surfaces, both checked against every theme surface for lightness, chroma, colour-blind separation of neighbouring series, and normal-vision separation. Cobalt's saturated blue surface needs its own lighter hues to reach 3:1. Some light-theme hues sit below 3:1 on their surface, so charts label their values and carry their data in a table for assistive technology. The card view exposes the palette as `--card-series-1` to `--card-series-6`, `--card-positive`, and `--card-caution`.

In the browser, charts are SVG drawn to their box from those variables. Bars are rounded at their data end with a surface gap between neighbours, lines carry ringed markers, and values, labels, and legends use the text colors. A chart with two or more series has a legend; a pie or donut lists each slice with its value and share. Bars are labelled when one series has eight categories or fewer, and every mark has a hover title. Each chart names its kind and series, and keeps its numbers in a visually hidden table.

When drafting, the schema's widget guide tells the model which kind suits which data and what each size means, and drafting copies figures exactly from the plan's evidence or the sources. An AI revision keeps a widget's figures unless the instruction supplies new ones. A widget the model leaves unsized is sized by the converter: the chart or table of a chart or table card takes `large` beside text and `full` alone, and any other widget takes `medium`.

## AI revisions

An AI revision rewrites chosen cards of a saved deck according to an instruction. It is submitted to `POST /presentation-jobs` with `parent_presentation_id`, `topic` (the instruction, 1 to 400 characters), `base_revision` (the card revision the user is looking at), and optionally `card_ids`. Without `card_ids`, every card is rewritten. A revision never adds, removes, or reorders cards.

- Submission refuses a `base_revision` that is no longer current with `409`, before any points are reserved. Points are reserved for the targeted cards at their drafting bound, plus the document and sources each batch call resends, plus repair headroom.
- The worker loads the base revision and has the converter return each card in draft form (`/v1/documents/drafts`). Targeted cards are rewritten in batches of four. Each call sees the instruction, the deck's outline, the research sources, and the cards' current drafts, and it returns an updated takeaway with each card.
- Each rewritten card passes the same conversion and targeted repair as generation. It then takes the ID of the card it replaces and is spliced into the document. Every other card keeps its exact bytes. A photo card keeps its photo unless the new layout has no place for one.
- The spliced document is validated whole, stored, and committed as an `ai_revision` with compare-and-swap against `base_revision`. Its provenance records the model, the instruction, and the card IDs. A deck that changed while the job ran fails the job and refunds the reservation.
- The presentation keeps its title, sources, and original prompt.

In the browser, Iterate in the viewer header opens a side panel that asks for an instruction and whether it applies to every slide or to the slide on screen; the revise action in the editing toolbar opens it for that slide. Quick changes, such as making the text more concise or more persuasive, submit at once. Pending edits are saved first. The deck stays on screen, read-only, with progress, and reloads on the new revision once it is saved.

## Outline

`POST /presentation-outlines` plans a deck without drafting it. It takes the same fields as a generation submission plus a client-chosen `outline_id`, and returns `plan`, `photos` (whether stock photos are available), and the points charged and remaining. The planning call is reserved, settled, and refunded on its own under operation kind `outline`; repeating an `outline_id` returns `409`.

The user can reword points, reorder, add, or remove cards, and change layouts and photo searches. The approved outline is then submitted to `POST /presentation-jobs` as `plan`, with `slide_count` equal to its length. Positions follow the submitted order. The plan is checked at submission and again by the worker, and drafting follows it exactly.

## Photos

Stock search and generation use Unsplash only, whose license allows download and modification. The picker shows only Unsplash results, links to Unsplash, and credits every result as "Photo by X on Unsplash" with both names linked. The API looks photos up by photo ID through Unsplash; there is no new Pexels search or download. Remote image downloads use allowlisted hosts and refuse redirects off the allowlist. Uploads are accepted up to 15 MB, 50 megapixels, and 12000 pixels on a side, though formats that are costly to decode are refused well below 50 megapixels. Every image, uploaded or downloaded, is decoded within a 192 MB budget per process: decodes wait for each other rather than run the API out of memory, at most four uploads are read at once, and an image that alone would need more than the budget, such as a very large progressive JPEG, is refused. Images are shrunk by area averaging, which needs only a few source rows besides the result.

Uploads are stored. Every stored image is normalized first: decoding is bounded, the image is scaled down to at most 2400 pixels wide, and it is re-encoded as JPEG, or PNG when it has transparency. The result is stored immutably under `presentations/{id}/assets/{sha256}` and recorded in `card_assets` with its size, dimensions, MIME type, and source. Previously stored Pexels assets remain available to old decks.

Unsplash photos are hotlinked, as Unsplash's API guidelines require: nothing is downloaded or stored. When a photo is chosen in the picker or during generation, the API calls the photo's Unsplash download endpoint, which is how Unsplash counts a use, and skips the photo if that call fails. It then records the photo in `card_assets` with a `remote_url` on `images.unsplash.com` in place of an object: the photo's raw URL with Unsplash's sizing parameters for a JPEG at most 2400 pixels wide. Its asset ID is the SHA-256 of `unsplash:<photo ID>`, so choosing the same photo again finds the same asset. The browser loads the photo from that URL, including on share links, and the asset routes redirect to it. A PPTX export downloads it into the file without keeping it (see [PPTX export](#pptx-export)).

A stock photo keeps its library, photographer, page, and license so the card can show "Photo by X on Unsplash", with the photographer linked to their profile and the library to its home page. Historical Pexels credits and links are retained for old decks. Unsplash links carry its referral parameters. The library names and links come from `STOCK_LIBRARIES` in `libs/cards`, shared by the browser and the converter.

Unsplash keeps new apps at 50 requests an hour until it reviews them. Production stock photos are disabled for now. Terraform's `unsplash_enabled` boolean defaults to `false`, and both plan and deploy workflows use the `UNSPLASH_ENABLED` repository variable with the same default. While false, Terraform neither looks up `UNSPLASH_ACCESS_KEY` nor injects it into the API or worker. To enable stock photos later, first provision the key with an enabled Secret Manager version available as `latest`, then set `UNSPLASH_ENABLED=true` and deploy (see [Production infrastructure](PRODUCTION_INFRASTRUCTURE.md)). Unsplash remains the only stock-photo provider.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/images/search?q=&provider=` | Searches Unsplash, the default when `provider` is omitted; no other search provider is available |
| `POST` | `/presentations/{id}/assets/stock` | Adds a hotlinked Unsplash photo named by `provider` and `photoId` |
| `POST` | `/presentations/{id}/assets/upload` | Stores an uploaded photo (multipart `file`) |
| `GET`  | `/presentations/{id}/assets/{sha256}` | Serves a stored photo to the owner, cached as immutable, or redirects to a hotlinked one |

Without `UNSPLASH_ACCESS_KEY`, in production or locally, the stock routes return `503` and generation drafts text-only decks. Image uploads remain available. AI image generation sits behind the same image source interface but is disabled until it has a per-image price.

## Storage

`card_revisions` holds one row per revision: the authoritative `document` JSONB body, digest, size, card count, schema version, author, operation kind and ID, base revision, and provenance. Writers commit the body and metadata with compare-and-swap against the expected current revision; a stale base is a conflict, and repeating an operation ID returns the first result. Deleting a user removes their presentations and revisions. Stored image bytes remain in GCS.

`GET /presentations/{id}/document` returns the current revision, its document, and the assets it shows to the owner. The database selects the body and revision metadata together; reads have no GCS fallback. Digest and byte size describe the compact submitted JSON bytes, or the verified original GCS bytes for revisions imported before migration 35. They must not be compared with JSONB's reserialized bytes. A revision's referenced assets must all be recorded for the presentation when it commits.

The body is required and a revision cannot be updated: a trigger rejects every `UPDATE`. Migration `00033_card_revision_documents.sql` moved bodies from GCS objects into JSONB. Migration `00035_purge_legacy.sql` finished that move. It deletes every presentation without a card document, including every PPTX-era deck and any card deck with a revision whose body was never imported. It also drops the GCS object key column and the pgvector tables of the retired retrieval pipeline. Point operations for deleted decks stay, unlinked, as billing history. The migration cannot be downgraded; the deployment's pre-migration backup is the only copy of what it removes.

After its migrations, `cmd/migrate` deletes the objects the retired formats left in `PRESENTATION_GCS_BUCKET`: every key under `presentations/<id>/objects/`, `revisions/`, or `cards/`. Image assets under `presentations/<id>/assets/` are kept. A rerun deletes only what is left, and a failed sweep is logged without failing the migration. Terraform sets no soft-delete policy on the bucket, so a deleted object is recoverable only for the retention GCS applied when the bucket was created, seven days by default. Check it with `gcloud storage buckets describe` before the first deploy that runs the sweep.

## Editing

`PUT /presentations/{id}/document` saves an edited document as a new revision. The body is `{baseRevision, operationId, document}`. The presentation must be ready; the converter validates the document against the presentation's assets; the revision commits with compare-and-swap. A stale `baseRevision` returns `409` with `currentRevision`, and repeating an `operationId` returns the first result. A save also updates the presentation's title.

New edits must pass document validation and JSONB compatibility checks. An incompatible string or number returns `422` before the revision is committed; it is not silently normalized into storable content.

Edits are pure functions in `libs/cards/src/edit.ts`: text, fields, list items, layout, order, duplication, insertion, deletion, photos, and widgets. A widget edit that would break the card's layout, such as a fifth dashboard widget or a size that needs a third row, leaves the document unchanged. The layout menu offers only layouts the card's content fits. Text is edited in place and supports bold and italic only. Undo history coalesces keystrokes within 800 ms, and the document autosaves 1.2 seconds after the last change. A save whose response is lost is sent again with the same operation ID before any newer edit, so it lands once and the next save builds on it; until it is confirmed the deck counts as unsaved, even if its edits were undone. After a conflict the editor stops saving and offers to reload. Leaving the deck for another page, including another deck, saves pending edits first; edits that cannot be saved are dropped only after the user confirms, and closing the tab with unsaved edits asks the browser to confirm.

In the viewer, Edit makes the slide in the middle of the carousel editable and puts the title, theme, undo, and redo in the header. The toolbar for that slide sits under the carousel: layout, insert widget, AI revision, photo, move left or right, duplicate, and add a card after it. Insert adds a chart, meters, a table, or a callout to the card, moving it to the first layout that holds the widget beside its content, or adds a new chart, table, or dashboard card after it; options the card cannot hold are disabled.

While editing, hovering or focusing a widget shows its controls: a chart's kind, offering only kinds that suit its data, and a grid editor for its categories, series, values, prefix, suffix, and source note; a callout's tone; a table's columns; the widget's size where it changes the layout; and removal where the layout still holds the rest. Meter labels and percentages, table headings and cells, and callout text are edited in place. The chart data editor checks the result against the card schema before it saves. Delete in the navigation bar asks first and removes the slide on screen, whether or not the deck is being edited.


## Sharing

An owner can create one read-only link per presentation. The token has 256 random bits and is returned only when the link is created; `presentation_shares` keeps its SHA-256 digest. Creating a link revokes the previous one, and revoking leaves the row as a record.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`    | `/presentations/{id}/share` | Reports whether the owner's presentation has a live link, and since when |
| `POST`   | `/presentations/{id}/share` | Creates a link, replacing any earlier one, and returns its token |
| `DELETE` | `/presentations/{id}/share` | Revokes the live link |
| `GET`    | `/shared/{token}` | Returns the current document, its photos, and the source titles and URLs its citations need |
| `GET`    | `/shared/{token}/assets/{sha256}` | Serves a photo the shared deck currently shows; removed photos are not served |

The shared routes need no sign-in. They serve only ready presentations, and they never return the revision's provenance, author, or prompt. A viewer always sees the latest saved revision. A malformed, unknown, or revoked token returns `404`. Photos are cached privately by the browser, so a viewer who already loaded one keeps it after the link is revoked.

In the browser, Share on a saved deck opens a dialog that creates, replaces, or stops the link, and shows a new link once so it can be copied. The link opens `/s/:token`, which renders the deck read-only with Present and needs no account.

## PPTX export

`GET /presentations/{id}/export/pptx` sends the owner the current revision as a PowerPoint file. The API reads the revision, the images it shows (at most 64 MiB of them), and the presentation's research sources, and posts them to the converter's `/v1/documents/pptx`. The converter accepts bodies up to 96 MiB on that route, since images travel base64-encoded, and stores nothing. A hotlinked Unsplash photo is downloaded from `images.unsplash.com` for the export and normalized like a stored image; the copy exists only inside the exported file, which is the user downloading the photo they chose. If Unsplash cannot serve it, because it is unreachable or the photo was removed, the export fails with `502` and asks the user to try again.

`apps/converter/src/pptx.ts` writes the file with pptxgenjs on a 13.333 by 7.5 inch slide, one slide per card. Everything is native and editable: headings and paragraphs are text boxes, bullets are PowerPoint list paragraphs, comparison columns and process steps are text boxes with hairlines, and photos are pictures cropped around the image node's focus the way the browser crops them. Charts are native PowerPoint charts whose data opens in PowerPoint's data sheet, in the theme's series colors, with number formats that carry the chart's prefix and suffix and value labels where the browser labels bars. Tables are native tables with right-aligned figure columns. Meters are rounded track and fill shapes, and callouts keep their tone's rule and a sign for the tone. A donut's total, shown in its middle in the browser, is not drawn in PowerPoint. Layout, padding, type sizes, and theme colors follow the web card view; translucent theme colors are flattened onto the card surface. A cover card's gradient is a stretched PNG over the photo, because pptxgenjs shapes have no gradient fill. Citations become hyperlinks to their sources (only `http` and `https` links; other sources keep their number without a link), stock photos keep their credit with the photographer and library linked, and card notes become speaker notes.

A card whose content needs more room than one slide is not split or cropped: its text shrinks until it fits, down to half its designed size, the same rule the browser applies. The fit is estimated from average glyph widths, not measured with the font, so every text box also has PowerPoint's shrink-on-overflow turned on for anything the estimate misses; PowerPoint applies that only once the text is edited.

The download is named after the deck's title. In the browser, the Download menu in the navigation bar offers PowerPoint; it is disabled while editing or while changes are unsaved, so the file always matches the saved revision. Exports are not recorded, and two downloads of the same revision are not byte-identical, because the file carries its creation time.

## Browser

`/presentations/:presentationId` opens the deck viewer (`apps/web/src/routes/presentations/DeckViewer.tsx`): each card is one slide of a horizontal carousel, with a strip of thumbnails under it that scrolls along with the carousel. While the presentation generates, the viewer shows the deck as it is drafted: written cards render as they will look, and cards still being written show their planned point and the generation stage. It then loads the saved document, validates it with `@slidesage/cards`, and shows it in the same viewer. A failed presentation redirects to `/presentation-error`. A presentation that cannot be opened goes back to the library, which says why in its top-right notice. A deck already on screen stays open when a later reload fails, and shows the notice there. A loaded document belongs to the deck it was loaded for: moving to another deck shows the loading screen until that deck's document arrives, a slower answer for the deck the user left is ignored, and each deck gets its own editor, so edits are never saved under another deck's ID.

Every card is exactly 16:9, everywhere it is shown, and text is sized in container units so a card scales like a fixed slide. Content that needs more room than the slide has shrinks to fit instead: every text size and the space between items is multiplied by a `--fit` scale, and `CardView` finds the largest scale, at most 1, at which the content fits, down to half size as in PPTX export. It refits whenever the card changes or is resized, so the text shrinks and grows back while it is edited, and `data-text-scale` records a scale below 1. Filling every field to its schema limit needs such shrinking for most layouts; content that still does not fit at half size is cut off at the bottom of the slide. `CardSlide` fits the 16:9 card inside a slide box, leaving bars where the box has another shape, such as full screen on a 16:10 display.

Present shows the deck one card at a time over the whole screen, in full screen where the browser allows it, with timed playback. The left and right arrow keys, or J and L, move between cards; the up and down arrow keys jump to the first and last; N shows the card's speaker notes; leaving full screen stops presenting.

The generate and research pages lead to the outline at `/generate/outline`, which moves to the presentation as soon as the job is accepted. The library opens ready presentations there, and the generation indicator links back to the running one.
