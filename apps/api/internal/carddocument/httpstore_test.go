package carddocument

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPBlobStoreValidatesBeforeSendingAndPreservesFailures(t *testing.T) {
	data := []byte("image bytes")
	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])
	key := "presentations/deck/assets/" + digest + ".png"
	token := strings.Repeat("s", 32)
	calls := 0
	status := http.StatusNoContent
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer "+token || r.URL.Path != "/objects/"+key {
			t.Error("gateway credential or object path missing")
		}
		if r.Method == http.MethodPut {
			body, _ := io.ReadAll(r.Body)
			if !bytes.Equal(body, data) || r.Header.Get("X-Object-SHA256") != digest {
				t.Error("write changed the object or digest")
			}
		}
		w.WriteHeader(status)
		if status == http.StatusOK {
			_, _ = w.Write(data)
		}
	}))
	defer server.Close()
	store, err := NewHTTPBlobStore(server.URL+"/objects", token, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := store.PutImmutable(ctx, key, bytes.NewReader(data), int64(len(data)+1), "image/png", digest); !errors.Is(err, ErrObjectSize) {
		t.Fatalf("size check: %v", err)
	}
	if err := store.PutImmutable(ctx, key, bytes.NewReader(data), int64(len(data)), "image/png", strings.Repeat("0", 64)); !errors.Is(err, ErrObjectDigest) {
		t.Fatalf("digest check: %v", err)
	}
	if calls != 0 {
		t.Fatal("invalid content reached remote storage")
	}
	if err := store.PutImmutable(ctx, key, bytes.NewReader(data), int64(len(data)), "image/png", digest); err != nil {
		t.Fatal(err)
	}
	status = http.StatusConflict
	if err := store.PutImmutable(ctx, key, bytes.NewReader(data), int64(len(data)), "image/png", digest); !errors.Is(err, ErrObjectConflict) {
		t.Fatalf("conflict: %v", err)
	}
	status = http.StatusOK
	body, err := store.OpenObject(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(body)
	body.Close()
	if !bytes.Equal(got, data) {
		t.Fatal("read changed image")
	}
	status = http.StatusNotFound
	if _, err := store.OpenObject(ctx, key); !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("missing: %v", err)
	}
	status = http.StatusNoContent
	if err := store.DeleteObject(ctx, key); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteObject(ctx, "../secret"); err == nil {
		t.Fatal("unsafe deletion accepted")
	}
}

func TestHTTPBlobStoreDoesNotFollowRedirects(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("followed storage redirect") }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	store, err := NewHTTPBlobStore(redirect.URL, strings.Repeat("s", 32), redirect.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.OpenObject(context.Background(), "presentations/deck/assets/"+strings.Repeat("0", 64)+".png")
	if err == nil {
		t.Fatal("redirect accepted")
	}
}
