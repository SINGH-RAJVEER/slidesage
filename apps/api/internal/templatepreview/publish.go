// Package templatepreview renders a published template package into the
// full-slide previews the marketplace viewer reads. It is separate from
// templatepublish because rendering needs LibreOffice, which the API and
// generation workers deliberately do not carry.
package templatepreview

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/slidepreview"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templateasset"
)

// Uploader stores preview objects. It must refuse to overwrite an existing key
// with different bytes; templatepublish.Uploader satisfies it.
type Uploader interface {
	PutImmutable(ctx context.Context, key string, body io.Reader, size int64, contentType, sha256 string) error
}

// Publish renders pptx and uploads one image per slide, then the manifest.
// Readers treat the manifest as the readiness marker, so it is written last: a
// failed image upload leaves the set invisible rather than half-readable.
func Publish(ctx context.Context, store Uploader, renderer slidepreview.Renderer, asset templateasset.Asset, pptx []byte, slideCount int) error {
	images, small, err := render(ctx, renderer, pptx)
	if err != nil {
		return err
	}
	if len(images) != slideCount || slideCount < 1 || slideCount > templateasset.MaxPreviewSlides {
		return slidepreview.ErrSlideCountMismatch
	}
	/* the small set is a size variant of the same slides, so a short one is a
	   render fault rather than a set to publish holes into */
	if len(small) > 0 && len(small) != len(images) {
		return slidepreview.ErrSlideCountMismatch
	}
	for index, image := range images {
		if len(image) == 0 {
			return fmt.Errorf("slide %d rendered empty", index)
		}
		if err := put(ctx, store, templateasset.PreviewSlideKey(asset, index, ""), image, templateasset.ThumbnailContentType); err != nil {
			return err
		}
	}
	for index, image := range small {
		if len(image) == 0 {
			return fmt.Errorf("small slide %d rendered empty", index)
		}
		key := templateasset.PreviewSlideKey(asset, index, templateasset.PreviewVariantSmall)
		if err := put(ctx, store, key, image, templateasset.ThumbnailContentType); err != nil {
			return err
		}
	}
	manifest, err := json.Marshal(templateasset.PreviewManifest{SlideCount: slideCount})
	if err != nil {
		return err
	}
	return put(ctx, store, templateasset.PreviewPrefix(asset)+"/manifest.json", manifest, templateasset.PreviewManifestContentType)
}

// render asks for the small variant alongside the full slides where the
// renderer can produce one. A renderer that only satisfies slidepreview.Renderer
// publishes the full size alone, which readers already fall back to.
func render(ctx context.Context, renderer slidepreview.Renderer, pptx []byte) ([][]byte, [][]byte, error) {
	limits := slidepreview.Limits{
		MaxSlides:  templateasset.MaxPreviewSlides,
		SmallWidth: slidepreview.DefaultSmallWidth,
	}
	if documents, ok := renderer.(slidepreview.DocumentRenderer); ok {
		document, err := documents.RenderDocument(ctx, pptx, limits)
		return document.Images, document.Small, err
	}
	images, err := renderer.Render(ctx, pptx, limits)
	return images, nil, err
}

func put(ctx context.Context, store Uploader, key string, body []byte, mime string) error {
	digest := sha256.Sum256(body)
	return store.PutImmutable(ctx, key, bytes.NewReader(body), int64(len(body)), mime, hex.EncodeToString(digest[:]))
}
