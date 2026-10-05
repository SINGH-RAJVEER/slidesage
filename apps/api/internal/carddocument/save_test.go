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

// fakeValidator echoes documents back as valid unless their title is
// "invalid", standing in for the converter's schema check.
func fakeValidator(t *testing.T) *Converter {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body struct {
			Document json.RawMessage `json:"document"`
		}
		_ = json.NewDecoder(request.Body).Decode(&body)
		if strings.Contains(string(body.Document), `"title":"invalid"`) {
			writer.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = writer.Write([]byte(`{"issue":{"path":"document.title","message":"is not allowed"}}`))
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"document": body.Document})
	}))
	t.Cleanup(server.Close)
	return NewConverter(server.URL, server.Client())
}

func editedDocument(title string) json.RawMessage {
	return json.RawMessage(`{"schemaVersion":3,"title":"` + title + `","theme":"paper","cardOrder":["c_aaaaaaaa"],"cards":{"c_aaaaaaaa":{"nodes":[]}}}`)
}

func TestSaveCommitsEditsAndRefusesStaleOnes(t *testing.T) {
	database := integrationDatabase(t)
	userID, presentationID := insertFixture(t, database)
	ctx := context.Background()
	if _, err := database.ExecContext(ctx, `UPDATE presentations SET slides_data = '{"status":"ready","title":"Original"}' WHERE id = $1`, presentationID); err != nil {
		t.Fatal(err)
	}
	generated, err := Prepare(PrepareInput{PresentationID: presentationID, AuthorID: userID, OperationID: "generation-" + presentationID, OperationKind: OperationGeneration, Document: editedDocument("Original")})
	if err != nil {
		t.Fatal(err)
	}
	tx, _ := database.BeginTx(ctx, nil)
	if _, err := CommitTx(ctx, tx, 0, generated); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	caller := userID
	mux := http.NewServeMux()
	RegisterRoutes(mux, Handler{DB: database, Converter: fakeValidator(t), Identity: func(*http.Request) (string, error) { return caller, nil }})
	server := httptest.NewServer(mux)
	defer server.Close()
	response, err := http.Get(server.URL + "/presentations/" + presentationID + "/document")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("document read without bucket = %d", response.StatusCode)
	}
	save := func(base int, operation, title string) (int, map[string]any) {
		body, _ := json.Marshal(map[string]any{"baseRevision": base, "operationId": operation, "document": editedDocument(title)})
		request, _ := http.NewRequest(http.MethodPut, server.URL+"/presentations/"+presentationID+"/document", bytes.NewReader(body))
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		var decoded map[string]any
		_ = json.Unmarshal(raw, &decoded)
		return response.StatusCode, decoded
	}
	revisionOf := func(body map[string]any) float64 {
		revision, _ := body["revision"].(map[string]any)
		number, _ := revision["revision"].(float64)
		return number
	}

	status, body := save(1, "edit-operation-0001", "Edited title")
	if status != http.StatusOK || revisionOf(body) != 2 {
		t.Fatalf("first save = %d %v", status, body)
	}
	var title string
	if err := database.QueryRow(`SELECT title FROM presentations WHERE id = $1`, presentationID).Scan(&title); err != nil || title != "Edited title" {
		t.Fatalf("presentation title = %q, %v", title, err)
	}

	status, body = save(1, "edit-operation-0002", "Stale edit")
	if status != http.StatusConflict || body["currentRevision"] != float64(2) {
		t.Fatalf("stale save = %d %v", status, body)
	}

	status, body = save(1, "edit-operation-0001", "Different retry payload")
	if status != http.StatusOK || revisionOf(body) != 2 || body["document"].(map[string]any)["title"] != "Edited title" {
		t.Fatalf("repeated save = %d %v", status, body)
	}

	status, _ = save(2, "edit-operation-0003", "invalid")
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("invalid save = %d", status)
	}
	for _, title := range []string{`before\u0000after`, `\ud800`, `\udc00`} {
		status, body = save(2, "edit-incompatible-0001", title)
		failure, _ := body["error"].(map[string]any)
		message, _ := failure["message"].(string)
		if status != http.StatusUnprocessableEntity || !strings.Contains(message, "JSONB compatibility") {
			t.Fatalf("incompatible save = %d %v", status, body)
		}
	}
	current, err := CurrentRevision(ctx, database, presentationID, userID)
	if err != nil || current.Number != 2 || !bytes.Contains(current.Document, []byte(`Edited title`)) {
		t.Fatalf("incompatible saves changed current revision: %+v, %v", current, err)
	}
	status, body = save(2, "edit-literal-backslash", `literal\\u0000`)
	if status != http.StatusOK || revisionOf(body) != 3 || body["document"].(map[string]any)["title"] != `literal\u0000` {
		t.Fatalf("literal backslash text save = %d %v", status, body)
	}

	caller = "someone-else"
	status, _ = save(2, "edit-operation-0004", "Not mine")
	if status != http.StatusNotFound {
		t.Fatalf("foreign save = %d", status)
	}
}
