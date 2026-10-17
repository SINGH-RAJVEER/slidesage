//go:build rustcompat

package carddocument

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func sharedOracleCall(t *testing.T, base, method, token string, status int) any {
	t.Helper()
	request, err := http.NewRequest(method, base+"/shared/"+url.PathEscape(token), nil)
	if err != nil {
		t.Fatal(err)
	}
	// Invalid authentication must not interfere with a public link.
	request.Header.Set("Authorization", "Bearer invalid")
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != status || response.Header.Get("Content-Type") != "application/json" || response.Header.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("%s %s status=%d expected=%d headers=%v body=%s", method, base, response.StatusCode, status, response.Header, raw)
	}
	if method == "HEAD" {
		if len(raw) != 0 {
			t.Fatalf("HEAD body=%s", raw)
		}
		return nil
	}
	if !bytes.HasSuffix(raw, []byte("\n")) {
		t.Fatalf("missing newline %q", raw)
	}
	var decoded any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func TestSharedPresentationMatchesRust(t *testing.T) {
	o := newCurrentOracle(t)
	token, err := newShareToken()
	if err != nil {
		t.Fatal(err)
	}
	o.exec(t, `INSERT INTO presentation_shares(id,presentation_id,token_sha256,created_by) VALUES($1,$2,$3,$4)`, uuid.NewString(), o.id, shareDigest(token), o.owner)
	compare := func(t *testing.T, method, token string, status int) any {
		t.Helper()
		original := sharedOracleCall(t, o.reference, method, token, status)
		rust := sharedOracleCall(t, o.target, method, token, status)
		if !reflect.DeepEqual(original, rust) {
			t.Fatalf("Go=%v Rust=%v", original, rust)
		}
		return rust
	}
	for _, malformed := range []string{"bad", strings.Repeat("A", 42), strings.Repeat("A", 44), token + "=", token[:42] + "+", strings.Repeat("A", 43)} {
		t.Run("invalid "+malformed, func(t *testing.T) { compare(t, "GET", malformed, 404) })
	}
	t.Run("not ready and missing revision", func(t *testing.T) {
		compare(t, "GET", token, 404)
		o.exec(t, `UPDATE presentations SET slides_data='{"status":"ready"}' WHERE id=$1`, o.id)
		compare(t, "GET", token, 404)
		compare(t, "HEAD", token, 404)
	})
	asset, unused := strings.Repeat("a", 64), strings.Repeat("b", 64)
	for _, digest := range []string{asset, unused} {
		o.exec(t, `INSERT INTO card_assets(presentation_id,sha256,mime_type,width,height,source,remote_url) VALUES($1,$2,'image/jpeg',800,600,'{"type":"stock","credit":"<credit> & é","precise":123456789012345678901234567890}','https://images.unsplash.com/photo-card?x=1&y=2')`, o.id, digest)
	}
	document := `{"schemaVersion":3,"cardOrder":["c"],"title":"Shared deck","precise":123456789012345678901234567890,"cards":{"c":{"nodes":[{"type":"image","assetId":"` + asset + `"}]}}}`
	o.commit(t, 1, document)
	t.Run("document and public citations", func(t *testing.T) {
		o.exec(t, `UPDATE presentations SET slides_data='{"status":"ready","sources":[{"url":"https://example.com/a","title":"Source A","snippet":"private notes","rank":1}],"prompt":"private prompt"}' WHERE id=$1`, o.id)
		body := compare(t, "GET", token, 200).(map[string]any)
		if len(body) != 3 || len(body["assets"].(map[string]any)) != 1 || body["document"].(map[string]any)["precise"] != json.Number("123456789012345678901234567890") {
			t.Fatal(body)
		}
		raw, _ := json.Marshal(body)
		for _, private := range []string{o.owner, "provenance", "private notes", "private prompt", "operation", "revision"} {
			if strings.Contains(string(raw), private) {
				t.Fatalf("exposes %s: %s", private, raw)
			}
		}
		compare(t, "HEAD", token, 200)
	})
	for _, sources := range []string{`null`, `true`, `{}`, `123`, `"bad"`, `[]`, `[1,null,[],true,{"url":false,"title":"retained"},{"url":"valid","title":99},{"URL":"first","url":null,"TITLE":"upper","title":"lower"},{"url":"last"}]`} {
		t.Run("sources "+sources, func(t *testing.T) {
			o.exec(t, `UPDATE presentations SET slides_data=jsonb_build_object('status','ready','sources',$1::jsonb) WHERE id=$2`, sources, o.id)
			compare(t, "GET", token, 200)
		})
	}
	t.Run("fresh assets sources and current pointer", func(t *testing.T) {
		o.exec(t, `UPDATE card_assets SET remote_url='https://images.unsplash.com/photo-new',source='{"type":"stock","credit":"Fresh credit"}' WHERE presentation_id=$1 AND sha256=$2`, o.id, asset)
		o.exec(t, `UPDATE presentations SET slides_data='{"status":"ready","sources":[{"url":"fresh"}]}' WHERE id=$1`, o.id)
		o.commit(t, 2, strings.Replace(document, "Shared deck", "New current deck", 1))
		body := compare(t, "GET", token, 200).(map[string]any)
		if body["document"].(map[string]any)["title"] != "New current deck" || body["assets"].(map[string]any)[asset].(map[string]any)["url"] != "https://images.unsplash.com/photo-new" || body["sources"].([]any)[0].(map[string]any)["url"] != "fresh" {
			t.Fatal(body)
		}
	})
	t.Run("ownership never comes from cache", func(t *testing.T) {
		o.exec(t, `UPDATE presentations SET user_id=$1 WHERE id=$2`, o.other, o.id)
		compare(t, "GET", token, 200)
		o.exec(t, `UPDATE presentations SET user_id=$1 WHERE id=$2`, o.owner, o.id)
	})
	t.Run("invalid stored document has the original private error", func(t *testing.T) {
		o.commit(t, 3, `{"schemaVersion":3,"cardOrder":["c"],"cards":{"c":{"nodes":"bad"}}}`)
		body := compare(t, "GET", token, 500)
		if !reflect.DeepEqual(body, map[string]any{"error": map[string]any{"message": "Unable to load the presentation"}}) {
			t.Fatal(body)
		}
		o.exec(t, `UPDATE presentations SET current_card_revision=2 WHERE id=$1`, o.id)
		compare(t, "GET", token, 200)
	})
	t.Run("status revocation and rotation bypass cached body", func(t *testing.T) {
		o.exec(t, `UPDATE presentations SET slides_data='{"status":"generating"}' WHERE id=$1`, o.id)
		compare(t, "GET", token, 404)
		o.exec(t, `UPDATE presentations SET slides_data='{"status":"ready"}' WHERE id=$1`, o.id)
		o.exec(t, `UPDATE presentation_shares SET revoked_at=now() WHERE presentation_id=$1`, o.id)
		compare(t, "GET", token, 404)
		replacement, _ := newShareToken()
		o.exec(t, `INSERT INTO presentation_shares(id,presentation_id,token_sha256,created_by) VALUES($1,$2,$3,$4)`, uuid.NewString(), o.id, shareDigest(replacement), o.owner)
		compare(t, "GET", replacement, 200)
		compare(t, "GET", token, 404)
		token = replacement
	})
	t.Run("Go permissive raw URL spellings hash original bytes", func(t *testing.T) {
		for _, spelling := range []string{strings.Repeat("_", 43), strings.Repeat("A", 20) + "\r\n" + strings.Repeat("A", 23)} {
			if !validShareToken(spelling) {
				t.Fatal("bad oracle token", spelling)
			}
			o.exec(t, `UPDATE presentation_shares SET token_sha256=$1 WHERE presentation_id=$2 AND revoked_at IS NULL`, shareDigest(spelling), o.id)
			compare(t, "GET", spelling, 200)
			expected := 200
			if strings.Contains(spelling, "\r") {
				expected = 404
			}
			compare(t, "GET", strings.ReplaceAll(strings.ReplaceAll(spelling, "\r", ""), "\n", ""), expected)
		}
	})
	t.Run("deleted presentation cannot use cached body", func(t *testing.T) {
		o.exec(t, `DELETE FROM presentations WHERE id=$1`, o.id)
		compare(t, "GET", strings.Repeat("A", 20)+"\r\n"+strings.Repeat("A", 23), 404)
	})
}
