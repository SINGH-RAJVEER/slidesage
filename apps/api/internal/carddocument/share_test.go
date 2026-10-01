package carddocument

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestShareLinksServeTheCurrentDocumentUntilRevoked(t *testing.T) {
	database := integrationDatabase(t)
	var table *string
	if err := database.QueryRow(`SELECT to_regclass('presentation_shares')::text`).Scan(&table); err != nil || table == nil {
		t.Skip("share migration is not applied")
	}
	userID, presentationID := insertFixture(t, database)
	ctx := context.Background()
	if _, err := database.ExecContext(ctx, `UPDATE presentations SET slides_data = '{"status":"ready","sources":[{"url":"https://example.com/a","title":"Source A","snippet":"private notes"}]}' WHERE id = $1`, presentationID); err != nil {
		t.Fatal(err)
	}
	revision, err := Prepare(PrepareInput{PresentationID: presentationID, AuthorID: userID, OperationID: "generation-" + presentationID, OperationKind: OperationGeneration, Document: editedDocument("Shared deck")})
	if err != nil {
		t.Fatal(err)
	}
	tx, _ := database.BeginTx(ctx, nil)
	if _, err := CommitTx(ctx, tx, 0, revision); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	caller := userID
	mux := http.NewServeMux()
	RegisterRoutes(mux, Handler{DB: database, Identity: func(*http.Request) (string, error) { return caller, nil }})
	server := httptest.NewServer(mux)
	defer server.Close()
	call := func(method, path string) (int, map[string]any, string) {
		request, _ := http.NewRequest(method, server.URL+path, nil)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		var decoded map[string]any
		_ = json.Unmarshal(raw, &decoded)
		return response.StatusCode, decoded, string(raw)
	}
	sharePath := "/presentations/" + presentationID + "/share"

	if status, body, _ := call(http.MethodGet, sharePath); status != http.StatusOK || body["share"] != nil {
		t.Fatalf("share before creation = %d %v", status, body)
	}
	status, body, _ := call(http.MethodPost, sharePath)
	token, _ := body["share"].(map[string]any)["token"].(string)
	if status != http.StatusCreated || !validShareToken(token) {
		t.Fatalf("create share = %d %v", status, body)
	}
	var stored string
	if err := database.QueryRow(`SELECT token_sha256 FROM presentation_shares WHERE presentation_id = $1`, presentationID).Scan(&stored); err != nil || stored != shareDigest(token) {
		t.Fatalf("stored token = %q, %v", stored, err)
	}
	if status, body, _ := call(http.MethodGet, sharePath); status != http.StatusOK || body["share"].(map[string]any)["token"] != nil {
		t.Fatalf("share after creation = %d %v", status, body)
	}

	// Anyone holding the link sees the deck, and nothing about how it was made.
	caller = ""
	status, body, raw := call(http.MethodGet, "/shared/"+token)
	if status != http.StatusOK || body["document"].(map[string]any)["title"] != "Shared deck" {
		t.Fatalf("shared document = %d %v", status, body)
	}
	for _, private := range []string{userID, "provenance", "private notes", "operation"} {
		if strings.Contains(raw, private) {
			t.Fatalf("shared response exposes %q: %s", private, raw)
		}
	}
	if sources := body["sources"].([]any); len(sources) != 1 || sources[0].(map[string]any)["title"] != "Source A" {
		t.Fatalf("shared sources = %v", body["sources"])
	}
	if status, _, _ := call(http.MethodGet, "/shared/not-a-token"); status != http.StatusNotFound {
		t.Fatalf("malformed token = %d", status)
	}

	// Only the owner manages the link.
	caller = "someone-else"
	if status, _, _ := call(http.MethodDelete, sharePath); status != http.StatusNotFound {
		t.Fatalf("foreign revoke = %d", status)
	}

	// A new link replaces the old one.
	caller = userID
	_, body, _ = call(http.MethodPost, sharePath)
	replacement, _ := body["share"].(map[string]any)["token"].(string)
	if status, _, _ := call(http.MethodGet, "/shared/"+token); status != http.StatusNotFound {
		t.Fatalf("replaced link = %d", status)
	}
	if status, _, _ := call(http.MethodGet, "/shared/"+replacement); status != http.StatusOK {
		t.Fatalf("replacement link = %d", status)
	}

	if status, _, _ := call(http.MethodDelete, sharePath); status != http.StatusNoContent {
		t.Fatalf("revoke = %d", status)
	}
	if status, _, _ := call(http.MethodGet, "/shared/"+replacement); status != http.StatusNotFound {
		t.Fatalf("revoked link = %d", status)
	}
}
