# Card document architecture

## Status and decision

- The editable card document is the authoritative presentation. The browser and PPTX exporter read a saved revision.
- The implementation is documented in [Card documents](CARD_DOCUMENTS.md). This guide records design constraints and remaining work.
- The former PPTX-first pipeline and its revision routes have been removed. Migrations 34 and 35 retire its tables and documents.

### Implemented so far

- Version 3 schema, private Bun converter, immutable JSONB revisions, and GCS image storage.
- Approved outlines, bounded drafting batches, targeted repairs, and live previews.
- Direct editing, selected-card AI revisions, stock and uploaded photos, presenting, and read-only sharing.
- Charts, meters, tables, and callouts with shared browser/export geometry.
- Synchronous PPTX export with native text, lists, pictures, charts, and tables.
- Shared template catalog and browser-local installation library.

Remaining work:

- AI-generated images with a defined per-image price.
- Asynchronous exports recorded by revision, exporter version, and output digest.
- Text measurement with actual fonts and a browser/PPTX visual comparison gate.
- Failed-run provenance, including model, prompt version, and source IDs.
- Tighter layout limits to reduce text shrinking and overflow at schema bounds.

## User-visible result

- Users choose a topic, reviewed sources, theme, and card count, then approve an outline before drafting.
- Each card carries one main point. Users can edit content and photos, reorder cards, change compatible layouts, and revise selected cards with AI.
- PPTX exports one saved card per fixed-size slide. Supported editable objects and export limits must remain explicit.

## Document model and module interface

- Versioned documents contain a theme, ordered card IDs, content nodes, and source references. Cards and nodes have stable IDs.
- Layouts and themes are separate from content. Model output cannot inject styling or scripts.
- `internal/carddocument` owns validation, immutable revisions, idempotent operations, expected-revision checks, and asset ownership.
- Callers use the document interface rather than manipulating JSONB bodies, ZIP entries, or GCS keys.
- The browser and exporter share layout definitions; their rendering implementations can change independently.
- Commit document bodies, revision metadata, and the current-revision pointer in one transaction. Keep image bytes under immutable GCS identifiers.
- Planned export records must identify the card revision, exporter version, dimensions, and digest, with repeat downloads returning identical bytes.

## Generation and editing flow

1. Validate the requested count and source coverage in a whole-deck plan, or use the approved outline.
2. Draft bounded batches with the full plan and a summary of completed cards.
3. Convert through the shared schema. Sanitize content, resolve assets, and repair unsupported output within bounded attempts.
4. Save only a complete validated document through the durable River and point-accounting transaction.
5. Manual edits and AI revisions save new immutable revisions against an expected base. Stale saves return a conflict.

- Images need ownership and source metadata; charts need actual data and a declared kind.
- AI revisions identify affected cards and preserve unaffected content.
- Successful revisions record provider, model, prompt and plan versions, and sources. Recording this information for failed runs remains open.

## Runtime placement

- Go API and worker images contain their binaries. Both call one private Bun converter container at `http://converter:8090` on the internal compose network.
- API uses conversion for outlines, save validation, and export. Worker uses it for drafting and assembly.
- All runtime images use the same commit. Browser and converter must agree on schema version; older saved revisions must remain readable.
- Converter calls use timeouts and operation IDs. A converter restart must not lose the River job or commit a partial document.
- The converter container has its own 512 MiB memory limit.

## PPTX export

- Current export is synchronous and writes one 16:9 slide per card. [PPTX export](CARD_DOCUMENTS.md#pptx-export) lists its editable objects and limits.
- The planned exporter adds asynchronous records, font-based text measurement, and deterministic downloads.
- Unsupported content must return a specific error or use an explicit documented fallback.
- Browser and PowerPoint rendering differ. Representative exports need package validation and visual comparison.
- Keep requested slide counts only while each card fits one slide; any future splitting rule must be deterministic.
- PPTX and PDF are derived files. Importing PowerPoint edits would require a separate reconciliation design.

## Acceptance gates and risks

- Saved decks have the requested count and retain each planned takeaway.
- Manual and AI edits preserve unaffected IDs and content. Concurrent saves cannot overwrite newer revisions.
- Browser views match saved revisions; planned export records trace output to revision and exporter version.
- Supported native PowerPoint objects remain editable and pass visual comparison.
- Provider output cannot execute code, fetch unapproved URLs, or reference another user's assets.
- Measure content support, repetition, render/export defects, first-attempt success, latency, and provider cost.
- Export fidelity remains the main risk. Browser text can still overflow at the minimum fit scale, and PPTX fit uses estimates rather than actual font measurement.

## Theme templates and marketplace

- `/marketplace` and `/marketplace/{templateId}/preview` require sign-in and use `libs/cards/src/templates.ts`.
- Six five-slide starters include photo nodes, attribution, category tags, palettes, and heading/body fonts. Previews use `CardView`.
- Search matches name, description, tags, and theme; results sort by name. Preview uses the presentation carousel, thumbnails, and Present mode.
- Install and Remove update this browser's local storage. A new library starts with the first template in each category; an explicitly emptied library stays empty.
- Generate lists installed templates by category, requires a selection, and sends its theme. Selection uses a checkmark and row highlight; retries restore the submitted theme.
- The editor's Templates dialog lists installed templates. Apply theme changes colors and fonts; Replace all slides registers curated photos through `POST /presentations/{id}/templates/{templateId}` before replacement.
- Theme changes and replacements use autosave and undo. Failed replacement leaves the current document intact.
- The API reads curated templates from the private converter's `/v1/templates`, never client-supplied asset URLs.
- Browser photos are attributed Unsplash hotlinks; PPTX embeds them. Browser availability depends on photos and Google Fonts; PowerPoint may substitute unavailable fonts.
- The landing ring draws from the same catalog. See [Landing page](LANDING_PAGE.md).
