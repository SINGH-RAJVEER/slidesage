//go:build rustcompat

package presentation

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/auth"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Run the original routes and Rust against the same disposable, migrated database.
// Mutation fixtures are recreated before each server to preserve identical inputs.
func TestPresentationRoutesMatchRust(t *testing.T) {
	target := os.Getenv("API_UNDER_TEST_URL")
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		t.Fatal("API_UNDER_TEST_URL must point to the test Rust API")
	}
	if os.Getenv("TEST_DATABASE_URL") == "" || os.Getenv("TEST_AUTH_SECRET") == "" {
		t.Fatal("TEST_DATABASE_URL and TEST_AUTH_SECRET are required for the disposable test API")
	}
	db, err := sql.Open("pgx", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(t *testing.T, query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	owner := "presentation-compat-" + uuid.NewString()
	other := owner + "-other"
	exec(t, `INSERT INTO users (id, name, email) VALUES ($1, 'Presentation fixture', $1 || '@example.test'), ($2, 'Foreign fixture', $2 || '@example.test')`, owner, other)
	defer func() {
		for _, query := range []string{
			`DELETE FROM users WHERE id IN ($1, $2)`,
			`DELETE FROM presentation_cache_versions WHERE user_id IN ($1, $2)`,
		} {
			if _, err := db.Exec(query, owner, other); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
		if _, err := db.Exec(`DELETE FROM card_asset_deletions WHERE object_key LIKE $1`, "presentations/"+owner+"%"); err != nil {
			t.Error(err)
		}
	}()
	cookieName := os.Getenv("TEST_COOKIE_NAME")
	if cookieName == "" {
		cookieName = "slidesage_token"
	}
	identity, err := auth.NewService(auth.Config{Database: db, AuthSecret: os.Getenv("TEST_AUTH_SECRET"), CookieName: cookieName})
	if err != nil {
		t.Fatal(err)
	}
	tokenFor := func(user string) string {
		t.Helper()
		token, err := identity.GenerateJWT(user, "", time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	token, foreignToken := "Bearer "+tokenFor(owner), "Bearer "+tokenFor(other)
	mux := http.NewServeMux()
	// Reuse the existing cache fixture so committed-write comparisons exercise invalidation.
	referenceService := NewService(NewRepository(db)).WithCache(&listCache{values: map[string][]byte{}})
	RegisterRoutes(mux, referenceService, func(_ context.Context, request *http.Request) (string, error) {
		return identity.AuthenticatedUserID(request)
	}, NewExaResearchService("", nil), db)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": "Resource not found"}})
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	sources := []struct{ name, base string }{{"Go", server.URL}, {"Rust", strings.TrimRight(target, "/")}}
	transport := &http.Transport{ResponseHeaderTimeout: 5 * time.Second}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	request := func(t *testing.T, base, method, path, authorization, cookie string, status int) any {
		t.Helper()
		req, err := http.NewRequest(method, base+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		if authorization != "" {
			req.Header.Set("Authorization", authorization)
		}
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != status {
			t.Fatalf("%s %s status=%d want=%d body=%s", method, path, res.StatusCode, status, body)
		}
		if status == 204 {
			if len(body) != 0 || res.Header.Get("Content-Type") != "" {
				t.Fatalf("invalid empty deletion response: %q, %v", body, res.Header)
			}
			return nil
		}
		contentType := "application/json; charset=utf-8"
		if status == 404 && method == "POST" {
			contentType = "application/json"
		}
		if res.Header.Get("Content-Type") != contentType {
			t.Fatalf("Content-Type=%q", res.Header.Get("Content-Type"))
		}
		if method == "HEAD" {
			if len(body) != 0 {
				t.Fatalf("HEAD body=%q", body)
			}
			return nil
		}
		if len(body) == 0 || body[len(body)-1] != '\n' {
			t.Fatalf("missing JSON newline: %q", body)
		}
		if strings.ContainsAny(string(body), "<>&\u2028\u2029") {
			t.Fatalf("Go JSON escaping missing: %s", body)
		}
		var result any
		decoder := json.NewDecoder(strings.NewReader(string(body)))
		decoder.UseNumber()
		if err := decoder.Decode(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	compare := func(t *testing.T, method, path, authorization, cookie string, status int) map[string]any {
		t.Helper()
		var reference any
		for index, source := range sources {
			got := request(t, source.base, method, path, authorization, cookie, status)
			if index == 0 {
				reference = got
			} else if !reflect.DeepEqual(got, reference) {
				t.Fatalf("Rust=%v\nGo=%v", got, reference)
			}
		}
		if reference == nil {
			return nil
		}
		return reference.(map[string]any)
	}
	seed := func(t *testing.T, id, user, document string) {
		exec(t, `INSERT INTO presentations (id, user_id, title, prompt, slides_data, created_at, updated_at) VALUES ($1,$2,'A <deck> & title','Prompt with Unicode é and separator ' || chr(8232),$3::jsonb,'2026-01-02 03:04:05.123400','2026-01-03 00:00:00')`, id, user, document)
	}
	a, b, c, foreign := owner+"-a", owner+"-b", owner+"-c", owner+"-foreign"
	seed(t, a, owner, `{"totalSlides":2,"sources":[{}]}`)
	seed(t, b, owner, `{"status":"generating","totalSlides":3}`)
	seed(t, c, owner, `{"status":"failed","failure":{"retry":{"research_payload":{"sources":[{}]}}}}`)
	seed(t, foreign, other, `{"status":"ready","totalSlides":10}`)
	for _, tc := range []struct {
		name, method, path, auth, cookie string
		status                           int
	}{
		{"anonymous list", "GET", "/presentations", "", "", 401},
		{"auth before pagination", "GET", "/presentations?limit=bad", "", "", 401},
		{"list", "GET", "/presentations", token, "", 200},
		{"empty list", "GET", "/presentations", "Bearer " + tokenFor(owner+"-missing"), "", 200},
		{"pagination", "GET", "/presentations?limit=1&offset=1", token, "", 200},
		{"empty page", "GET", "/presentations?offset=100", token, "", 200},
		{"largest offset", "GET", "/presentations?offset=9223372036854775807", token, "", 200},
		{"first repeated value", "GET", "/presentations?limit=1&limit=2", token, "", 200},
		{"empty defaults", "GET", "/presentations?limit=&offset=", token, "", 200},
		{"signed integers", "GET", "/presentations?limit=%2B01&offset=-0", token, "", 200},
		{"encoded query key", "GET", "/presentations?%6cimit=1", token, "", 200},
		{"invalid pair ignored", "GET", "/presentations?limit=%zz&limit=1", token, "", 200},
		{"semicolon pair ignored", "GET", "/presentations?limit=1;bad&offset=1", token, "", 200},
		{"limit zero", "GET", "/presentations?limit=0", token, "", 400},
		{"limit too large", "GET", "/presentations?limit=101", token, "", 400},
		{"limit text", "GET", "/presentations?limit=no", token, "", 400},
		{"limit whitespace", "GET", "/presentations?limit=+1", token, "", 400},
		{"limit fraction", "GET", "/presentations?limit=1.0", token, "", 400},
		{"limit overflow", "GET", "/presentations?limit=9223372036854775808", token, "", 400},
		{"offset negative", "GET", "/presentations?offset=-1", token, "", 400},
		{"offset whitespace", "GET", "/presentations?offset=%C2%A0", token, "", 400},
		{"offset overflow", "GET", "/presentations?offset=9223372036854775808", token, "", 400},
		{"cookie list", "GET", "/presentations", "", cookieName + "=" + strings.TrimPrefix(token, "Bearer "), 200},
		{"invalid bearer blocks cookie", "GET", "/presentations", "Bearer bad", cookieName + "=" + strings.TrimPrefix(token, "Bearer "), 401},
		{"anonymous detail", "GET", "/presentations/" + a, "", "", 401},
		{"detail", "GET", "/presentations/" + a, token, "", 200},
		{"foreign detail", "GET", "/presentations/" + a, foreignToken, "", 403},
		{"missing detail", "GET", "/presentations/missing", token, "", 404},
		{"blank detail id", "GET", "/presentations/%20", token, "", 400},
		{"trimmed detail id", "GET", "/presentations/%20" + a + "%20", token, "", 200},
		{"head list", "HEAD", "/presentations", token, "", 200},
		{"head detail", "HEAD", "/presentations/" + a, token, "", 200},
		{"unsupported method", "POST", "/presentations", token, "", 404},
		{"anonymous delete", "DELETE", "/presentations/" + a, "", "", 401},
		{"foreign delete", "DELETE", "/presentations/" + a, foreignToken, "", 403},
		{"missing delete", "DELETE", "/presentations/missing", token, "", 404},
		{"blank delete id", "DELETE", "/presentations/%20", token, "", 400},
	} {
		t.Run(tc.name, func(t *testing.T) { compare(t, tc.method, tc.path, tc.auth, tc.cookie, tc.status) })
	}
	t.Run("order counts and no cross-user rows", func(t *testing.T) {
		got := compare(t, "GET", "/presentations?limit=2", token, "", 200)
		rows := got["presentations"].([]any)
		if len(rows) != 2 || rows[0].(map[string]any)["id"] != c || rows[1].(map[string]any)["id"] != b || got["total"] != json.Number("3") || got["has_more"] != true {
			t.Fatal(got)
		}
		empty := compare(t, "GET", "/presentations?offset=100", token, "", 200)
		if len(empty["presentations"].([]any)) != 0 || empty["has_more"] != false {
			t.Fatal(empty)
		}
	})
	for _, tc := range []struct {
		name, document, status string
		count                  int64
		research               bool
	}{
		{"normal", `{"totalSlides":2,"sources":[{}]}`, "ready", 2, true},
		{"failed retry", `{"status":"failed","sources":[],"failure":{"retry":{"research_payload":{"sources":[null]}}}}`, "failed", 0, true},
		{"failed ignores top-level research", `{"status":"failed","sources":[{}]}`, "failed", 0, false},
		{"generating", `{"status":"generating","totalSlides":3}`, "generating", 3, false},
		{"unknown status", `{"status":"queued","totalSlides":-4}`, "ready", -4, false},
		{"partial decoding", `{"totalSlides":1.5,"status":"generating","sources":[false]}`, "generating", 0, true},
		{"null", `null`, "ready", 0, false},
		{"array", `[]`, "ready", 0, false},
		{"case folding", `{"TOTALSLIDES":5,"STATUS":"failed","FAILURE":{"RETRY":{"RESEARCH_PAYLOAD":{"SOURCES":[1]}}}}`, "failed", 5, true},
		{"long s folding", `{"totalSlideſ":6,"ſtatuſ":"generating"}`, "generating", 6, false},
		{"bad later field preserves earlier", `{"TOTALSLIDES":9,"totalSlides":"bad"}`, "ready", 9, false},
		{"null array clears earlier", `{"Sources":[1],"sources":null}`, "ready", 0, false},
		{"null struct preserves earlier", `{"status":"failed","FAILURE":{"retry":{"research_payload":{"sources":[1]}}},"failure":null}`, "failed", 0, true},
	} {
		t.Run("summary/"+tc.name, func(t *testing.T) {
			exec(t, `UPDATE presentations SET slides_data=$1::jsonb WHERE id=$2`, tc.document, a)
			got := compare(t, "GET", "/presentations", token, "", 200)
			for _, row := range got["presentations"].([]any) {
				item := row.(map[string]any)
				if item["id"] == a && (item["status"] != tc.status || item["slide_count"] != json.Number(strconv.FormatInt(tc.count, 10)) || item["has_research"] != tc.research) {
					t.Fatal(item)
				}
			}
		})
	}
	t.Run("raw detail preserves numbers", func(t *testing.T) {
		exec(t, `UPDATE presentations SET slides_data='{"precise":123456789012345678901234567890,"nested":{"text":"<test>"}}' WHERE id=$1`, a)
		got := compare(t, "GET", "/presentations/"+a, token, "", 200)
		if got["presentation"].(map[string]any)["slides_data"].(map[string]any)["precise"] != json.Number("123456789012345678901234567890") {
			t.Fatal(got)
		}
	})
	t.Run("committed writes and ownership transfer", func(t *testing.T) {
		compare(t, "GET", "/presentations", token, "", 200)
		exec(t, `UPDATE presentations SET title='Worker write' WHERE id=$1`, a)
		got := compare(t, "GET", "/presentations/"+a, token, "", 200)
		if got["presentation"].(map[string]any)["title"] != "Worker write" {
			t.Fatal(got)
		}
		compare(t, "GET", "/presentations", token, "", 200)
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(`UPDATE presentations SET title='Rolled back' WHERE id=$1`, a); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Rollback(); err != nil {
			t.Fatal(err)
		}
		compare(t, "GET", "/presentations", token, "", 200)
		exec(t, `UPDATE presentations SET user_id=$1 WHERE id=$2`, other, a)
		compare(t, "GET", "/presentations/"+a, token, "", 403)
		compare(t, "GET", "/presentations/"+a, foreignToken, "", 200)
		compare(t, "GET", "/presentations", token, "", 200)
		compare(t, "GET", "/presentations", foreignToken, "", 200)
		exec(t, `UPDATE presentations SET user_id=$1 WHERE id=$2`, owner, a)
	})
	t.Run("deletion guards cascades and cleanup queue", func(t *testing.T) {
		id, child, operation := owner+"-delete", owner+"-child", owner+"-operation"
		digest := strings.Repeat("a", 64)
		objectKey := "presentations/" + id + "/assets/" + digest + ".jpg"
		shareDigest := sha256.Sum256([]byte(owner + "-share"))
		var deletionError any
		for _, source := range sources {
			t.Run(source.name, func(t *testing.T) {
				seed(t, id, owner, `{}`)
				exec(t, `INSERT INTO card_assets(presentation_id,sha256,object_key,mime_type,byte_size,width,height,source) VALUES ($1,$2,$3,'image/jpeg',10,1,1,'{}')`, id, digest, objectKey)
				exec(t, `INSERT INTO presentation_shares(id,presentation_id,token_sha256,created_by) VALUES($1,$2,$3,$4)`, uuid.NewString(), id, hex.EncodeToString(shareDigest[:]), owner)
				exec(t, `INSERT INTO generation_point_operations(id,user_id,presentation_id,kind,idempotency_key,request_hash,pricing_version,quoted_millis) VALUES($1::text,$2,$3,'generation',$1::text,$4,'fixture',1000)`, operation, owner, id, digest)
				request(t, source.base, "DELETE", "/presentations/"+id, token, "", 409)
				request(t, source.base, "DELETE", "/presentations/"+id, foreignToken, "", 403)
				exec(t, `UPDATE generation_point_operations SET status='refunded',charged_millis=0,finalized_at=now() WHERE id=$1`, operation)
				seed(t, child, owner, `{}`)
				exec(t, `UPDATE presentations SET parent_presentation_id=$1 WHERE id=$2`, id, child)
				// A failed DELETE must roll back both cascades and queue/cache triggers.
				var before, after int64
				if err := db.QueryRow(`SELECT version FROM presentation_cache_versions WHERE user_id=$1`, owner).Scan(&before); err != nil {
					t.Fatal(err)
				}
				body := request(t, source.base, "DELETE", "/presentations/"+id, token, "", 400)
				if deletionError == nil {
					deletionError = body
				} else if !reflect.DeepEqual(body, deletionError) {
					t.Fatalf("Rust deletion error=%v, Go=%v", body, deletionError)
				}
				message := body.(map[string]any)["error"].(map[string]any)["message"].(string)
				if !strings.Contains(message, "SQLSTATE 23503") || !strings.HasPrefix(message, "delete presentation: ERROR:") {
					t.Fatal(message)
				}
				var queued int
				if err := db.QueryRow(`SELECT count(*) FROM card_asset_deletions WHERE object_key=$1`, objectKey).Scan(&queued); err != nil {
					t.Fatal(err)
				}
				if err := db.QueryRow(`SELECT version FROM presentation_cache_versions WHERE user_id=$1`, owner).Scan(&after); err != nil {
					t.Fatal(err)
				}
				if queued != 0 || after != before {
					t.Fatalf("failed deletion queued=%d version=%d want=%d", queued, after, before)
				}
				exec(t, `DELETE FROM presentations WHERE id=$1`, child)
				request(t, source.base, "DELETE", "/presentations/"+id, token, "", 204)
				for _, table := range []string{"presentations", "card_assets", "presentation_shares"} {
					column := "presentation_id"
					if table == "presentations" {
						column = "id"
					}
					var count int
					if err := db.QueryRow("SELECT count(*) FROM "+table+" WHERE "+column+"=$1", id).Scan(&count); err != nil {
						t.Fatal(err)
					}
					if count != 0 {
						t.Fatalf("%s rows remain: %d", table, count)
					}
				}
				if err := db.QueryRow(`SELECT count(*) FROM card_asset_deletions WHERE object_key=$1`, objectKey).Scan(&queued); err != nil {
					t.Fatal(err)
				}
				if err := db.QueryRow(`SELECT version FROM presentation_cache_versions WHERE user_id=$1`, owner).Scan(&after); err != nil {
					t.Fatal(err)
				}
				if queued != 1 || after <= before {
					t.Fatalf("deletion queued=%d cache version=%d", queued, after)
				}
				var retained sql.NullString
				if err := db.QueryRow(`SELECT presentation_id FROM generation_point_operations WHERE id=$1`, operation).Scan(&retained); err != nil {
					t.Fatal(err)
				}
				if retained.Valid {
					t.Fatal("finalized operation retained deleted presentation")
				}
				request(t, source.base, "DELETE", "/presentations/"+id, token, "", 404)
				exec(t, `DELETE FROM card_asset_deletions WHERE object_key=$1`, objectKey)
				exec(t, `DELETE FROM generation_point_operations WHERE id=$1`, operation)
			})
		}
	})
}
