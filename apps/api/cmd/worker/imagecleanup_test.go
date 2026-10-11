package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
)

func TestMaintenanceDeletesAccountImagesFromGCS(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" || os.Getenv("STORAGE_EMULATOR_HOST") == "" {
		t.Skip("PostgreSQL and GCS emulator are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	database, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	store, err := carddocument.NewGCSBlobStore(ctx, os.Getenv("PRESENTATION_GCS_BUCKET"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	body := []byte("image cleanup fixture")
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	suffix := time.Now().Format("20060102150405.000000000")
	var removedKey, keptKey string
	for i, userID := range []string{"removed-" + suffix, "kept-" + suffix} {
		presentationID := "presentation-" + userID
		key := "presentations/" + presentationID + "/assets/" + digest + ".jpg"
		if err := store.PutImmutable(ctx, key, bytes.NewReader(body), int64(len(body)), "image/jpeg", digest); err != nil {
			t.Fatal(err)
		}
		if _, err := database.ExecContext(ctx, `INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Cleanup Test', $2, true)`, userID, userID+"@cleanup.test"); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = database.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID)
			_ = store.DeleteObject(ctx, key)
		})
		if _, err := database.ExecContext(ctx, `INSERT INTO presentations (id, user_id, title, prompt, slides_data) VALUES ($1, $2, 'Cleanup', 'Test', '{}'::jsonb)`, presentationID, userID); err != nil {
			t.Fatal(err)
		}
		if _, err := database.ExecContext(ctx, `INSERT INTO card_assets (presentation_id, sha256, object_key, mime_type, byte_size, width, height, source) VALUES ($1, $2, $3, 'image/jpeg', $4, 1, 1, '{}'::jsonb)`, presentationID, digest, key, len(body)); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			removedKey = key
			if _, err := database.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
				t.Fatal(err)
			}
		} else {
			keptKey = key
		}
	}
	runImageCleanup(ctx, database)
	if _, err := store.OpenObject(ctx, removedKey); !errors.Is(err, carddocument.ErrObjectNotFound) {
		t.Fatalf("deleted account image survived maintenance: %v", err)
	}
	reader, err := store.OpenObject(ctx, keptKey)
	if err != nil {
		t.Fatalf("another user's image was removed: %v", err)
	}
	reader.Close()
	// Repeating the sweep must also tolerate already-missing objects.
	if _, err := database.ExecContext(ctx, `INSERT INTO card_asset_deletions (object_key) VALUES ($1)`, removedKey); err != nil {
		t.Fatal(err)
	}
	runImageCleanup(ctx, database)
	var queued int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM card_asset_deletions WHERE object_key = $1`, removedKey).Scan(&queued); err != nil || queued != 0 {
		t.Fatalf("missing image was not acknowledged: count %d, error %v", queued, err)
	}
}
