# Card document architecture

## Status and decision

This is the architecture of SlideSage presentations. It describes the target design; the part already built is listed under "Implemented so far". The defining decision is that an editable card document becomes the authoritative presentation. Browser presentation and PPTX export derive from a saved card revision.

The PPTX-first pipeline this replaces has been removed: the template-slot compiler, the template catalog, publisher, and marketplace, canonical PPTX revision storage and its document routes, and the browser PPTX viewer. Production Terraform now drops the template CDN route and deploys the converter with the API and worker. Migration 34 drops the legacy `presentation_revisions` table and the `current_pptx_revision` column. The PPTX objects those rows pointed at stay in the bucket.

### Implemented so far

The first vertical slice is built; [CARD_DOCUMENTS.md](CARD_DOCUMENTS.md) describes it. It covers the version 2 card schema in `libs/cards`, the Bun converter service, immutable card revisions in PostgreSQL JSONB and image assets in GCS, planned and batch-drafted generation with targeted card repair, an outline the user approves before drafting, a live preview of cards as they are drafted, stock and uploaded photos, direct editing in the browser, AI revisions of chosen cards, present mode, read-only share links, and synchronous PPTX export of native text, lists, and photos.

Still to build:

- charts, tables, and AI-generated images;
- theme choice at creation;
- the rest of the export design below: asynchronous exports recorded with their revision, exporter version, and output digest; text measured with the actual fonts; and a browser-versus-PPTX comparison gate.

Also open:

- The converter is configured as a localhost sidecar in both Cloud Run services, but the card pipeline has not been deployed or verified against the live environment.
- Provenance is recorded only on successful revisions. A failed run keeps its error and retry settings but not the model, prompt version, or source IDs it used.
- At their schema limits most layouts need more room than one 16:9 slide. Cards never change shape: the browser and export both shrink their text to fit, down to half size. Tighter per-layout limits would keep more cards at their designed size.

The design takes inspiration from Gamma's disclosed card system and its HTML-to-editor conversion. The [card system description](https://gamma.app/explore/content/guides/how-gamma-maps-content-directly-to-slides-using-its-card-system) describes flexible cards and layout selection. The [engineering case study](https://vercel.com/customers/gamma-builds-design-first-agents-with-vercel) says generated HTML is parsed into structured Tiptap content and assets are resolved. Neither source specifies Gamma's complete prompts, internal document schema, or export writer. The choices below are SlideSage proposals.

## User-visible result

A user enters a topic, notes, or supplied research, chooses a theme and target card count, and receives an editable browser presentation. Each card has one main point. The user can edit text and assets, reorder cards, change an offered layout, and ask AI to revise selected content. The browser displays the saved card document directly. A PPTX download exports a particular saved revision into fixed-size slides.

The initial product must say which rich browser features have editable PPTX equivalents. An export cannot silently turn a chart or diagram into a picture while claiming it remains editable.

## Document model and module interface

Define a versioned `CardDocument` with document ID, schema version, theme reference, ordered card IDs, and asset references. Each card contains a takeaway, narrative role, chosen layout, content nodes, source references, and optional speaker notes. Content nodes have stable IDs so edits can address them without relying on array positions. Rich text uses a constrained editor schema. Layout and theme choices are separate from the content nodes; model output cannot inject arbitrary CSS or script.

One presentation-document module owns `create`, `get`, `revise`, `saveEdit`, and `exportPPTX`. Its interface guarantees card-count checks, schema validation, operation idempotency, optimistic revision checks, immutable storage, and asset ownership. Callers do not manipulate editor JSON, ZIP entries, or GCS object keys directly. Internally, a card-layout module and a PPTX-export module can change independently behind that interface.

Store immutable card bodies as JSONB alongside revision metadata in PostgreSQL, and advance the current-revision pointer in the same transaction. Use compare-and-swap on manual and AI saves. Keep image bytes in GCS under immutable identifiers with MIME, size, digest, license or source metadata, and ownership checks. Migration 33 and `cmd/migrate` backfill legacy GCS document bodies before runtime rollout; see [Card documents](CARD_DOCUMENTS.md#storage). An export records the card revision, exporter version, dimensions, and output digest that produced it. Repeat downloads of the same export return the same bytes.

## Generation and editing flow

1. Keep the current Go API, River jobs, persisted progress events, provider selection, cancellation, and point accounting. A generation job first produces a whole-deck plan with a takeaway, evidence, narrative role, and proposed visual for every card. Validate the requested count and source coverage before drafting.
2. Draft cards in bounded batches with the same plan and a summary of completed cards. The model emits a restricted markup format or structured nodes supported by the editor schema. Save model, provider, prompt version, plan version, and source IDs with the generation record so failed runs can be inspected.
3. A Bun/TypeScript conversion process validates and sanitizes model output, parses supported markup into editor content, resolves referenced assets, and rejects unsupported nodes. It must have the same schema version as the browser editor. The Go worker calls this process through a narrow, versioned request and response interface. No generated HTML is rendered directly in the browser.
4. Resolve uploaded, selected, or generated images before saving a card. Check dimensions and usage rights; preserve source identifiers. Charts carry actual data and a declared chart type. Missing required assets fail or trigger a bounded repair instead of leaving a decorative placeholder.
5. Render and edit the saved card document in React. Designed layout patterns handle comparison, process, quote, image with text, and data cards. Layout selection is constrained to patterns that support the card's content. Manual edits save new revisions. AI revisions target stable card and node IDs against an expected base revision; stale revisions return a conflict.
6. Serialize the current editor content into a compact AI-readable form when revising it. The requested operation and its affected card IDs are explicit. Validate the resulting patch against the pinned base and save a new immutable revision only after content and asset checks pass.

## Runtime placement

The API and worker images contain only Go binaries. Production runs the Bun converter as a sidecar beside each Go container, reached at `127.0.0.1:8090` in the shared Cloud Run network namespace. The API uses it to validate saves and prepare outlines; the worker uses it to draft and assemble cards. All four runtime images are built from one commit and pinned to that commit by Terraform. This adds converter CPU and memory to each service instance, but avoids a separately exposed service and cross-service authentication. The Go processes call the versioned conversion interface with timeouts and idempotent operation IDs. Keep card generation durable in River; a converter restart must not lose the job or commit a partial document. The browser and converter must ship compatible schema versions, and old card revisions must remain readable after an editor upgrade.

## PPTX export

Export is an asynchronous conversion from one card revision to a fixed slide geometry. The exporter lays out each card at the selected slide size, measures text with the actual fonts, writes native text and images, and handles supported charts and tables as native PowerPoint objects. It must report a specific unsupported-content error or require the user to select a documented fallback. It must never quietly crop a card to fit.

The removed template-slot compiler cloned authored PPTX slides and filled named slots, so it is no basis for this exporter. Build a separate exporter with a shared, testable layout description so the browser and PPTX paths agree on content order, emphasis, and image crops. Browser CSS and PowerPoint will still render differently; comparison against exported slides is a required gate. Fix card size for PPTX-oriented presentations or define a deterministic split rule for content that exceeds one slide. Preserve exact requested slide counts only when every card maps to one slide and all cards fit.

PPTX and PDF files are derived artifacts, not writable sources for the card document. An edit made in PowerPoint cannot be merged back without a separate import and reconciliation design. Presentations generated by the removed PPTX pipeline are not migrated, and the application no longer reads their revisions. There is no automatic conversion of arbitrary OOXML into editable cards in this proposal.

## Implementation sequence

1. Specify the card schema, revision rules, supported content nodes, and export contract. Build a small set of representative cards and expected browser/PPTX outputs before changing generation.
2. Implement card storage and revision commits behind the presentation-document interface, and implement `documentDrafter` against it. (Done.)
3. Build the constrained editor schema, conversion process, browser renderer, and direct editing for the representative cards. (Done.)
4. Add planning, bounded card drafting, asset resolution, and AI edits using the current durable job and accounting flow. (Done.)
5. Build PPTX export for the supported card types. Expand the type set only after native export and browser comparison pass for each one.
6. Configure the drafter so submission accepts jobs again, and restore opening presentations from the library once the card renderer can display them. (Done.)

## Acceptance gates and risks

- A generated deck has the requested card count and every card's takeaway is represented in the saved document.
- Manual and AI edits preserve unaffected card IDs and content; concurrent saves cannot overwrite a newer revision.
- The browser opens the exact saved card revision, and an export can be traced to that revision and exporter version.
- Representative exports pass package validation and visual comparison. Native text, images, and supported data objects remain editable in desktop PowerPoint.
- Provider output cannot execute browser code, fetch unapproved URLs, or reference another user's assets.
- The benchmark records content support, repetition, render defects, export defects, first-attempt success, latency, and provider cost. No quality or speed improvement is assumed before measurement.

The largest risk is export fidelity. A flexible browser document and a fixed-size PowerPoint slide obey different layout rules. If editable PPTX is the primary product promise, this architecture must prove that conversion before cards ship, because there is no PPTX-first path left to fall back on.
