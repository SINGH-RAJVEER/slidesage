# Slide previews

The viewer renders a committed PPTX revision directly in the browser. It downloads the immutable package once, parses slide content and media lazily, and mounts only slides near the viewport. The same rendered slide component drives the carousel, thumbnails, and fullscreen playback.

The preview worker still creates WebP images and a PDF in the background. WebP images provide an automatic fallback when a browser cannot parse a package, and can sit underneath browser-rendered slides while their asynchronous media finishes. The PDF remains the downloadable PDF artifact. These files are derived views: rendering never rewrites the canonical package, so a preview failure leaves the deck viewable in supported browsers, downloadable as PPTX, and editable.

## Background pipeline

`cmd/previewworker` consumes the `previews` River queue. For one revision the worker:

1. claims the revision, moving `preview_status` from `pending` or `failed` to `rendering`;
2. downloads the canonical object and verifies its byte size and SHA-256 against the revision row;
3. converts the deck to PDF with headless LibreOffice in a private user profile;
4. rasterizes each page with `pdftoppm` at the configured width;
5. encodes each page to WebP with `cwebp`;
6. uploads every image, then marks the revision `ready`.

The revision is only marked ready once the complete derived set is stored, so an image-fallback reader never sees a partial deck and PDF download never serves an incomplete conversion. Preview objects use immutable keys:

```text
presentations/{presentation-id}/revisions/{revision}/previews/{slide-index}.webp
```

Slide indexes are zero-based and follow package slide order.

## Browser viewer

`useRevisionPreviews` starts two independent operations after the status endpoint returns a committed revision. It continues polling preview status, and it fetches that revision's exact PPTX bytes without waiting for `preview_status`. The PPTX renderer uses the same ZIP resource limits as the standalone template renderer and rejects a parsed slide count that disagrees with the revision row.

The renderer package is loaded through a dynamic import on the presentation route. Media and slide nodes are parsed lazily. `PreviewSlide` observes each carousel or thumbnail container and renders it only when it approaches the viewport, then resizes the intrinsic slide into the existing box. When WebP previews are already ready, the image stays underneath until asynchronous browser rendering finishes. If PPTX parsing fails, the viewer uses the immutable WebP set as soon as the worker marks it ready.

## Claims and recovery

`preview_started_at` records when a worker took a claim. Another worker may take over a claim older than `presentationrevision.DefaultStalePreviewClaim` (15 minutes), which is how a crashed renderer recovers. A cancelled render deliberately leaves its claim in place to expire rather than recording a failure the user would read as permanently broken.

A worker that cannot take the claim does not report success. When the revision is already `ready` there is nothing to do, but a claim another worker holds, or a revision row that is not visible yet, snoozes the job for a minute instead of completing it. Completing it would mark a revision rendered when no images were ever written.

Preview jobs are unique by arguments across the live states only, not across completed ones, so a revision whose earlier job finished without previews can be enqueued again by `POST /presentations/{id}/revisions/{revision}/previews/retry`.

A render that cannot succeed on a later attempt cancels its job instead of retrying: a corrupt package, a missing object, an oversized package, or a deck over the slide limit. Everything else retries under River's normal backoff.

## Limits

Every render is bounded so one hostile or pathological deck cannot exhaust the worker.

| Limit | Default | Environment variable |
| ----- | ------- | -------------------- |
| Revision bytes | 64 MiB | None; matches the commit limit |
| Slides | 200 | `PREVIEW_MAX_SLIDES` |
| Raster width | 1600 px | `PREVIEW_WIDTH` |
| Render timeout | 4 minutes | `PREVIEW_TIMEOUT_SECONDS` |
| WebP quality | 82 | `PREVIEW_WEBP_QUALITY` |

The rendered page count must equal the revision slide count. A mismatch fails the render rather than publishing a deck with missing or extra slides.

## Deployment

The renderer is the one image that cannot be built `from scratch`, because it shells out to LibreOffice, poppler, and `cwebp`. It is built from the `preview` target in `apps/api/Dockerfile` and deployed as the private Cloud Run service `preview-worker`, scaling from zero to four instances with two CPUs and 4 GiB of memory. It needs `DATABASE_URL` and `PRESENTATION_GCS_BUCKET`, and reads revisions with the runtime service account through Application Default Credentials.

Converters run with a minimal environment (`HOME` and `TMPDIR` inside the per-render working directory) so they cannot pick up ambient LibreOffice or user configuration. The working directory is removed after every render.

## Related

- [ADR 0001: Make PPTX revisions canonical](adr/0001-canonical-pptx-office-editor.md)
- [Canonical PPTX presentation flow](PPTX_CANONICAL_FLOW.md)
