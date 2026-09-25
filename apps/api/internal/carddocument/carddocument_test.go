package carddocument

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// memoryStore is an in-memory ObjectStore with the same create-only rules.
type memoryStore struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (store *memoryStore) PutImmutable(_ context.Context, key string, body io.Reader, size int64, _ string, _ string) error {
	contents, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	if int64(len(contents)) != size {
		return ErrObjectSize
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.objects == nil {
		store.objects = map[string][]byte{}
	}
	if existing, found := store.objects[key]; found && !bytes.Equal(existing, contents) {
		return ErrObjectConflict
	}
	store.objects[key] = contents
	return nil
}

func (store *memoryStore) OpenObject(_ context.Context, key string) (io.ReadCloser, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	contents, found := store.objects[key]
	if !found {
		return nil, ErrObjectNotFound
	}
	return io.NopCloser(bytes.NewReader(contents)), nil
}

const sampleDocument = `{"schemaVersion": 2, "title": "Grid storage", "theme": "slate",
	"cardOrder": ["c_aaaaaaaa"], "cards": {"c_aaaaaaaa": {}}}`

func prepareInput() PrepareInput {
	return PrepareInput{
		PresentationID: "presentation-1",
		AuthorID:       "user-1",
		OperationID:    "operation-1",
		OperationKind:  OperationGeneration,
		Document:       json.RawMessage(sampleDocument),
		Provenance:     map[string]string{"model": "test"},
	}
}

func TestPrepareStoresACompactContentAddressedObject(t *testing.T) {
	store := &memoryStore{}
	revision, err := Prepare(context.Background(), store, prepareInput())
	if err != nil {
		t.Fatal(err)
	}
	if revision.CardCount != 1 || revision.SchemaVersion != 2 {
		t.Fatalf("revision = %+v", revision)
	}
	if revision.ObjectKey != "presentations/presentation-1/cards/"+revision.SHA256+".json" {
		t.Fatalf("object key = %s", revision.ObjectKey)
	}
	stored := store.objects[revision.ObjectKey]
	if bytes.Contains(stored, []byte("\n")) || int64(len(stored)) != revision.ByteSize {
		t.Fatalf("stored %q", stored)
	}
	again, err := Prepare(context.Background(), store, prepareInput())
	if err != nil || again.SHA256 != revision.SHA256 {
		t.Fatalf("repeat prepare = %+v, %v", again, err)
	}
	loaded, err := Load(context.Background(), store, revision)
	if err != nil || !bytes.Equal(loaded, stored) {
		t.Fatalf("load = %s, %v", loaded, err)
	}
}

func TestPrepareRefusesOtherSchemaVersionsAndEmptyDocuments(t *testing.T) {
	for _, document := range []string{
		`{"schemaVersion": 3, "cardOrder": ["c_aaaaaaaa"]}`,
		`{"schemaVersion": 2, "cardOrder": []}`,
		`not json`,
	} {
		input := prepareInput()
		input.Document = json.RawMessage(document)
		if _, err := Prepare(context.Background(), &memoryStore{}, input); !errors.Is(err, ErrInvalidDocument) {
			t.Fatalf("%s: error = %v", document, err)
		}
	}
}

func TestLoadRejectsAnObjectThatDoesNotMatchItsRevision(t *testing.T) {
	store := &memoryStore{}
	revision, err := Prepare(context.Background(), store, prepareInput())
	if err != nil {
		t.Fatal(err)
	}
	tampered := bytes.Replace(store.objects[revision.ObjectKey], []byte("Grid"), []byte("Grim"), 1)
	store.objects[revision.ObjectKey] = tampered
	if _, err := Load(context.Background(), store, revision); !errors.Is(err, ErrObjectDigest) {
		t.Fatalf("error = %v", err)
	}
}

func TestConverterClassifiesFailures(t *testing.T) {
	status := http.StatusOK
	var header string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		header = request.Header.Get(schemaVersionHeader)
		writer.WriteHeader(status)
		switch request.URL.Path {
		case "/v1/documents":
			_, _ = writer.Write([]byte(`{"issue":{"path":"document.cardOrder","message":"must hold 1-40 cards"}}`))
		default:
			_, _ = writer.Write([]byte(`{"error":"boom","results":[{"position":1,"issue":{"path":"card.layout","message":"bad"}}]}`))
		}
	}))
	defer server.Close()
	converter := NewConverter(server.URL, server.Client())
	ctx := context.Background()

	results, err := converter.ConvertCards(ctx, "op", nil, []DraftInput{{Position: 1, Takeaway: "t", Role: "evidence", Draft: json.RawMessage(`{}`)}})
	if err != nil || results[0].Issue == nil || results[0].Issue.Path != "card.layout" || header != "2" {
		t.Fatalf("results = %+v, err = %v, header = %q", results, err, header)
	}

	status = http.StatusUnprocessableEntity
	_, issue, err := converter.Assemble(ctx, "Title", "slate", nil)
	if err != nil || issue == nil || issue.Path != "document.cardOrder" {
		t.Fatalf("issue = %+v, err = %v", issue, err)
	}

	for _, test := range []struct {
		status    int
		temporary bool
	}{{http.StatusServiceUnavailable, true}, {http.StatusConflict, false}, {http.StatusBadRequest, false}} {
		status = test.status
		_, err := converter.ConvertCards(ctx, "op", nil, nil)
		var converterErr *ConverterError
		if !errors.As(err, &converterErr) || converterErr.Temporary() != test.temporary {
			t.Fatalf("status %d: error = %v", test.status, err)
		}
	}
}

func TestCommitTxAdvancesOnceAndRefusesStaleBases(t *testing.T) {
	database := integrationDatabase(t)
	userID, presentationID := insertFixture(t, database)
	ctx := context.Background()
	revision := Revision{
		PresentationID: presentationID,
		SHA256:         "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ByteSize:       10,
		CardCount:      1,
		SchemaVersion:  SchemaVersion,
		AuthorID:       userID,
		OperationKind:  OperationGeneration,
		OperationID:    "generation-" + presentationID,
	}
	revision.ObjectKey = objectKey(presentationID, revision.SHA256)

	commit := func(expected int, revision Revision) (CommitResult, error) {
		tx, err := database.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		result, err := CommitTx(ctx, tx, expected, revision)
		if err == nil {
			err = tx.Commit()
		}
		return result, err
	}

	first, err := commit(0, revision)
	if err != nil || first.Revision.Number != 1 || first.Duplicate {
		t.Fatalf("first = %+v, %v", first, err)
	}
	repeat, err := commit(0, revision)
	if err != nil || !repeat.Duplicate || repeat.Revision.Number != 1 {
		t.Fatalf("repeat = %+v, %v", repeat, err)
	}
	edit := revision
	edit.OperationKind, edit.OperationID = OperationManualEdit, "edit-"+presentationID
	if _, err := commit(0, edit); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("stale edit error = %v", err)
	}
	second, err := commit(1, edit)
	if err != nil || second.Revision.Number != 2 || second.Revision.BaseRevision == nil || *second.Revision.BaseRevision != 1 {
		t.Fatalf("second = %+v, %v", second, err)
	}
	current, err := CurrentRevision(ctx, database, presentationID, userID)
	if err != nil || current.Number != 2 {
		t.Fatalf("current = %+v, %v", current, err)
	}
	if _, err := CurrentRevision(ctx, database, presentationID, "someone-else"); !errors.Is(err, ErrPresentationMissing) {
		t.Fatalf("foreign owner error = %v", err)
	}
}

func integrationDatabase(t *testing.T) *sql.DB {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgresql://slidesage:slidesage@127.0.0.1:5432/slidesage"
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Skipf("open PostgreSQL integration database: %v", err)
	}
	if err := database.PingContext(context.Background()); err != nil {
		database.Close()
		t.Skipf("PostgreSQL integration database is unavailable: %v", err)
	}
	var table sql.NullString
	if err := database.QueryRow(`SELECT to_regclass('card_revisions')`).Scan(&table); err != nil || !table.Valid {
		database.Close()
		t.Skip("card revision migration is not applied")
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func insertFixture(t *testing.T, database *sql.DB) (string, string) {
	t.Helper()
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		t.Fatal(err)
	}
	suffix := hex.EncodeToString(value)
	userID, presentationID := "card-user-"+suffix, "card-presentation-"+suffix
	ctx := context.Background()
	if _, err := database.ExecContext(ctx, `INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Card Test', $2, true)`, userID, suffix+"@cards.test"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO presentations (id, user_id, title, prompt, slides_data) VALUES ($1, $2, 'Card Test', 'Prompt', '{}'::jsonb)`, presentationID, userID); err != nil {
		t.Fatalf("insert presentation: %v", err)
	}
	t.Cleanup(func() {
		// Deleting the user cascades through the presentation to its revisions,
		// which is the path account deletion takes.
		if _, err := database.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, userID); err != nil {
			t.Errorf("delete fixture user: %v", err)
		}
	})
	return userID, presentationID
}

func TestPutImmutableTreatsALostRaceAsTheSameObject(t *testing.T) {
	if os.Getenv("STORAGE_EMULATOR_HOST") == "" {
		t.Skip("STORAGE_EMULATOR_HOST is not set")
	}
	store, err := NewGCSBlobStore(context.Background(), os.Getenv("PRESENTATION_GCS_BUCKET"))
	if err != nil {
		t.Fatal(err)
	}
	body := make([]byte, 4096)
	if _, err := rand.Read(body); err != nil {
		t.Fatal(err)
	}
	digest := sha256Hex(body)
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- store.PutImmutable(context.Background(), "race/"+digest, bytes.NewReader(body), int64(len(body)), "application/octet-stream", digest)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent identical write failed: %v", err)
		}
	}
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
