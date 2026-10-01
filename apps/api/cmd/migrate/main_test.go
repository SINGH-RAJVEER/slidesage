package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/migrations"
)

func TestBackfillCommandUsesEmulatorAndNeedsNoBucketWhenComplete(t *testing.T) {
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
	schema := fmt.Sprintf("migrate_cards_%d", time.Now().UnixNano())
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := database.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE SCHEMA ` + schema + `; SET search_path TO ` + schema)
	defer func() {
		if _, err := database.ExecContext(ctx, `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Error(err)
		}
	}()
	exec(`CREATE TABLE users (id text PRIMARY KEY); CREATE TABLE presentations (id text PRIMARY KEY);
		INSERT INTO users VALUES ('u'); INSERT INTO presentations VALUES ('p')`)
	apply := func(name string) {
		t.Helper()
		contents, err := migrations.Files.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		exec(strings.Split(string(contents), "-- +goose Down")[0])
	}
	apply("00028_add_card_revisions.sql")
	body := []byte(`{"schemaVersion":2,"cardOrder":["c_a"],"cards":{"c_a":{}}}`)
	digest := fmt.Sprintf("%x", sha256.Sum256(body))
	exec(`INSERT INTO card_revisions (presentation_id, revision, object_key, sha256, byte_size, card_count,
		schema_version, author_id, operation_kind, operation_id) VALUES ('p', 1, $1, $2, $3, 1, 2, 'u', 'generation', 'op')`,
		"presentations/p/cards/"+digest+".json", digest, len(body))
	apply("00033_card_revision_documents.sql")
	t.Setenv("PRESENTATION_GCS_BUCKET", "")
	if err := backfillCardDocuments(ctx, database); err == nil || !strings.Contains(err.Error(), "PRESENTATION_GCS_BUCKET") {
		t.Fatalf("missing legacy body must report its source bucket requirement: %v", err)
	}
	var reads atomic.Int32
	var corrupt atomic.Bool
	corrupt.Store(true)
	emulator := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		reads.Add(1)
		if request.Method != http.MethodGet || !strings.Contains(request.URL.Path, digest) {
			t.Errorf("unexpected emulator request: %s %s", request.Method, request.URL)
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Content-Length", fmt.Sprint(len(body)))
		if corrupt.Load() {
			_, _ = writer.Write([]byte(strings.ReplaceAll(string(body), "c_a", "c_b")))
		} else {
			_, _ = writer.Write(body)
		}
	}))
	defer emulator.Close()
	t.Setenv("PRESENTATION_GCS_BUCKET", "legacy-test-bucket")
	t.Setenv("STORAGE_EMULATOR_HOST", emulator.URL)
	if err := backfillCardDocuments(ctx, database); err == nil || !strings.Contains(err.Error(), "digest") {
		t.Fatalf("corrupt source must fail the migration: %v", err)
	}
	var missing bool
	if err := database.QueryRowContext(ctx, `SELECT document IS NULL FROM card_revisions WHERE revision = 1`).Scan(&missing); err != nil || !missing {
		t.Fatalf("corrupt source was imported: missing=%v, error=%v", missing, err)
	}
	corrupt.Store(false)
	if err := backfillCardDocuments(ctx, database); err != nil {
		t.Fatal(err)
	}
	if reads.Load() != 2 {
		t.Fatalf("emulator reads = %d", reads.Load())
	}
	t.Setenv("PRESENTATION_GCS_BUCKET", "")
	t.Setenv("STORAGE_EMULATOR_HOST", "")
	if err := backfillCardDocuments(ctx, database); err != nil {
		t.Fatalf("completed migration required GCS: %v", err)
	}
}
