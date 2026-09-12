package templatepreview

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/slidepreview"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templateasset"
)

type rendererStub struct{ images [][]byte }

func (r rendererStub) Render(context.Context, []byte, slidepreview.Limits) ([][]byte, error) {
	return r.images, nil
}

type uploadStub struct {
	keys  []string
	mimes []string
	fail  bool
}

func (s *uploadStub) PutImmutable(_ context.Context, k string, _ io.Reader, _ int64, mime string, _ string) error {
	if s.fail {
		return errors.New("upload failed")
	}
	s.keys = append(s.keys, k)
	s.mimes = append(s.mimes, mime)
	return nil
}

func TestPublicationRequiresCompleteDeck(t *testing.T) {
	asset := templateasset.Asset{ID: "brat", Version: 1, SHA256: strings.Repeat("a", 64)}
	for _, fail := range []bool{false, true} {
		store := &uploadStub{fail: fail}
		err := Publish(context.Background(), store, rendererStub{[][]byte{[]byte("one"), []byte("two")}}, asset, []byte("pptx"), 2)
		if fail {
			if err == nil || len(store.keys) != 0 {
				t.Fatal("failed upload published a manifest")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if len(store.keys) != 3 || !strings.HasSuffix(store.keys[2], "/manifest.json") {
			t.Fatalf("order %v", store.keys)
		}
	}
	store := &uploadStub{}
	if err := Publish(context.Background(), store, rendererStub{[][]byte{[]byte("one")}}, asset, nil, 2); err == nil || len(store.keys) != 0 {
		t.Fatal("short deck published")
	}
}

// The CDN fetcher rejects any object whose media type is not an exact match, so
// a preview set uploaded under the wrong type is unreadable even when present.
func TestPublicationSetsTheContentTypesTheFetcherRequires(t *testing.T) {
	asset := templateasset.Asset{ID: "brat", Version: 1, SHA256: strings.Repeat("a", 64)}
	store := &uploadStub{}
	if err := Publish(context.Background(), store, rendererStub{[][]byte{[]byte("one"), []byte("two")}}, asset, []byte("pptx"), 2); err != nil {
		t.Fatal(err)
	}
	want := []string{templateasset.ThumbnailContentType, templateasset.ThumbnailContentType, templateasset.PreviewManifestContentType}
	for index, mime := range want {
		if store.mimes[index] != mime {
			t.Errorf("%s uploaded as %q, want %q", store.keys[index], store.mimes[index], mime)
		}
	}
}

// A preview set is addressed by the package digest, so previews published for
// one version can never be served for another.
func TestPublicationKeysPreviewsByDigest(t *testing.T) {
	store := &uploadStub{}
	asset := templateasset.Asset{ID: "brat", Version: 2, SHA256: strings.Repeat("b", 64)}
	if err := Publish(context.Background(), store, rendererStub{[][]byte{[]byte("one")}}, asset, []byte("pptx"), 1); err != nil {
		t.Fatal(err)
	}
	prefix := "pptx-templates/brat/2/" + strings.Repeat("b", 64) + "/previews/v1/"
	if store.keys[0] != prefix+"0.webp" || store.keys[1] != prefix+"manifest.json" {
		t.Fatalf("keys %v", store.keys)
	}
}

type documentStub struct {
	images [][]byte
	small  [][]byte
	limits slidepreview.Limits
}

func (s *documentStub) Render(ctx context.Context, pptx []byte, limits slidepreview.Limits) ([][]byte, error) {
	document, err := s.RenderDocument(ctx, pptx, limits)
	return document.Images, err
}

func (s *documentStub) RenderDocument(_ context.Context, _ []byte, limits slidepreview.Limits) (slidepreview.RenderedDocument, error) {
	s.limits = limits
	return slidepreview.RenderedDocument{Images: s.images, Small: s.small}, nil
}

// The landing ring reads the small variant, so publication has to put one
// beside every full slide rather than leaving the ring to download 1600 pixel
// renders for 140 pixel plates.
func TestPublicationUploadsTheSmallVariantBesideEverySlide(t *testing.T) {
	asset := templateasset.Asset{ID: "brat", Version: 1, SHA256: strings.Repeat("a", 64)}
	renderer := &documentStub{
		images: [][]byte{[]byte("one"), []byte("two")},
		small:  [][]byte{[]byte("one-small"), []byte("two-small")},
	}
	store := &uploadStub{}

	if err := Publish(context.Background(), store, renderer, asset, []byte("pptx"), 2); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	if renderer.limits.SmallWidth != slidepreview.DefaultSmallWidth {
		t.Errorf("render asked for small width %d", renderer.limits.SmallWidth)
	}
	prefix := templateasset.PreviewPrefix(asset)
	want := []string{
		prefix + "/0.webp",
		prefix + "/1.webp",
		prefix + "/small/0.webp",
		prefix + "/small/1.webp",
		prefix + "/manifest.json",
	}
	if len(store.keys) != len(want) {
		t.Fatalf("uploaded %v", store.keys)
	}
	for index, key := range want {
		if store.keys[index] != key {
			t.Fatalf("upload %d = %q, want %q", index, store.keys[index], key)
		}
	}
}

// A renderer that cannot produce the variant still publishes a readable set;
// the route serves the full size for a slide that has no small copy.
func TestPublicationWithoutAVariantRendererPublishesTheFullSizeAlone(t *testing.T) {
	asset := templateasset.Asset{ID: "brat", Version: 1, SHA256: strings.Repeat("a", 64)}
	store := &uploadStub{}

	if err := Publish(context.Background(), store, rendererStub{[][]byte{[]byte("one")}}, asset, []byte("pptx"), 1); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	for _, key := range store.keys {
		if strings.Contains(key, "/small/") {
			t.Fatalf("uploaded a small slide without a renderer for one: %v", store.keys)
		}
	}
}

// A short variant set means the render faulted partway; publishing it would
// leave the ring asking for slides that are not there.
func TestPublicationRejectsAnIncompleteVariantSet(t *testing.T) {
	asset := templateasset.Asset{ID: "brat", Version: 1, SHA256: strings.Repeat("a", 64)}
	renderer := &documentStub{
		images: [][]byte{[]byte("one"), []byte("two")},
		small:  [][]byte{[]byte("one-small")},
	}
	store := &uploadStub{}

	if err := Publish(context.Background(), store, renderer, asset, []byte("pptx"), 2); err == nil || len(store.keys) != 0 {
		t.Fatalf("incomplete variant set published: %v", store.keys)
	}
}
