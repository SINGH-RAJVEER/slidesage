package templateasset

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"strconv"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatecatalog"
)

const MaxPreviewSlides = 200

// PreviewManifestContentType is enforced on both ends: the publisher uploads
// under it and the fetcher rejects anything else.
const PreviewManifestContentType = "application/json"

// PreviewPrefix versions the renderer output separately from the package bytes.
func PreviewPrefix(asset Asset) string {
	return path.Dir(assetPath(asset)) + "/previews/v1"
}

// PreviewVariantSmall names the reduced-width copy of a slide, published beside
// the full one for readers that paint a slide at thumbnail size. The landing
// ring is the reason it exists: a full render there costs megabytes of decoded
// bitmap per plate to fill about 140 CSS pixels.
const PreviewVariantSmall = "small"

// PreviewSlideKey locates one slide. An empty variant addresses the full size.
func PreviewSlideKey(asset Asset, index int, variant string) string {
	if variant == PreviewVariantSmall {
		return fmt.Sprintf("%s/%s/%d.webp", PreviewPrefix(asset), PreviewVariantSmall, index)
	}
	return fmt.Sprintf("%s/%d.webp", PreviewPrefix(asset), index)
}

type PreviewManifest struct {
	SlideCount int `json:"slideCount"`
}

func (f *CDNFetcher) FetchPreviewManifest(ctx context.Context, asset Asset) (PreviewManifest, error) {
	if err := validateAsset(asset); err != nil {
		return PreviewManifest{}, err
	}
	body, err := f.object(ctx, PreviewPrefix(asset)+"/manifest.json", PreviewManifestContentType, 4096)
	if err != nil {
		return PreviewManifest{}, err
	}
	var manifest PreviewManifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return manifest, err
	}
	if manifest.SlideCount < 1 || manifest.SlideCount > MaxPreviewSlides {
		return manifest, fmt.Errorf("invalid preview count")
	}
	return manifest, nil
}

// PreviewExists reports whether a template's slide previews are published. The
// manifest is uploaded after its images, so its presence means the whole set
// resolved, which is what makes this a sufficient check on its own.
func (f *CDNFetcher) PreviewExists(ctx context.Context, asset Asset) error {
	if err := validateAsset(asset); err != nil {
		return err
	}
	return f.head(ctx, PreviewPrefix(asset)+"/manifest.json", PreviewManifestContentType)
}

func (h Handler) previewAsset(r *http.Request) (Asset, bool) {
	version, err := strconv.Atoi(r.PathValue("version"))
	if err != nil {
		return Asset{}, false
	}
	entry, found := templatecatalog.Lookup(r.PathValue("id"), version)
	if !found {
		return Asset{}, false
	}
	return Asset{ID: entry.ID, Version: entry.Version, SHA256: entry.SHA256}, true
}

func (h Handler) previewManifest(w http.ResponseWriter, r *http.Request) {
	asset, ok := h.previewAsset(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	manifest, err := h.Fetcher.FetchPreviewManifest(r.Context(), asset)
	if err != nil {
		http.Error(w, "Template previews are unavailable. Please try again later.", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", PreviewManifestContentType)
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(struct {
		PreviewManifest
		SHA256 string `json:"sha256"`
	}{manifest, asset.SHA256})
}

func (h Handler) previewSlide(w http.ResponseWriter, r *http.Request) {
	asset, ok := h.previewAsset(r)
	index, err := strconv.Atoi(r.PathValue("index"))
	variant := r.PathValue("variant")
	if !ok || err != nil || index < 0 || index >= MaxPreviewSlides || r.PathValue("digest") != asset.SHA256 {
		http.NotFound(w, r)
		return
	}
	if variant != "" && variant != PreviewVariantSmall {
		http.NotFound(w, r)
		return
	}
	body, err := h.previewBytes(r.Context(), asset, index, variant)
	if err != nil && variant != "" {
		// A template published before the small variant existed carries only
		// the full size. Serving that is far better than a hole in the ring,
		// and a backfill turns it back into a small one.
		body, err = h.previewBytes(r.Context(), asset, index, "")
	}
	if err != nil {
		http.Error(w, "Template slide is unavailable", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", ThumbnailContentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(body)
}

// previewBytes reads one published slide, through the handler's cache when it
// has one. Slide objects are immutable and digest-pinned, so a hit never needs
// revalidating: the digest is in the key, and a republish changes the key.
func (h Handler) previewBytes(ctx context.Context, asset Asset, index int, variant string) ([]byte, error) {
	key := PreviewSlideKey(asset, index, variant)
	if h.Cache != nil {
		if cached, ok := h.Cache.Get(key); ok {
			return cached, nil
		}
	}
	body, err := h.Fetcher.object(ctx, key, ThumbnailContentType, DefaultMaxThumbnailBytes)
	if err != nil {
		return nil, err
	}
	if h.Cache != nil {
		h.Cache.Put(key, body)
	}
	return body, nil
}
