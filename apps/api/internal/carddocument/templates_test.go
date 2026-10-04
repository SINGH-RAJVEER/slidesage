package carddocument

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func templateConverter(t *testing.T) (*Converter, string) {
	t.Helper()
	source := AssetSource{Type: "stock", Provider: "unsplash", ProviderID: "photo-1497366811353-6870744d04b2", Photographer: "Nastuh Abootalebi"}
	asset, err := RemoteAsset("fixture", "https://images.unsplash.com/photo-1497366811353-6870744d04b2?fm=jpg&w=1600&h=1000", 1600, 1000, source)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal([]byte(sampleDocument), &document); err != nil {
		t.Fatal(err)
	}
	cards := document["cards"].(map[string]any)
	card := cards["c_aaaaaaaa"].(map[string]any)
	card["layout"] = "cover"
	card["role"] = "opening"
	card["takeaway"] = "Grid storage"
	card["sourceIds"] = []string{}
	card["nodes"] = []any{
		map[string]any{"id": "n_image", "type": "image", "assetId": asset.SHA256, "alt": "Office", "fit": "cover"},
		map[string]any{"id": "n_heading", "type": "heading", "text": []any{map[string]string{"text": "Grid storage"}}},
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/templates" || request.Header.Get(schemaVersionHeader) != "3" {
			t.Errorf("unexpected converter request: %s", request.URL.Path)
		}
		var input struct {
			TemplateID string `json:"templateId"`
		}
		_ = json.NewDecoder(request.Body).Decode(&input)
		if input.TemplateID != "ocean-proposal" {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"document": document, "assets": map[string]any{asset.SHA256: asset}})
	}))
	t.Cleanup(server.Close)
	return NewConverter(server.URL, server.Client()), asset.SHA256
}

func TestTemplateRouteRejectsAnonymousAndUnknownTemplates(t *testing.T) {
	converter, _ := templateConverter(t)
	user := ""
	mux := http.NewServeMux()
	RegisterRoutes(mux, Handler{Converter: converter, Identity: func(*http.Request) (string, error) { return user, nil }})
	request := func(id, body string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/templates/"+id+"/presentations", bytes.NewBufferString(body)))
		return response
	}
	if response := request("ocean-proposal", `{"operationId":"template-operation-1"}`); response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d", response.Code)
	}
	user = "owner"
	if response := request("ocean-proposal", `{}`); response.Code != http.StatusBadRequest {
		t.Fatalf("missing operation status = %d", response.Code)
	}
	if response := request("unknown", `{"operationId":"template-operation-1"}`); response.Code != http.StatusNotFound {
		t.Fatalf("unknown template status = %d", response.Code)
	}
}

func TestTemplateCreatesOneOwnedRevisionAndRegistersReplacementImages(t *testing.T) {
	database := integrationDatabase(t)
	user, existingID := insertFixture(t, database)
	converter, digest := templateConverter(t)
	caller := user
	mux := http.NewServeMux()
	RegisterRoutes(mux, Handler{DB: database, Store: &memoryStore{}, Converter: converter, Identity: func(*http.Request) (string, error) { return caller, nil }})
	request := func(path, body string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body)))
		return response
	}
	path := "/templates/ocean-proposal/presentations"
	body := `{"operationId":"template-operation-1"}`
	first := request(path, body)
	if first.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", first.Code, first.Body.String())
	}
	var created struct {
		ID string `json:"presentationId"`
	}
	_ = json.Unmarshal(first.Body.Bytes(), &created)
	second := request(path, body)
	if second.Code != http.StatusCreated || second.Body.String() != first.Body.String() {
		t.Fatalf("retry = %d %s", second.Code, second.Body.String())
	}
	ctx := context.Background()
	revision, err := CurrentRevision(ctx, database, created.ID, user)
	if err != nil || revision.Number != 1 || revision.CardCount != 1 {
		t.Fatalf("revision = %+v, %v", revision, err)
	}
	assets, err := AssetsFor(ctx, database, created.ID, []string{digest})
	if err != nil || len(assets) != 1 || assets[digest].URL == "" {
		t.Fatalf("starter assets = %v, %v", assets, err)
	}
	var count int
	_ = database.QueryRow(`SELECT count(*) FROM card_revisions WHERE presentation_id = $1`, created.ID).Scan(&count)
	if count != 1 {
		t.Fatalf("retry produced %d revisions", count)
	}
	if _, err = database.Exec(`UPDATE presentations SET slides_data = '{"status":"ready"}' WHERE id = $1`, existingID); err != nil {
		t.Fatal(err)
	}
	preparePath := "/presentations/" + existingID + "/templates/ocean-proposal"
	caller = "another-user"
	if response := request(preparePath, ""); response.Code != http.StatusNotFound {
		t.Fatalf("foreign owner = %d", response.Code)
	}
	caller = user
	if response := request(preparePath, ""); response.Code != http.StatusOK {
		t.Fatalf("prepare = %d %s", response.Code, response.Body.String())
	}
	assets, err = AssetsFor(ctx, database, existingID, []string{digest})
	if err != nil || len(assets) != 1 {
		t.Fatalf("replacement assets = %v, %v", assets, err)
	}
	_ = database.QueryRow(`SELECT count(*) FROM card_revisions WHERE presentation_id = $1`, existingID).Scan(&count)
	if count != 0 {
		t.Fatalf("preparing assets replaced the document")
	}
}
