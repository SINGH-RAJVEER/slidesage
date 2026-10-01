package carddocument

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExportSendsTheCurrentDocumentWithItsImagesAndSources(t *testing.T) {
	database := integrationDatabase(t)
	userID, presentationID := insertFixture(t, database)
	ctx := context.Background()
	store := &memoryStore{}
	if _, err := database.ExecContext(ctx, `UPDATE presentations SET slides_data = '{"status":"ready","sources":[{"url":"https://example.com/a","title":"Source A","snippet":"notes"}]}' WHERE id = $1`, presentationID); err != nil {
		t.Fatal(err)
	}
	asset, err := PrepareAsset(ctx, store, presentationID, encodedPNG(t, 64, 36, 255), AssetSource{Type: "stock", Provider: "pexels", Photographer: "Ada"})
	if err != nil {
		t.Fatal(err)
	}
	hotlinked, err := RemoteAsset(presentationID, "https://images.unsplash.com/photo-1?w=2400", 4000, 2000, AssetSource{Type: "stock", Provider: "unsplash", ProviderID: "Ab_1"})
	if err != nil {
		t.Fatal(err)
	}
	document := json.RawMessage(`{"schemaVersion": 2, "title": "Grid: storage / 2026", "theme": "slate", "cardOrder": ["c_aaaaaaaa", "c_bbbbbbbb"],
		"cards": {"c_aaaaaaaa": {"nodes": [{"type": "image", "assetId": "` + asset.SHA256 + `"}]},
			"c_bbbbbbbb": {"nodes": [{"type": "image", "assetId": "` + hotlinked.SHA256 + `"}]}}}`)
	revision, err := Prepare(ctx, store, PrepareInput{PresentationID: presentationID, AuthorID: userID, OperationID: "op-" + presentationID, OperationKind: OperationGeneration, Document: document})
	if err != nil {
		t.Fatal(err)
	}
	tx, _ := database.BeginTx(ctx, nil)
	if err := RecordAssetsTx(ctx, tx, []Asset{asset, hotlinked}); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitTx(ctx, tx, 0, revision); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	var sent struct {
		Document json.RawMessage        `json:"document"`
		Assets   map[string]ExportAsset `json:"assets"`
		Sources  []ExportSource         `json:"sources"`
	}
	converter := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/documents/pptx" {
			t.Errorf("converter path = %s", request.URL.Path)
		}
		_ = json.NewDecoder(request.Body).Decode(&sent)
		_, _ = writer.Write([]byte("PK-file"))
	}))
	defer converter.Close()

	caller := userID
	mux := http.NewServeMux()
	var fetched []string
	fetchHotlink := func(_ context.Context, link string) ([]byte, error) {
		fetched = append(fetched, link)
		return encodedPNG(t, 2400, 1200, 255), nil
	}
	RegisterRoutes(mux, Handler{DB: database, Store: store, Converter: NewConverter(converter.URL, converter.Client()), FetchHotlink: fetchHotlink, Identity: func(*http.Request) (string, error) { return caller, nil }})
	server := httptest.NewServer(mux)
	defer server.Close()
	get := func() (*http.Response, []byte) {
		response, err := http.Get(server.URL + "/presentations/" + presentationID + "/export/pptx")
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response, body
	}

	response, body := get()
	if response.StatusCode != http.StatusOK || string(body) != "PK-file" {
		t.Fatalf("export = %d %s", response.StatusCode, body)
	}
	if response.Header.Get("Content-Type") != pptxContentType {
		t.Fatalf("content type = %s", response.Header.Get("Content-Type"))
	}
	if disposition := response.Header.Get("Content-Disposition"); disposition != `attachment; filename="Grid storage 2026.pptx"; filename*=UTF-8''Grid%20storage%202026.pptx` {
		t.Fatalf("disposition = %s", disposition)
	}
	stored := store.objects[asset.ObjectKey]
	exported := sent.Assets[asset.SHA256]
	if !bytes.Equal(exported.Data, stored) || exported.Width != 64 || exported.MIMEType != asset.MIMEType || !strings.Contains(string(exported.Source), "Ada") {
		t.Fatalf("exported asset = %+v", exported)
	}
	// A hotlinked photo is downloaded into the file, normalized, and not kept.
	remote := sent.Assets[hotlinked.SHA256]
	if len(fetched) != 1 || fetched[0] != hotlinked.URL || remote.MIMEType != "image/jpeg" || remote.Width != 2400 || len(remote.Data) == 0 || len(store.objects) != 2 {
		t.Fatalf("hotlinked export = %+v, fetched %v, stored %d objects", remote, fetched, len(store.objects))
	}
	if len(sent.Sources) != 1 || sent.Sources[0].URL != "https://example.com/a" || !strings.Contains(string(sent.Document), "Grid: storage") {
		t.Fatalf("sent = %+v", sent)
	}

	caller = "someone-else"
	if response, _ := get(); response.StatusCode != http.StatusNotFound {
		t.Fatalf("foreign export = %d", response.StatusCode)
	}
}

func TestContentDispositionNamesTheFileSafely(t *testing.T) {
	for title, want := range map[string]string{
		"":                 `attachment; filename="Presentation.pptx"; filename*=UTF-8''Presentation.pptx`,
		"Café \"plans\"\n": `attachment; filename="Caf_ plans.pptx"; filename*=UTF-8''Caf%C3%A9%20plans.pptx`,
	} {
		if got := contentDisposition(title); got != want {
			t.Fatalf("contentDisposition(%q) = %s", title, got)
		}
	}
}
