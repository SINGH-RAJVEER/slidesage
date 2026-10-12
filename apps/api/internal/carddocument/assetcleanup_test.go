package carddocument

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

func TestFileBlobStoreDeletesOnlyImageObjects(t *testing.T) {
	store, err := NewFileBlobStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	body := []byte("image")
	key := "presentations/p/assets/" + sha256Hex(body) + ".jpg"
	if err := store.PutImmutable(ctx, key, bytes.NewReader(body), int64(len(body)), "image/jpeg", sha256Hex(body)); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"../escape", "other/" + strings.Repeat("a", 64) + ".jpg"} {
		if err := store.DeleteObject(ctx, invalid); err == nil {
			t.Fatalf("deletion accepted %q", invalid)
		}
	}
	if err := store.DeleteObject(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := store.OpenObject(ctx, key); !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("deleted image remained: %v", err)
	}
	if err := store.DeleteObject(ctx, key); err != nil {
		t.Fatalf("missing image deletion: %v", err)
	}
}

type cleanupTestStore struct {
	memoryStore
	failure error
}

func (store *cleanupTestStore) DeleteObject(_ context.Context, key string) error {
	if store.failure != nil {
		return store.failure
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.objects, key)
	return nil
}

func TestAccountDeletionQueuesStoredImages(t *testing.T) {
	database := integrationDatabase(t)
	userID, presentationID := insertFixture(t, database)
	ctx := context.Background()
	store := &cleanupTestStore{}
	asset, err := PrepareAsset(ctx, store, presentationID, encodedPNG(t, 64, 36, 255), AssetSource{Type: "upload"})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	remote, err := RemoteAsset(presentationID, "https://images.unsplash.com/photo-1", 64, 36, AssetSource{Provider: "unsplash", ProviderID: "photo-1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := RecordAssetsTx(ctx, tx, []Asset{asset, remote}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	rolledBack, err := database.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer rolledBack.Rollback()
	if _, err := rolledBack.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Fatal(err)
	}
	if err := rolledBack.Rollback(); err != nil {
		t.Fatal(err)
	}
	var queued int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM card_asset_deletions WHERE object_key = $1`, asset.ObjectKey).Scan(&queued); err != nil || queued != 0 {
		t.Fatalf("rollback queued image cleanup: count %d, error %v", queued, err)
	}
	if _, err := database.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM card_asset_deletions WHERE object_key = $1`, asset.ObjectKey).Scan(&queued); err != nil {
		t.Fatalf("deleted account lost its image cleanup request: %v", err)
	}
	if queued != 1 {
		t.Fatalf("deleted account queued %d images, want 1", queued)
	}
	var assets int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM card_assets WHERE presentation_id = $1`, presentationID).Scan(&assets); err != nil || assets != 0 {
		t.Fatalf("account deletion left image metadata: count %d, error %v", assets, err)
	}
	store.failure = errors.New("storage unavailable")
	if _, err := CleanupDeletedAssets(ctx, database, store, 100); !errors.Is(err, store.failure) {
		t.Fatalf("cleanup failure = %v", err)
	}
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM card_asset_deletions WHERE object_key = $1`, asset.ObjectKey).Scan(&queued); err != nil || queued != 1 {
		t.Fatalf("failed cleanup lost retry: count %d, error %v", queued, err)
	}
	store.failure = nil
	if _, err := database.ExecContext(ctx, `UPDATE card_asset_deletions SET retry_after = now() WHERE object_key = $1`, asset.ObjectKey); err != nil {
		t.Fatal(err)
	}
	if _, err := CleanupDeletedAssets(ctx, database, store, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := store.OpenObject(ctx, asset.ObjectKey); !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("deleted account image survived: %v", err)
	}
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM card_asset_deletions WHERE object_key = $1`, asset.ObjectKey).Scan(&queued); err != nil || queued != 0 {
		t.Fatalf("successful cleanup left retry: count %d, error %v", queued, err)
	}
}

func TestCleanupDeletedAssetsKeepsReregisteredImages(t *testing.T) {
	database := integrationDatabase(t)
	_, presentationID := insertFixture(t, database)
	ctx := context.Background()
	store := &cleanupTestStore{}
	asset, err := PrepareAsset(ctx, store, presentationID, encodedPNG(t, 64, 36, 255), AssetSource{Type: "upload"})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := RecordAssetsTx(ctx, tx, []Asset{asset}); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO card_asset_deletions (object_key) VALUES ($1)`, asset.ObjectKey); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err := CleanupDeletedAssets(ctx, database, store, 100); err != nil {
		t.Fatal(err)
	}
	reader, err := store.OpenObject(ctx, asset.ObjectKey)
	if err != nil {
		t.Fatalf("live image deleted: %v", err)
	}
	reader.Close()
}
