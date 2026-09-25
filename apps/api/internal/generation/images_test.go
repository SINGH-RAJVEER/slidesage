package generation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

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

func TestPexelsSourceChoosesALandscapePhotoFromAllowedHosts(t *testing.T) {
	var authorization, query string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/search":
			authorization = request.Header.Get("Authorization")
			query = request.URL.Query().Get("query")
			fmt.Fprintf(writer, `{"photos": [
				{"id": 1, "width": 800, "height": 600, "src": {"large2x": "%[1]s/small.png"}},
				{"id": 2, "width": 3000, "height": 2000, "src": {"large2x": "%[1]s/redirect.png"}},
				{"id": 3, "width": 3000, "height": 2000, "url": "https://www.pexels.com/photo/3", "photographer": "Ada",
					"photographer_url": "https://www.pexels.com/@ada", "alt": "Battery racks", "src": {"large2x": "%[1]s/photo.png"}}]}`, server.URL)
		case "/redirect.png":
			http.Redirect(writer, request, "http://example.com/elsewhere.png", http.StatusFound)
		case "/photo.png":
			_, _ = writer.Write(photoPNG(t, 1600, 900))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	host, _ := url.Parse(server.URL)
	source := newPexelsSource("test-key", server.URL, []string{host.Host})

	found, err := source.Find(context.Background(), imageRequest{Query: "battery warehouse"})
	if err != nil {
		t.Fatal(err)
	}
	if authorization != "test-key" || query != "battery warehouse" {
		t.Fatalf("authorization = %q, query = %q", authorization, query)
	}
	if found.Source.ProviderID != "3" || found.Source.Photographer != "Ada" || found.Source.PageURL != "https://www.pexels.com/photo/3" || found.Alt != "Battery racks" {
		t.Fatalf("found = %+v", found.Source)
	}
}

func TestPexelsSourceReportsNoImageWhenSearchFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	source := newPexelsSource("key", server.URL, nil)
	if _, err := source.Find(context.Background(), imageRequest{Query: "anything"}); !errors.Is(err, errNoImage) {
		t.Fatalf("error = %v", err)
	}
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
	converter := startConverter(t)
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
	for key, contents := range store.objects {
		if strings.Contains(key, "/assets/") {
			assets++
			continue
		}
		if err := json.Unmarshal(contents, &document); err != nil {
			t.Fatal(err)
		}
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
