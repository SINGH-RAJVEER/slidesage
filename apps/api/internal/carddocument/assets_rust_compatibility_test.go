//go:build rustcompat

package carddocument

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/auth"
	"github.com/google/uuid"
)

type assetOracleResponse struct {
	status int
	header http.Header
	body   []byte
}

func assetOracleCall(t *testing.T, base, method, path, token, cookie string, headers http.Header) assetOracleResponse {
	t.Helper()
	request, err := http.NewRequest(method, base+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header = headers.Clone()
	if request.Header == nil {
		request.Header = make(http.Header)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != "" {
		request.Header.Set("Cookie", cookie)
	}
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	selected := make(http.Header)
	for _, name := range []string{"Content-Type", "Cache-Control", "ETag", "X-Content-Type-Options", "Location", "Content-Length"} {
		if values, exists := response.Header[http.CanonicalHeaderKey(name)]; exists {
			selected[http.CanonicalHeaderKey(name)] = values
		}
	}
	return assetOracleResponse{response.StatusCode, selected, body}
}

func TestPresentationAssetsMatchRust(t *testing.T) {
	o := newCurrentOracle(t)
	root := os.Getenv("TEST_PRESENTATION_STORAGE_DIR")
	withoutStorage := strings.TrimRight(os.Getenv("API_WITHOUT_STORAGE_UNDER_TEST_URL"), "/")
	if root == "" || withoutStorage == "" {
		t.Fatal("TEST_PRESENTATION_STORAGE_DIR and API_WITHOUT_STORAGE_UNDER_TEST_URL are required")
	}
	store, err := NewFileBlobStore(root)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := auth.NewService(auth.Config{Database: o.db, AuthSecret: os.Getenv("TEST_AUTH_SECRET"), CookieName: "slidesage_token"})
	if err != nil {
		t.Fatal(err)
	}
	server := func(objects ObjectStore) *httptest.Server {
		mux := http.NewServeMux()
		RegisterRoutes(mux, Handler{DB: o.db, Cache: o.store, Store: objects, Identity: identity.AuthenticatedUserID})
		reference := httptest.NewServer(mux)
		t.Cleanup(reference.Close)
		return reference
	}
	reference, noStoreReference := server(store), server(nil)
	t.Cleanup(func() {
		if err := os.RemoveAll(filepath.Join(root, "presentations", o.id)); err != nil {
			t.Error(err)
		}
	})
	compare := func(t *testing.T, disabled bool, method, path, token, cookie string, headers http.Header, status int) assetOracleResponse {
		t.Helper()
		goBase, rustBase := reference.URL, o.target
		if disabled {
			goBase, rustBase = noStoreReference.URL, withoutStorage
		}
		original := assetOracleCall(t, goBase, method, path, token, cookie, headers)
		rust := assetOracleCall(t, rustBase, method, path, token, cookie, headers)
		if original.status != status {
			t.Fatalf("Go oracle status=%d expected=%d headers=%v body=%q", original.status, status, original.header, original.body)
		}
		if !reflect.DeepEqual(original, rust) {
			t.Fatalf("%s %s\nGo=%+v body=%q\nRust=%+v body=%q", method, path, original, original.body, rust, rust.body)
		}
		return rust
	}
	body := []byte{'P', 'N', 'G', 0, 0xff, '\r', '\n', 0x80}
	digest, remote, unused := sha256Hex(body), strings.Repeat("b", 64), strings.Repeat("c", 64)
	key := "presentations/" + o.id + "/assets/" + digest + ".png"
	if err := store.PutImmutable(context.Background(), key, bytes.NewReader(body), int64(len(body)), "image/png", digest); err != nil {
		t.Fatal(err)
	}
	o.exec(t, `INSERT INTO card_assets(presentation_id,sha256,object_key,mime_type,byte_size,width,height,source) VALUES($1,$2,$3,'image/png',$4,2,1,'{}')`, o.id, digest, key, len(body))
	remoteURL := "https://images.unsplash.com/photo-caf%C3%A9?x=%3Ccredit%3E&y=2"
	for _, id := range []string{remote, unused} {
		o.exec(t, `INSERT INTO card_assets(presentation_id,sha256,mime_type,width,height,source,remote_url) VALUES($1,$2,'image/jpeg',2,1,'{}',$3)`, o.id, id, remoteURL)
	}
	ownerPath := func(id, asset string) string {
		return "/presentations/" + url.PathEscape(id) + "/assets/" + url.PathEscape(asset)
	}
	path := ownerPath(o.id, digest)
	for _, tc := range []struct {
		name, method, path, token, cookie string
		status                            int
	}{
		{"binary", "GET", path, o.token, "", 200},
		{"head", "HEAD", path, o.token, "", 200},
		{"cookie", "GET", path, "", "slidesage_token=" + o.token, 200},
		{"anonymous", "GET", path, "", "", 401},
		{"invalid bearer overrides cookie", "GET", path, "invalid", "slidesage_token=" + o.token, 401},
		{"foreign owner", "GET", path, o.otherToken, "", 404},
		{"missing presentation", "GET", ownerPath("missing", digest), o.token, "", 404},
		{"missing asset", "GET", ownerPath(o.id, strings.Repeat("d", 64)), o.token, "", 404},
		{"invalid digest", "GET", ownerPath(o.id, "invalid"), o.token, "", 404},
		{"uppercase digest", "GET", ownerPath(o.id, strings.ToUpper(digest)), o.token, "", 404},
		{"untrimmed id", "GET", ownerPath(" "+o.id+" ", digest), o.token, "", 404},
		{"redirect", "GET", ownerPath(o.id, remote), o.token, "", 302},
		{"redirect head", "HEAD", ownerPath(o.id, remote), o.token, "", 302},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compare(t, false, tc.method, tc.path, tc.token, tc.cookie, nil, tc.status)
			if tc.name == "binary" && !bytes.Equal(result.body, body) {
				t.Fatal("changed image bytes")
			}
		})
	}
	t.Run("redirect header sanitizes newlines and whitespace", func(t *testing.T) {
		t.Cleanup(func() {
			o.exec(t, `UPDATE card_assets SET remote_url=$1 WHERE presentation_id=$2 AND sha256=$3`, remoteURL, o.id, remote)
		})
		o.exec(t, `UPDATE card_assets SET remote_url=$1 WHERE presentation_id=$2 AND sha256=$3`, "https://images.unsplash.com/photo-café?x=<credit>&y=2\r\nnext\t", o.id, remote)
		compare(t, false, "GET", ownerPath(o.id, remote), o.token, "", nil, 302)
		compare(t, false, "HEAD", ownerPath(o.id, remote), o.token, "", nil, 302)
	})
	etag := `"` + digest + `"`
	for _, tc := range []struct {
		name    string
		headers http.Header
		status  int
	}{
		{"exact etag", http.Header{"If-None-Match": {etag}}, 304},
		{"weak etag ignored", http.Header{"If-None-Match": {"W/" + etag}}, 200},
		{"etag list ignored", http.Header{"If-None-Match": {etag + `, "other"`}}, 200},
		{"etag wildcard ignored", http.Header{"If-None-Match": {"*"}}, 200},
		{"range ignored", http.Header{"Range": {"bytes=0-1"}}, 200},
	} {
		t.Run(tc.name, func(t *testing.T) { compare(t, false, "GET", path, o.token, "", tc.headers, tc.status) })
	}
	t.Run("storage disabled owner precedence", func(t *testing.T) {
		compare(t, true, "GET", path, "", "", nil, 401)
		for _, p := range []string{path, ownerPath("missing", digest), ownerPath(o.id, remote)} {
			compare(t, true, "GET", p, o.otherToken, "", nil, 503)
		}
	})
	token, err := newShareToken()
	if err != nil {
		t.Fatal(err)
	}
	o.exec(t, `INSERT INTO presentation_shares(id,presentation_id,token_sha256,created_by) VALUES($1,$2,$3,$4)`, uuid.NewString(), o.id, shareDigest(token), o.owner)
	sharedPath := func(token, asset string) string {
		return "/shared/" + url.PathEscape(token) + "/assets/" + url.PathEscape(asset)
	}
	t.Run("public requires ready and revision", func(t *testing.T) {
		compare(t, false, "GET", sharedPath(token, digest), "invalid", "", nil, 404)
		o.exec(t, `UPDATE presentations SET slides_data='{"status":"ready"}' WHERE id=$1`, o.id)
		compare(t, false, "GET", sharedPath(token, digest), "invalid", "", nil, 404)
	})
	document := `{"schemaVersion":3,"cardOrder":["c"],"cards":{"c":{"nodes":[{"type":"image","assetId":"` + digest + `"},{"type":"image","assetId":"` + remote + `"}]}}}`
	o.commit(t, 1, document)
	t.Run("public bytes redirects and membership", func(t *testing.T) {
		compare(t, false, "GET", sharedPath(token, digest), "invalid", "", nil, 200)
		compare(t, false, "HEAD", sharedPath(token, digest), "", "", nil, 200)
		compare(t, false, "GET", sharedPath(token, digest), "", "", http.Header{"If-None-Match": {etag}}, 304)
		compare(t, false, "GET", sharedPath(token, remote), "", "", nil, 302)
		compare(t, false, "HEAD", sharedPath(token, remote), "", "", nil, 302)
		compare(t, false, "GET", sharedPath(token, unused), "", "", nil, 404)
		compare(t, false, "GET", sharedPath("invalid", digest), "", "", nil, 404)
		compare(t, true, "GET", sharedPath(token, remote), "", "", nil, 302)
		compare(t, true, "GET", sharedPath(token, digest), "", "", nil, 503)
	})
	t.Run("current document removal is fresh", func(t *testing.T) {
		o.commit(t, 2, `{"schemaVersion":3,"cardOrder":["c"],"cards":{"c":{"nodes":[]}}}`)
		compare(t, false, "GET", sharedPath(token, digest), "", "", http.Header{"If-None-Match": {etag}}, 404)
		compare(t, false, "GET", path, o.token, "", nil, 200)
		o.exec(t, `UPDATE presentations SET current_card_revision=1 WHERE id=$1`, o.id)
	})
	t.Run("owner changes are checked live", func(t *testing.T) {
		o.exec(t, `UPDATE presentations SET user_id=$1 WHERE id=$2`, o.other, o.id)
		compare(t, false, "GET", path, o.token, "", nil, 404)
		compare(t, false, "GET", path, o.otherToken, "", nil, 200)
		compare(t, false, "GET", sharedPath(token, digest), "", "", nil, 200)
		o.exec(t, `UPDATE presentations SET user_id=$1 WHERE id=$2`, o.owner, o.id)
	})
	t.Run("missing corrupt and unsafe object keys", func(t *testing.T) {
		file := filepath.Join(root, filepath.FromSlash(key))
		if err := os.Remove(file); err != nil {
			t.Fatal(err)
		}
		compare(t, false, "GET", path, o.token, "", nil, 500)
		compare(t, false, "GET", sharedPath(token, digest), "", "", nil, 500)
		compare(t, false, "GET", path, o.token, "", http.Header{"If-None-Match": {etag}}, 304)
		corrupt := bytes.Repeat([]byte{'x'}, len(body))
		if err := os.WriteFile(file, corrupt, 0o600); err != nil {
			t.Fatal(err)
		}
		if result := compare(t, false, "GET", path, o.token, "", nil, 200); !bytes.Equal(result.body, corrupt) {
			t.Fatal("read unexpectedly checks stored digest")
		}
		t.Cleanup(func() {
			o.exec(t, `UPDATE card_assets SET object_key=$1 WHERE presentation_id=$2 AND sha256=$3`, key, o.id, digest)
		})
		o.exec(t, `UPDATE card_assets SET object_key=$1 WHERE presentation_id=$2 AND sha256=$3`, key+"/../bad", o.id, digest)
		compare(t, false, "GET", path, o.token, "", nil, 500)
		compare(t, false, "GET", sharedPath(token, digest), "", "", nil, 500)
		o.exec(t, `UPDATE card_assets SET object_key=$1 WHERE presentation_id=$2 AND sha256=$3`, key, o.id, digest)
	})
	t.Run("status revocation rotation and deletion stay live", func(t *testing.T) {
		o.exec(t, `UPDATE presentations SET slides_data='{"status":"generating"}' WHERE id=$1`, o.id)
		compare(t, false, "GET", sharedPath(token, digest), "", "", http.Header{"If-None-Match": {etag}}, 404)
		o.exec(t, `UPDATE presentations SET slides_data='{"status":"ready"}' WHERE id=$1`, o.id)
		o.exec(t, `UPDATE presentation_shares SET revoked_at=now() WHERE presentation_id=$1`, o.id)
		compare(t, false, "GET", sharedPath(token, digest), "", "", nil, 404)
		replacement, err := newShareToken()
		if err != nil {
			t.Fatal(err)
		}
		o.exec(t, `INSERT INTO presentation_shares(id,presentation_id,token_sha256,created_by) VALUES($1,$2,$3,$4)`, uuid.NewString(), o.id, shareDigest(replacement), o.owner)
		compare(t, false, "GET", sharedPath(replacement, digest), "", "", nil, 200)
		compare(t, false, "GET", sharedPath(token, digest), "", "", nil, 404)
		o.exec(t, `DELETE FROM presentations WHERE id=$1`, o.id)
		compare(t, false, "GET", path, o.token, "", nil, 404)
		compare(t, false, "GET", sharedPath(replacement, digest), "", "", nil, 404)
	})
}
