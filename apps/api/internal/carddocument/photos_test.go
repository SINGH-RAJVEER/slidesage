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

func stubPexels(t *testing.T) *stockimages.Pexels {
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
	return stockimages.New("key", server.URL, []string{host.Host})
}

func TestPhotoRoutesStoreOnlyVerifiedImagesForTheOwner(t *testing.T) {
	database := integrationDatabase(t)
	userID, presentationID := insertFixture(t, database)
	if _, err := database.Exec(`UPDATE presentations SET slides_data = '{"status":"ready"}' WHERE id = $1`, presentationID); err != nil {
		t.Fatal(err)
	}
	caller := userID
	mux := http.NewServeMux()
	RegisterRoutes(mux, Handler{DB: database, Store: &memoryStore{}, Stock: stubPexels(t), Identity: func(*http.Request) (string, error) { return caller, nil }})
	server := httptest.NewServer(mux)
	defer server.Close()
	base := server.URL + "/presentations/" + presentationID

	response, err := http.Get(server.URL + "/images/search?q=solar")
	if err != nil {
		t.Fatal(err)
	}
	var search struct {
		Photos []stockimages.Photo `json:"photos"`
	}
	_ = json.NewDecoder(response.Body).Decode(&search)
	response.Body.Close()
	if len(search.Photos) != 1 || search.Photos[0].ID != 7 {
		t.Fatalf("search = %+v", search)
	}

	response, err = http.Post(base+"/assets/stock", "application/json", bytes.NewReader([]byte(`{"photoId": 7, "query": "solar"}`)))
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
	if source.Provider != "pexels" || source.ProviderID != "7" || source.Photographer != "Ada" {
		t.Fatalf("source = %+v", source)
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
	if err != nil || len(ids) != 2 {
		t.Fatalf("recorded assets = %v, %v", ids, err)
	}

	caller = "someone-else"
	if status := upload(img.Bytes()); status != http.StatusNotFound {
		t.Fatalf("foreign upload = %d", status)
	}
}
