# Template marketplace

The authenticated `/marketplace` route lists curated binary PowerPoint templates. `BINARY_PPTX_TEMPLATE_CATALOG` in `libs/types/src/template-catalog.ts` is the catalog authority. The catalog contains 30 templates, seven of them preinstalled.

## Catalog model

Each template has a stable kebab-case ID, version, category, preinstalled flag, dimensions, and object-storage path. Source files under the ignored root `templates/` directory use the same ID as their filename, for example `simple-business-proposal.pptx`.

A category says what a template is for - `business`, `marketing`, `education`, or `creative` - because that is what someone opening the selector is choosing between; it is not a description of styling. `BINARY_TEMPLATE_CATEGORIES` carries the display order and labels, and the marketplace search matches a category label as well as a name, so "education" finds the lesson decks none of which carry the word.

A name is what the template is, not what the source file was called. Names stay short enough to read in the selector, describe the deck rather than the artwork it was cut from, and avoid naming the artists and brands the original Canva templates were themed after. The ID never changes with a rename: it is the published identity, and renaming one would orphan a bucket object and every presentation compiled from it.

The truncated agriculture deck is excluded from the catalog and retained as `quarantine-agriculture-business-plan.pptx`. The duplicate Textured Scrapbook file was removed.

The `/marketplace` grid is always ordered by template name and carries no control to reorder it: a catalog whose order never moves is one a reader can learn the shape of, and a name is what they arrive looking for. Its search bar sits at the same height as the presentations grid's, so moving between the two catalog pages does not shift the control under the pointer.

Every template is a marketplace template. Seven are preinstalled, which means a first visit starts with them in the reader's library rather than that they are privileged: they are listed in `/marketplace` and removable like any other. The seeded set covers every category, so someone who has never opened the marketplace still has somewhere to start whatever they are writing.

Installation stores versioned `{ id, version }` references in browser local storage. An absent key and an empty array are different answers: absent is a reader who has never installed anything and is seeded, empty is one who removed everything and is left with an empty selector and generation blocked until they install one. Nothing is silently reinstated. The store accepts old string entries only when the string matches a current binary catalog ID; synthetic legacy IDs are discarded.

The selector lists the reader's library and nothing else, laid out as columns of one category each. It carries no heading of its own - the trigger already says Template - so the first category label sits at the top of the panel, and the surface is the frosted glass the detail and tonality menus use. A category is one column however tall it gets, so a long one lengthens its list rather than spilling sideways and reading as two categories. The panel width follows the column count, so installing from a category the reader had none in widens the menu; below the `sm` breakpoint it falls back to a single column. The panel is centred on the page rather than on its trigger, which is what a surface this wide reads as; the offset is measured when the menu opens and on resize, and it is applied with `align="start"` because floating-ui ignores an alignment offset when the alignment is `center`. A category with nothing in it is not drawn, and an installed reference this build has no catalog entry for is listed last under `Installed` rather than filed under a category nobody assigned it. Nothing is labelled by where it came from, because everything came from the same place.

Each row carries a remove control in its right corner, revealed on hover or when the row takes keyboard focus, which takes the theme out of the library from the page the reader is already on. It reserves no width: a row is as wide as its title, and the control arrives over the end of it behind a short fade, so a column is sized by the names in it rather than by a gutter that is empty most of the time. It is a sibling of the menu row rather than a child, so it stays out of the menu's roving focus; `Delete` on a focused row is the keyboard path to the same action. Removing the selected theme clears the selection instead of moving to another one, because generating in a template the reader did not choose is the failure this selector exists to prevent.

## Browser preview

Opening a marketplace thumbnail loads the complete template deck at `/marketplace/:marketplaceId/preview`. It uses the same rendered-slide carousel, thumbnails, keyboard navigation, and fullscreen controls as generated presentations.

The browser requests `GET /template-previews/{id}/{version}` for the slide count and package digest, then loads each slide through `GET /template-previews/{id}/{version}/{digest}/{index}`. The API resolves the published catalog entry and signs CDN requests server-side. Slides come from `https://api.slidesage.app/pptx-templates/{id}/{version}/{digest}/previews/v1/`. Signing credentials never reach the browser.

These WebP slides are rendered from the actual sanitized PPTX with the same browser renderer used for generated decks. They are static publishing artifacts rather than part of the generated-presentation runtime. Missing previews show an error with retry.

Every slide is published at two widths: the full 1600 pixel render, and a 480 pixel copy under `previews/v1/small/{index}.webp` for readers that paint a slide at thumbnail size, which the landing ring does. `GET /template-previews/{id}/{version}/{digest}/{index}/small` serves it, falling back to the full slide for a template published before the variant existed. Chromium renders each slide once and encodes both WebP sizes in the page.

The API holds fetched slide bytes in a bounded in-process LRU cache. Slide objects are immutable and digest-pinned — a republish lands on a new digest and so a new key — which is what makes caching them safe without revalidation, and what keeps a landing visit from costing one signed origin round trip per plate.

### Publishing full-deck previews

`cmd/publish-templates` sanitizes each package and stages the digest-pinned PPTX object. `scripts/render-template-previews.ts` then opens those exact staged bytes in headless Chromium and writes every full slide, small slide, cover, and readiness manifest into the same object tree:

```sh
devenv shell -- go -C apps/api run ./cmd/publish-templates \
	-only charli-xcx-brat-album-inspired

devenv shell -- bun scripts/render-template-previews.ts \
	--source .published-templates --out .published-templates \
	--only charli-xcx-brat-album-inspired
```

Inspect the staged object tree, then upload it to the bucket backing the template CDN. Upload manifests last if the transfer tool does not preserve tree ordering, because readers treat each `manifest.json` as the readiness marker.

```sh
gcloud storage cp -r -n .published-templates/pptx-templates gs://YOUR_TEMPLATE_BUCKET/
```

Omit `--only` to process every published template. The script verifies the parsed slide count against the digest record and writes `manifest.json` after all images. Existing digest paths are immutable; changes to rendering output require a new preview format version rather than overwriting cached slides.

## Cover thumbnails

Marketplace cards load covers from `GET /template-thumbnails/{path}` on the API, where the path is the URL-encoded object path `pptx-templates/{id}/{version}/thumbnails/cover.webp` that `libs/types/src/template-catalog.ts` advertises. `libs/ui/lib/template-thumbnails.ts` builds the URL.

The browser cannot address the CDN itself: unsigned requests to `/pptx-templates/*` are refused, and giving the client a signing key would let anyone mint URLs for the packages. The API signs each request with the deployment's Cloud CDN key and streams the image back. It also keeps the marketplace from downloading a package of tens of megabytes to show one cover.

The route refuses anything that is not exactly a cover path, and refuses templates absent from `apps/api/internal/templatecatalog/published.json`, so it cannot be used to sign arbitrary bucket objects. Responses carry `Cache-Control: public, max-age=604800`, matching the CDN's client TTL, because a cover is immutable for the life of a template version. An upstream failure answers `502`.

Covers are produced with the first slide by `scripts/render-template-previews.ts` and uploaded beside the package. A template with no uploaded cover answers `502` until one exists.

## Publication gating

Three artifacts must exist before a template can produce a presentation: the digest-pinned object in the bucket, a digest recorded in both `libs/types/src/template-digests.json` and `apps/api/internal/templatecatalog/published.json`, and a compiler manifest under `apps/api/internal/templatemanifest/manifests`. A template missing any of them is listed but not usable.

The browser derives `asset.status` from the digest map, so an unpublished template reads as `pending-upload` without anyone maintaining a second list. Selection is gated on it in four places: the template dropdown disables the entry, `GeneratePPTPage` disables generation while an unselectable template is chosen, `installMarketplaceTheme` refuses to install one, and the first-visit seed skips one, because either would only add a permanently disabled entry to the selector. Marketplace cards show `Unpublished` in place of `Install`.

`go run ./cmd/publish-templates -verify` checks those artifacts for every published entry, plus the cover and the preview set, and exits non-zero on any mismatch. Each object check is a signed `HEAD`, so it costs one request per template rather than a download. The preview check reads `manifest.json`, which is uploaded after its images, so its presence means the whole set resolved.

The catalog files live in the repository while the objects live in the bucket, so the two drift apart silently. `.github/workflows/templates.yml` runs the verification daily and on demand to catch that drift. It needs the `CDN_URL` and `CDN_SIGNING_KEY_NAME` repository variables and the `CDN_SIGNING_KEY_SECRET` repository secret; signing is server-side, so a runner mints valid URLs with the same key the API uses. It is deliberately not part of the deploy workflow, whose service account has no Secret Manager access.

## Presentation selection

A presentation stores the PowerPoint template it was generated from:

```json
{
	"template": {
		"id": "simple-business-proposal",
		"version": 1
	}
}
```

The reference is carried through retries, queued jobs, resumable streaming, and the final persisted document.

There is no default template. Nothing is selected until the reader picks one, and pressing Generate with no selection warns instead of generating. A retried presentation whose template this build no longer carries leaves the selector empty and says so rather than substituting another. Installing a marketplace theme adds it to the selector; it does not select it.

The ID and version are the whole of what the browser sends. The API resolves the digest from `published.json` and pins it onto the job payload and the stored document, the worker resolves it a second time before compiling, and the compiler edits that exact package, so the deck a user receives is built from the template they picked and nothing else. Two rules keep a selection from being quietly substituted: a retry uses the template selected on the retry request rather than the one the failed presentation stored, and the research step refuses to generate with a default when its route state has lost the selection, returning to the generate page instead.

## Download readiness

Catalog visibility, installation, and download readiness are separate. A template can appear in the marketplace while its asset remains `pending-upload`. Download returns the exact bytes of the presentation's current revision, so it requires only that generation committed one. Whether a template can produce a revision at all is decided by the publication gating above.

## Future backend work

The current marketplace installation state remains browser-local. A persistent marketplace should add versioned publication records, creator ownership, license records, moderation, reporting, server-side installation records, search, and pagination.

The internal `slide_templates` table is AI generation memory and must not be reused as the marketplace catalog.
