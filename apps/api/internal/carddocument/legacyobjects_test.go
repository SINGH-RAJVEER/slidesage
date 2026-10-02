package carddocument

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
)

func TestDeleteLegacyObjectsKeepsImages(t *testing.T) {
	if os.Getenv("STORAGE_EMULATOR_HOST") == "" {
		t.Skip("STORAGE_EMULATOR_HOST is not set")
	}
	ctx := context.Background()
	store, err := NewGCSBlobStore(ctx, os.Getenv("PRESENTATION_GCS_BUCKET"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	put := func(key string) {
		body := []byte(key)
		if err := store.PutImmutable(ctx, key, bytes.NewReader(body), int64(len(body)), "application/octet-stream", sha256Hex(body)); err != nil {
			t.Fatal(err)
		}
	}
	legacy := []string{
		"presentations/legacy-test/objects/deck.pptx",
		"presentations/legacy-test/revisions/1/previews/0.webp",
		"presentations/legacy-test/cards/body.json",
	}
	image := "presentations/legacy-test/assets/photo.jpg"
	for _, key := range append(legacy, image) {
		put(key)
	}

	if deleted, err := store.DeleteLegacyObjects(ctx); err != nil || deleted < len(legacy) {
		t.Fatalf("deleted %d, err = %v", deleted, err)
	}
	for _, key := range legacy {
		if _, err := store.OpenObject(ctx, key); !errors.Is(err, ErrObjectNotFound) {
			t.Fatalf("%s survived: %v", key, err)
		}
	}
	reader, err := store.OpenObject(ctx, image)
	if err != nil {
		t.Fatalf("image deleted: %v", err)
	}
	reader.Close()
	if deleted, err := store.DeleteLegacyObjects(ctx); err != nil || deleted != 0 {
		t.Fatalf("second pass deleted %d, err = %v", deleted, err)
	}
}
