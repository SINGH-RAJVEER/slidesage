package carddocument

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/migrations"
)

func TestLegacyImportVerifiesOriginalBytesBeforeParsing(t *testing.T) {
	body := []byte(sampleDocument)
	revision := Revision{ObjectKey: "legacy.json", SHA256: sha256Hex(body), ByteSize: int64(len(body)), CardCount: 1, SchemaVersion: 2}
	store := &memoryStore{objects: map[string][]byte{"legacy.json": body}}
	if imported, err := readLegacyDocument(context.Background(), store, revision); err != nil || string(imported) != string(body) {
		t.Fatalf("import = %s, %v", imported, err)
	}
	for _, test := range []struct {
		name string
		body []byte
		want error
	}{
		{"missing", nil, ErrObjectNotFound},
		{"size", append(append([]byte(nil), body...), ' '), ErrObjectSize},
		{"digest", []byte(strings.ReplaceAll(string(body), "Grid", "Grim")), ErrObjectDigest},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &memoryStore{objects: map[string][]byte{}}
			if test.body != nil {
				store.objects[revision.ObjectKey] = test.body
			}
			if _, err := readLegacyDocument(context.Background(), store, revision); !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
	bad := []byte(`{"schemaVersion":2,"cardOrder":[],"cards":{}}`)
	revision.SHA256, revision.ByteSize = sha256Hex(bad), int64(len(bad))
	store.objects[revision.ObjectKey] = bad
	if _, err := readLegacyDocument(context.Background(), store, revision); !errors.Is(err, ErrInvalidDocument) {
		t.Fatalf("shape error = %v", err)
	}
}

func TestBackfillIncompatibleSourceFailsWithoutDatabaseWrite(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgresql://slidesage:slidesage@127.0.0.1:5432/slidesage"
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	database.SetMaxOpenConns(1)
	ctx := context.Background()
	if err := database.PingContext(ctx); err != nil {
		t.Skipf("PostgreSQL integration database unavailable: %v", err)
	}
	schema := fmt.Sprintf("card_incompatible_%d", time.Now().UnixNano())
	if _, err := database.ExecContext(ctx, `CREATE SCHEMA `+schema+`; SET search_path TO `+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := database.ExecContext(ctx, `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Error(err)
		}
	}()
	// A pre-backfill row. No required-body constraint is needed: validation
	// must stop before either UPDATE or final constraint validation executes.
	if _, err := database.ExecContext(ctx, `CREATE TABLE card_revisions (
		presentation_id text, revision integer, object_key text, sha256 text,
		byte_size bigint, card_count integer, schema_version integer, document jsonb)`); err != nil {
		t.Fatal(err)
	}
	body := jsonbDocument(`"historical\u0000content"`)
	digest := sha256Hex(body)
	if _, err := database.ExecContext(ctx, `INSERT INTO card_revisions VALUES ('p', 7, 'legacy.json', $1, $2, 1, 2, NULL)`, digest, len(body)); err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{objects: map[string][]byte{"legacy.json": body}}
	for attempt := 0; attempt < 2; attempt++ {
		err := BackfillDocuments(ctx, database, store)
		if !errors.Is(err, ErrInvalidDocument) || !strings.Contains(err.Error(), "backfill p revision 7 (legacy.json)") || !strings.Contains(err.Error(), "source object and revision metadata preserved") {
			t.Fatalf("backfill error = %v", err)
		}
		var key, storedDigest string
		var size int64
		var missing bool
		if err := database.QueryRowContext(ctx, `SELECT object_key, sha256, byte_size, document IS NULL FROM card_revisions WHERE presentation_id = 'p' AND revision = 7`).Scan(&key, &storedDigest, &size, &missing); err != nil {
			t.Fatal(err)
		}
		if key != "legacy.json" || storedDigest != digest || size != int64(len(body)) || !missing || !bytes.Equal(store.objects[key], body) {
			t.Fatal("failed import changed the source, metadata, or missing body")
		}
	}
	for _, fragment := range []string{`"\u0000"`, `"\ud800"`, `"\udc00"`, `"\\u0000"`, `"\ud83d\ude00"`, `1e131071`, `1e131072`, `1e-16383`, `1e-16384`, `0e1073741823`, `0e1073741824`} {
		body := jsonbDocument(fragment)
		var stored []byte
		pgErr := database.QueryRowContext(ctx, `SELECT $1::jsonb`, body).Scan(&stored)
		if err := validateJSONB(body); (err == nil) != (pgErr == nil) {
			t.Fatalf("%s: validator = %v, PostgreSQL = %v", fragment, err, pgErr)
		}
	}
}

// An isolated schema exercises the real forward SQL against pre-expansion rows.
func TestBackfillResumesAndEnforcesImmutableJSONBRevisions(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgresql://slidesage:slidesage@127.0.0.1:5432/slidesage"
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	database.SetMaxOpenConns(1)
	ctx := context.Background()
	if err := database.PingContext(ctx); err != nil {
		t.Skipf("PostgreSQL integration database unavailable: %v", err)
	}
	schema := fmt.Sprintf("card_backfill_%d", time.Now().UnixNano())
	if _, err := database.ExecContext(ctx, `CREATE SCHEMA `+schema+`; SET search_path TO `+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := database.ExecContext(ctx, `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Error(err)
		}
	}()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := database.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	apply := func(name string) {
		t.Helper()
		contents, err := migrations.Files.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		exec(strings.Split(string(contents), "-- +goose Down")[0])
	}
	exec(`CREATE TABLE users (id text PRIMARY KEY); CREATE TABLE presentations (id text PRIMARY KEY);
		INSERT INTO users VALUES ('u'); INSERT INTO presentations VALUES ('p')`)
	apply("00028_add_card_revisions.sql")
	body := []byte(sampleDocument)
	digest := sha256Hex(body)
	for number := 1; number <= 2; number++ {
		exec(`INSERT INTO card_revisions (presentation_id, revision, object_key, sha256, byte_size, card_count,
			schema_version, author_id, operation_kind, operation_id) VALUES ('p', $1, $2, $3, $4, 1, 2, 'u', 'generation', $5)`,
			number, "presentations/p/cards/"+digest+".json", digest, len(body), fmt.Sprint(number))
	}
	apply("00033_card_revision_documents.sql")
	store := &countedLegacyStore{body: body, failAt: 2}
	if err := BackfillDocuments(ctx, database, store); !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("missing body error = %v", err)
	}
	var missing int
	if err := database.QueryRowContext(ctx, `SELECT count(*) FROM card_revisions WHERE document IS NULL`).Scan(&missing); err != nil || missing != 1 {
		t.Fatalf("remaining = %d, %v", missing, err)
	}
	store.failAt = 0
	if err := BackfillDocuments(ctx, database, store); err != nil {
		t.Fatal(err)
	}
	if store.reads != 3 {
		t.Fatalf("completed body was reread: %d reads", store.reads)
	}
	if err := BackfillDocuments(ctx, database, nil); err != nil {
		t.Fatalf("completed backfill required GCS: %v", err)
	}
	var key, storedDigest string
	var storedSize int64
	var stored []byte
	if err := database.QueryRowContext(ctx, `SELECT object_key, sha256, byte_size, document FROM card_revisions WHERE revision = 1`).Scan(&key, &storedDigest, &storedSize, &stored); err != nil {
		t.Fatal(err)
	}
	var shape documentShape
	if json.Unmarshal(stored, &shape) != nil || shape.SchemaVersion != 2 || key == "" || storedDigest != digest || storedSize != int64(len(body)) {
		t.Fatalf("source metadata or body changed: %s %s %d %s", key, storedDigest, storedSize, stored)
	}
	var validated bool
	if err := database.QueryRowContext(ctx, `SELECT convalidated FROM pg_constraint WHERE conrelid = 'card_revisions'::regclass AND conname = 'card_revisions_document_required'`).Scan(&validated); err != nil || !validated {
		t.Fatalf("required-body constraint not validated: %v", err)
	}
	for _, query := range []string{
		`UPDATE card_revisions SET document = '{}'::jsonb WHERE revision = 1`,
		`UPDATE card_revisions SET sha256 = repeat('b',64) WHERE revision = 1`,
		`INSERT INTO card_revisions (presentation_id, revision, sha256, byte_size, card_count, schema_version, author_id, operation_kind, operation_id)
			VALUES ('p', 3, repeat('b',64), 1, 1, 2, 'u', 'generation', 'missing')`,
		`INSERT INTO card_revisions (presentation_id, revision, sha256, byte_size, card_count, schema_version, author_id, operation_kind, operation_id, document)
			VALUES ('p', 3, repeat('b',64), 1, 1, 2, 'u', 'generation', 'bad-shape', '{}')`,
		`INSERT INTO card_revisions (presentation_id, revision, object_key, sha256, byte_size, card_count, schema_version, author_id, operation_kind, operation_id, document)
			VALUES ('p', 3, 'presentations/p/cards/' || repeat('b',64) || '.json', repeat('b',64), 1, 1, 2, 'u', 'generation', 'legacy-key', '{"schemaVersion":2,"cardOrder":["c_a"],"cards":{}}')`,
	} {
		if _, err := database.ExecContext(ctx, query); err == nil {
			t.Fatalf("invalid write succeeded: %s", query)
		}
	}
	exec(`INSERT INTO card_revisions (presentation_id, revision, sha256, byte_size, card_count, schema_version, author_id, operation_kind, operation_id, document)
		VALUES ('p', 3, $1, $2, 1, 2, 'u', 'generation', 'new', $3::jsonb)`, digest, len(body), body)
}

type countedLegacyStore struct {
	body   []byte
	reads  int
	failAt int
}

func (store *countedLegacyStore) OpenObject(ctx context.Context, key string) (io.ReadCloser, error) {
	store.reads++
	if store.reads == store.failAt {
		return nil, ErrObjectNotFound
	}
	return io.NopCloser(bytes.NewReader(store.body)), nil
}

func (*countedLegacyStore) PutImmutable(context.Context, string, io.Reader, int64, string, string) error {
	return errors.New("backfill must never upload")
}
