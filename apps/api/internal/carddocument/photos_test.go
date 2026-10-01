package carddocument

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/stockimages"
)

func stubPexels(t *testing.T) []stockimages.Source {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/search":
			fmt.Fprintf(writer, `{"photos": [{"id": 7, "width": 1600, "height": 900, "alt": "Solar farm",
				"photographer": "Ada", "src": {"large2x": "%[1]s/7.png", "medium": "%[1]s/7-small.png"}}]}`, server.URL)
		case "/v1/photos/7":
			fmt.Fprintf(writer, `{"id": 7, "width": 1600, "height": 900, "alt": "Solar farm", "url": "https://www.pexels.com/photo/7",
				"photographer": "Ada", "src": {"large2x": "%s/7.png"}}`, server.URL)
		case "/7.png":
			_, _ = writer.Write(encodedPNG(t, 320, 180, 255))
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	host, _ := url.Parse(server.URL)
	return []stockimages.Source{stockimages.NewPexels("key", server.URL, []string{host.Host})}
}

func stubUnsplash(t *testing.T, used *int) stockimages.Source {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/photos/Ab_1":
			fmt.Fprintf(writer, `{"id": "Ab_1", "width": 4800, "height": 2400, "alt_description": "Wind farm",
				"urls": {"raw": "https://images.unsplash.com/photo-1?ixid=x"},
				"links": {"download_location": "%s/photos/Ab_1/download"},
				"user": {"name": "Grace", "links": {"html": "https://unsplash.com/@grace"}}}`, server.URL)
		case "/photos/Ab_1/download":
			*used++
			fmt.Fprint(writer, `{}`)
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	return stockimages.NewUnsplash("key", server.URL, nil)
}

func TestPhotoRoutesStoreOnlyVerifiedImagesForTheOwner(t *testing.T) {
	database := integrationDatabase(t)
	userID, presentationID := insertFixture(t, database)
	if _, err := database.Exec(`UPDATE presentations SET slides_data = '{"status":"ready"}' WHERE id = $1`, presentationID); err != nil {
		t.Fatal(err)
	}
	caller := userID
	store := &memoryStore{}
	var unsplashUses int
	mux := http.NewServeMux()
	stock := append(stubPexels(t), stubUnsplash(t, &unsplashUses))
	RegisterRoutes(mux, Handler{DB: database, Store: store, Stock: stock, Identity: func(*http.Request) (string, error) { return caller, nil }})
	server := httptest.NewServer(mux)
	defer server.Close()
	base := server.URL + "/presentations/" + presentationID

	response, err := http.Get(server.URL + "/images/search?q=solar")
	if err != nil {
		t.Fatal(err)
	}
	var search struct {
		Photos    []stockimages.Photo `json:"photos"`
		Provider  string              `json:"provider"`
		Providers []string            `json:"providers"`
	}
	_ = json.NewDecoder(response.Body).Decode(&search)
	response.Body.Close()
	if len(search.Photos) != 1 || search.Photos[0].ID != "7" || search.Provider != "pexels" || len(search.Providers) != 2 {
		t.Fatalf("search = %+v", search)
	}

	response, err = http.Post(base+"/assets/stock", "application/json", bytes.NewReader([]byte(`{"provider": "flickr", "photoId": "7"}`)))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("photo from an unconfigured library = %d", response.StatusCode)
	}

	response, err = http.Post(base+"/assets/stock", "application/json", bytes.NewReader([]byte(`{"provider": "pexels", "photoId": "7", "query": "solar"}`)))
	if err != nil {
		t.Fatal(err)
	}
	var added struct {
		AssetID string `json:"assetId"`
		Alt     string `json:"alt"`
		Asset   Asset  `json:"asset"`
	}
	_ = json.NewDecoder(response.Body).Decode(&added)
	response.Body.Close()
	if response.StatusCode != http.StatusCreated || len(added.AssetID) != 64 || added.Alt != "Solar farm" {
		t.Fatalf("stock add = %d %+v", response.StatusCode, added)
	}
	var source AssetSource
	_ = json.Unmarshal(added.Asset.Source, &source)
	if source.Provider != "pexels" || source.ProviderID != "7" || source.Photographer != "Ada" || source.License != "Pexels License" {
		t.Fatalf("source = %+v", source)
	}

	// An Unsplash photo is hotlinked: its use is recorded with Unsplash, and
	// nothing is stored.
	objects := len(store.objects)
	response, err = http.Post(base+"/assets/stock", "application/json", bytes.NewReader([]byte(`{"provider": "unsplash", "photoId": "Ab_1"}`)))
	if err != nil {
		t.Fatal(err)
	}
	var hotlinked struct {
		AssetID string `json:"assetId"`
		Asset   Asset  `json:"asset"`
	}
	_ = json.NewDecoder(response.Body).Decode(&hotlinked)
	response.Body.Close()
	if response.StatusCode != http.StatusCreated || unsplashUses != 1 || len(store.objects) != objects {
		t.Fatalf("hotlinked add = %d %+v, uses %d, objects %d -> %d", response.StatusCode, hotlinked, unsplashUses, objects, len(store.objects))
	}
	if hotlinked.Asset.URL != "https://images.unsplash.com/photo-1?fit=max&fm=jpg&ixid=x&q=80&w=2400" || hotlinked.Asset.Width != 2400 || hotlinked.Asset.Height != 1200 {
		t.Fatalf("hotlinked asset = %+v", hotlinked.Asset)
	}
	noRedirects := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err = noRedirects.Get(base + "/assets/" + hotlinked.AssetID)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusFound || response.Header.Get("Location") != hotlinked.Asset.URL {
		t.Fatalf("hotlinked asset route = %d %s", response.StatusCode, response.Header.Get("Location"))
	}

	upload := func(data []byte) int {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, _ := form.CreateFormFile("file", "photo.png")
		_, _ = part.Write(data)
		_ = form.Close()
		response, err := http.Post(base+"/assets/upload", form.FormDataContentType(), &body)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		return response.StatusCode
	}
	var img bytes.Buffer
	_ = png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 50, 40)))
	if status := upload(img.Bytes()); status != http.StatusCreated {
		t.Fatalf("upload = %d", status)
	}
	if status := upload([]byte("<svg onload=alert(1)>")); status != http.StatusUnprocessableEntity {
		t.Fatalf("non-image upload = %d", status)
	}

	ids, err := AssetIDsFor(context.Background(), database, presentationID)
	if err != nil || len(ids) != 3 {
		t.Fatalf("recorded assets = %v, %v", ids, err)
	}

	caller = "someone-else"
	if status := upload(img.Bytes()); status != http.StatusNotFound {
		t.Fatalf("foreign upload = %d", status)
	}
}
