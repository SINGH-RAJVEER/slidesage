package generation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentation"
)

func photoPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for x := 0; x < width; x++ {
		img.Set(x, height/2, color.RGBA{R: 200, G: 120, B: 40, A: 255})
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

type stubImages struct {
	data []byte
}

func (stub stubImages) Find(_ context.Context, request imageRequest) (foundImage, error) {
	if strings.Contains(request.Query, "missing") {
		return foundImage{}, errNoImage
	}
	return foundImage{Data: stub.data, Alt: "Photo of " + request.Query}, nil
}

func TestCardDrafterPlacesPhotosAndFallsBackWhenNoneIsFound(t *testing.T) {
	var assembled json.RawMessage
	converter := startConverter(t, &assembled)
	var draftPrompts string
	generate := func(_ context.Context, _ streamJob, promptName, _, user string, _ int) (map[string]any, int, error) {
		switch promptName {
		case "card-plan":
			return decoded(t, `{"title": "Grid storage", "cards": [
				{"position": 1, "takeaway": "Storage matters", "role": "opening", "layout": "title", "evidence": "e"},
				{"position": 2, "takeaway": "Batteries scale", "role": "evidence", "layout": "image-left", "evidence": "e", "imageQuery": "battery warehouse"},
				{"position": 3, "takeaway": "Closing thought", "role": "closing", "layout": "cover", "evidence": "e", "imageQuery": "missing sunset"}]}`), 10, nil
		case "card-draft":
			draftPrompts += user
			return decoded(t, `{"cards": [
				{"position": 1, "layout": "title", "nodes": [{"type": "heading", "text": "Grid storage"}]},
				{"position": 2, "layout": "image-left", "nodes": [{"type": "heading", "text": "Batteries scale"}, {"type": "paragraph", "text": "Warehouses of cells now back up city grids."}]},
				{"position": 3, "layout": "title", "nodes": [{"type": "heading", "text": "What comes next"}]}]}`), 20, nil
		}
		t.Fatalf("unexpected prompt %s", promptName)
		return nil, 0, nil
	}
	store := &memoryObjects{}
	drafter := newCardDrafter(converter, store, generate, stubImages{data: photoPNG(t, 1600, 900)})
	draft, err := drafter.Draft(context.Background(), streamJob{
		kind: "generation", presentationID: "presentation-1", userID: "user-1", operationID: "operation-1",
		prompt: "Grid storage", slideCount: 3, researchPayload: &presentation.ResearchPayload{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(draftPrompts, `"layout":"title","evidence":"e"`) || strings.Contains(draftPrompts, "missing sunset") {
		t.Fatalf("the card without a photo was not switched to a text layout before drafting: %s", draftPrompts)
	}
	var document struct {
		CardOrder []string `json:"cardOrder"`
		Cards     map[string]struct {
			Layout string `json:"layout"`
			Nodes  []struct {
				Type    string `json:"type"`
				AssetID string `json:"assetId"`
				Alt     string `json:"alt"`
			} `json:"nodes"`
		} `json:"cards"`
	}
	assets := 0
	for key := range store.objects {
		if strings.Contains(key, "/assets/") {
			assets++
			continue
		}
		t.Fatalf("unexpected non-image object %s", key)
	}
	if err := json.Unmarshal(assembled, &document); err != nil {
		t.Fatal(err)
	}
	if assets != 1 || draft.commit == nil {
		t.Fatalf("stored %d assets", assets)
	}
	second := document.Cards[document.CardOrder[1]]
	if second.Layout != "image-left" || second.Nodes[0].Type != "image" || len(second.Nodes[0].AssetID) != 64 || second.Nodes[0].Alt != "Photo of battery warehouse" {
		t.Fatalf("second card = %+v", second)
	}
	if third := document.Cards[document.CardOrder[2]]; third.Layout != "title" {
		t.Fatalf("third card layout = %s", third.Layout)
	}
}

func TestFoundImageIsStoredUnlessItIsHotlinked(t *testing.T) {
	store := &memoryObjects{}
	ctx := context.Background()
	source := carddocument.AssetSource{Type: "stock", Provider: "unsplash", ProviderID: "Ab_1"}
	hotlinked, err := foundImage{Hotlink: "https://images.unsplash.com/photo-1?w=2400", Width: 4800, Height: 2700, Source: source}.asset(ctx, store, "presentation-1")
	if err != nil || hotlinked.URL == "" || hotlinked.Width != 2400 || len(store.objects) != 0 {
		t.Fatalf("hotlinked asset = %+v, err = %v, stored %d objects", hotlinked, err, len(store.objects))
	}
	stored, err := foundImage{Data: photoPNG(t, 1600, 900), Source: carddocument.AssetSource{Type: "stock", Provider: "pexels"}}.asset(ctx, store, "presentation-1")
	if err != nil || stored.URL != "" || len(store.objects) != 1 {
		t.Fatalf("stored asset = %+v, err = %v, stored %d objects", stored, err, len(store.objects))
	}
}

func TestStockSourceFromEnvUsesUnsplashHotlinksAndTracksSelection(t *testing.T) {
	var uses int
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/search/photos":
			fmt.Fprintf(writer, `{"results": [{"id": "Ab_1", "width": 4000, "height": 2500,
				"alt_description": "Battery racks", "urls": {"raw": "https://images.unsplash.com/photo-1?ixid=x"},
				"links": {"download_location": "%s/photos/Ab_1/download", "html": "https://unsplash.com/photos/Ab_1"},
				"user": {"name": "Ada", "links": {"html": "https://unsplash.com/@ada"}}}]}`, server.URL)
		case "/photos/Ab_1/download":
			uses++
			if uses > 1 {
				writer.WriteHeader(http.StatusTooManyRequests)
				return
			}
			fmt.Fprint(writer, `{}`)
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	t.Setenv("PEXELS_API_KEY", "retired-key")
	t.Setenv("UNSPLASH_ACCESS_KEY", "")
	if source := stockSourceFromEnv(); source != nil {
		t.Fatal("photo generation should be disabled without an Unsplash key")
	}
	t.Setenv("UNSPLASH_ACCESS_KEY", "access-key")
	t.Setenv("UNSPLASH_API_BASE", server.URL)
	source := stockSourceFromEnv()
	if source == nil {
		t.Fatal("Unsplash photo generation is not configured")
	}
	image, err := source.Find(context.Background(), imageRequest{Query: "batteries"})
	if err != nil || uses != 1 || image.Data != nil || image.Hotlink != "https://images.unsplash.com/photo-1?fit=max&fm=jpg&ixid=x&q=80&w=2400" {
		t.Fatalf("image = %+v, uses = %d, err = %v", image, uses, err)
	}
	if image.Source.Provider != "unsplash" || image.Source.PhotographerURL != "https://unsplash.com/@ada?utm_source=slidesage&utm_medium=referral" {
		t.Fatalf("source = %+v", image.Source)
	}
	if _, err := source.Find(context.Background(), imageRequest{Query: "batteries"}); err != errNoImage || uses != 2 {
		t.Fatalf("failed download tracking should fall back to text, uses = %d, err = %v", uses, err)
	}
}
