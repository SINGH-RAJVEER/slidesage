# Browser PPTX rendering

Generated presentations have one display and download artifact: the immutable PPTX revision. The viewer fetches that revision from `GET /presentations/{id}/revision`, parses it in the browser with `@aiden0z/pptx-renderer`, and paints each slide inside the existing carousel, thumbnail strip, and fullscreen surfaces.

`useRevisionDocument` polls only the current revision pointer. When the pointer changes, it fetches the named PPTX, applies the renderer's ZIP limits, validates that the parsed slide count matches the revision row, and creates a detached `PptxViewer`. Slide components render slides lazily as they approach the viewport and rerender them when their display box changes size.

The API does not convert or rasterize generated decks. There is no PDF intermediate, preview queue, preview status, or generated-slide image route. Download returns the same PPTX bytes the viewer parsed. A parsing or rendering error is shown in the existing viewer with a retry action.

Marketplace and landing-page images remain static publishing artifacts because those public surfaces should not download every source template. `scripts/render-template-previews.ts` uses the browser renderer in headless Chromium to create their full and small WebP sets from the sanitized, staged template packages. Those files do not participate in generated presentation viewing.

## Resource lifetime

The hook destroys a previous `PptxViewer` when the selected revision changes or the page unmounts. Each slide disposes its render handle before rerendering and disconnects its intersection and resize observers on unmount. Media parsing is lazy, so opening a large deck does not decode every slide before the first one appears.

## Compatibility boundary

The renderer supports common native PowerPoint content but a browser implementation cannot exactly match every Microsoft Office layout decision. The canonical PPTX remains the source of truth, and PowerPoint download remains available when a browser cannot render a package. Renderer changes should be smoke-tested against the curated templates and representative generated decks in Chromium.
