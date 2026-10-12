package carddocument

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestFileBlobStoreRoundTrip(t *testing.T) {
	store, err := NewFileBlobStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	body := []byte("image bytes")
	key := "presentations/p1/assets/" + sha256Hex(body)
	if err := store.PutImmutable(ctx, key, bytes.NewReader(body), int64(len(body)), "image/png", sha256Hex(body)); err != nil {
		t.Fatal(err)
	}
	reader, err := store.OpenObject(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	got, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("read %q, err = %v", got, err)
	}
	if _, err := store.OpenObject(ctx, "presentations/p1/assets/missing"); !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("missing object err = %v", err)
	}
}

func TestFileBlobStoreRejectsMismatchedBytes(t *testing.T) {
	root := t.TempDir()
	store, err := NewFileBlobStore(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	body := []byte("declared")
	digest := sha256Hex(body)
	if err := store.PutImmutable(ctx, "a/short", bytes.NewReader(body[:3]), int64(len(body)), "image/png", digest); !errors.Is(err, ErrObjectSize) {
		t.Fatalf("short body err = %v", err)
	}
	other := []byte("imposter")
	if err := store.PutImmutable(ctx, "a/digest", bytes.NewReader(other), int64(len(other)), "image/png", digest); !errors.Is(err, ErrObjectDigest) {
		t.Fatalf("wrong digest err = %v", err)
	}
	if err := store.PutImmutable(ctx, "a/key", bytes.NewReader(body), int64(len(body)), "image/png", digest); err != nil {
		t.Fatal(err)
	}
	if err := store.PutImmutable(ctx, "a/key", bytes.NewReader(other), int64(len(other)), "image/png", sha256Hex(other)); !errors.Is(err, ErrObjectConflict) {
		t.Fatalf("overwrite err = %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(root, "a"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			t.Fatalf("temporary file %s left behind", entry.Name())
		}
	}
}

func TestFileBlobStoreRejectsEscapingKeys(t *testing.T) {
	store, err := NewFileBlobStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("x")
	for _, key := range []string{"../escape", "/abs", "a/../../b", "a/.hidden", "a\\b", ""} {
		if err := store.PutImmutable(context.Background(), key, bytes.NewReader(body), 1, "image/png", sha256Hex(body)); err == nil {
			t.Fatalf("key %q was accepted", key)
		}
	}
}

func TestPutImmutableTreatsALostRaceAsTheSameObject(t *testing.T) {
	store, err := NewFileBlobStore(t.TempDir())
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
