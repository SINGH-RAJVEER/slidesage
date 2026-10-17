//go:build rustcompat

package carddocument

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/auth"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cache"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type currentOracle struct {
	db                                                     *sql.DB
	owner, other, id, token, otherToken, reference, target string
	store                                                  cache.Store
}

func newCurrentOracle(t *testing.T) *currentOracle {
	t.Helper()
	for _, name := range []string{"API_UNDER_TEST_URL", "TEST_DATABASE_URL", "TEST_AUTH_SECRET", "TEST_VALKEY_ADDR"} {
		if os.Getenv(name) == "" {
			t.Fatalf("%s is required", name)
		}
	}
	t.Setenv("CACHE_VALKEY_ADDR", os.Getenv("TEST_VALKEY_ADDR"))
	t.Setenv("CACHE_VALKEY_AUTH", "")
	t.Setenv("CACHE_VALKEY_PASSWORD", "")
	t.Setenv("CACHE_VALKEY_CA_PEM", "")
	t.Setenv("CACHE_TIMEOUT_MS", "500")
	t.Setenv("NODE_ENV", "test")
	store, err := cache.FromEnv()
	if err != nil || store == nil {
		t.Fatal("Go native cache", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	db, err := sql.Open("pgx", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	o := &currentOracle{db: db, store: store, owner: "card-read-é-" + uuid.NewString(), target: strings.TrimRight(os.Getenv("API_UNDER_TEST_URL"), "/")}
	o.other, o.id = o.owner+"-other", o.owner+"-deck"
	o.exec(t, `INSERT INTO users (id,name,email) VALUES ($1,'Card read',$1 || '@test.invalid'),($2,'Other',$2 || '@test.invalid')`, o.owner, o.other)
	o.exec(t, `INSERT INTO presentations (id,user_id,title,prompt,slides_data) VALUES ($1,$2,'Cards','Prompt','{}')`, o.id, o.owner)
	t.Cleanup(func() {
		for _, query := range []string{`DELETE FROM users WHERE id IN ($1,$2)`, `DELETE FROM presentation_cache_versions WHERE user_id IN ($1,$2)`} {
			if _, err := db.Exec(query, o.owner, o.other); err != nil {
				t.Error(err)
			}
		}
		if _, err := db.Exec(`DELETE FROM card_asset_deletions WHERE object_key LIKE $1`, "presentations/"+o.id+"/%"); err != nil {
			t.Error(err)
		}
	})
	identity, err := auth.NewService(auth.Config{Database: db, AuthSecret: os.Getenv("TEST_AUTH_SECRET"), CookieName: "slidesage_token"})
	if err != nil {
		t.Fatal(err)
	}
	for index, user := range []string{o.owner, o.other} {
		token, err := identity.GenerateJWT(user, "", time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			o.token = token
		} else {
			o.otherToken = token
		}
	}
	mux := http.NewServeMux()
	RegisterRoutes(mux, Handler{DB: db, Cache: store, Identity: identity.AuthenticatedUserID})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	o.reference = server.URL
	return o
}

func (o *currentOracle) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := o.db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func (o *currentOracle) commit(t *testing.T, number int, document string) {
	t.Helper()
	tx, err := o.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var base any
	if number > 1 {
		base = number - 1
	}
	_, err = tx.Exec(`INSERT INTO card_revisions(presentation_id,revision,sha256,byte_size,card_count,schema_version,author_id,operation_kind,operation_id,base_revision,document,created_at) VALUES($1,$2,$3,$4,1,3,$5,'generation',$6,$7,$8::jsonb,'2026-01-02 03:04:05.123456+00')`, o.id, number, sha256Hex([]byte(document)), len(document), o.owner, "read-"+strconv.Itoa(number), base, document)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE presentations SET current_card_revision=$1 WHERE id=$2`, number, o.id); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func (o *currentOracle) request(t *testing.T, base, method, id, token, cookie string, status int) any {
	t.Helper()
	request, err := http.NewRequest(method, base+"/presentations/"+id+"/document", nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != "" {
		request.Header.Set("Cookie", cookie)
	}
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != status || response.Header.Get("Content-Type") != "application/json" || response.Header.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("%s: status=%d headers=%v body=%s", base, response.StatusCode, response.Header, body)
	}
	if method == http.MethodHead {
		if len(body) != 0 {
			t.Fatalf("HEAD has body %s", body)
		}
		return nil
	}
	if !bytes.HasSuffix(body, []byte("\n")) {
		t.Fatalf("JSON lacks Go newline: %q", body)
	}
	var decoded any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func (o *currentOracle) compare(t *testing.T, method, id, token, cookie string, status int) any {
	t.Helper()
	reference := o.request(t, o.reference, method, id, token, cookie, status)
	rust := o.request(t, o.target, method, id, token, cookie, status)
	if !reflect.DeepEqual(rust, reference) {
		t.Fatalf("Rust=%v\nGo=%v", rust, reference)
	}
	return rust
}

func TestCurrentCardDocumentMatchesRust(t *testing.T) {
	o := newCurrentOracle(t)
	for _, tc := range []struct {
		name, id, token, cookie string
		status                  int
	}{
		{"anonymous", o.id, "", "", 401},
		{"invalid bearer", o.id, "bad", "slidesage_token=" + o.token, 401},
		{"no saved revision", o.id, o.token, "", 409},
		{"foreign no revision", o.id, o.otherToken, "", 404},
		{"missing", "missing", o.token, "", 404},
		{"untrimmed id", "%20" + o.id + "%20", o.token, "", 404},
	} {
		t.Run(tc.name, func(t *testing.T) { o.compare(t, "GET", tc.id, tc.token, tc.cookie, tc.status) })
	}
	a, b, unused := strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64)
	for _, asset := range []struct{ id, url string }{{a, ""}, {b, "https://images.unsplash.com/photo-card?x=1&y=2"}, {unused, ""}} {
		if asset.url == "" {
			o.exec(t, `INSERT INTO card_assets(presentation_id,sha256,object_key,mime_type,byte_size,width,height,source) VALUES($1,$2,$3,'image/png',99,640,360,'{"type":"upload","precise":123456789012345678901234567890,"credit":"<Photo> & é"}')`, o.id, asset.id, "presentations/"+o.id+"/assets/"+asset.id+".png")
		} else {
			o.exec(t, `INSERT INTO card_assets(presentation_id,sha256,mime_type,width,height,source,remote_url) VALUES($1,$2,'image/jpeg',2400,1600,'{"type":"stock"}',$3)`, o.id, asset.id, asset.url)
		}
	}
	document := `{"schemaVersion":3,"cardOrder":["c_aaaaaaaa"],"title":"<Deck> & é  ","precise":123456789012345678901234567890,"cards":{"c_aaaaaaaa":{"nodes":[{"type":"image","assetId":"` + b + `"},{"type":"image","assetId":"` + a + `"},{"type":"image","assetId":"` + b + `"},{"type":"heading"}]}}}`
	o.commit(t, 1, document)
	for _, tc := range []struct {
		name, method, id, token, cookie string
		status                          int
	}{
		{"saved document", "GET", o.id, o.token, "", 200},
		{"cookie document", "GET", o.id, "", "slidesage_token=" + o.token, 200},
		{"foreign document", "GET", o.id, o.otherToken, "", 404},
		{"head document", "HEAD", o.id, o.token, "", 200},
	} {
		t.Run(tc.name, func(t *testing.T) { o.compare(t, tc.method, tc.id, tc.token, tc.cookie, tc.status) })
	}
	t.Run("raw precision and referenced assets", func(t *testing.T) {
		body := o.compare(t, "GET", o.id, o.token, "", 200).(map[string]any)
		assets := body["assets"].(map[string]any)
		if len(assets) != 2 || assets[a].(map[string]any)["source"].(map[string]any)["precise"] != json.Number("123456789012345678901234567890") || body["document"].(map[string]any)["precise"] != json.Number("123456789012345678901234567890") {
			t.Fatal(body)
		}
		revision := body["revision"].(map[string]any)
		if _, exists := revision["baseRevision"]; exists {
			t.Fatal("initial revision exposes base", revision)
		}
		if revision["sha256"] != sha256Hex([]byte(document)) || revision["byteSize"] != json.Number(strconv.Itoa(len(document))) {
			t.Fatal(revision)
		}
	})
	t.Run("assets remain fresh on a cached body", func(t *testing.T) {
		o.exec(t, `UPDATE card_assets SET source='{"type":"stock","photographer":"Fresh credit"}',remote_url='https://images.unsplash.com/photo-new' WHERE presentation_id=$1 AND sha256=$2`, o.id, b)
		body := o.compare(t, "GET", o.id, o.token, "", 200).(map[string]any)
		if body["assets"].(map[string]any)[b].(map[string]any)["url"] != "https://images.unsplash.com/photo-new" {
			t.Fatal(body)
		}
	})
	t.Run("current pointer and base revision", func(t *testing.T) {
		o.commit(t, 2, strings.Replace(document, "<Deck>", "New head", 1))
		body := o.compare(t, "GET", o.id, o.token, "", 200).(map[string]any)
		if body["revision"].(map[string]any)["revision"] != json.Number("2") || body["revision"].(map[string]any)["baseRevision"] != json.Number("1") {
			t.Fatal(body)
		}
	})
	t.Run("cached body does not retain ownership", func(t *testing.T) {
		o.exec(t, `UPDATE presentations SET user_id=$1 WHERE id=$2`, o.other, o.id)
		o.compare(t, "GET", o.id, o.token, "", 404)
		o.compare(t, "GET", o.id, o.otherToken, "", 200)
		o.exec(t, `UPDATE presentations SET user_id=$1 WHERE id=$2`, o.owner, o.id)
	})
	t.Run("deleted presentation cannot use cache", func(t *testing.T) {
		o.exec(t, `DELETE FROM presentations WHERE id=$1`, o.id)
		o.compare(t, "GET", o.id, o.token, "", 404)
	})
}

func TestRustCurrentCardDocumentSharesGoCache(t *testing.T) {
	o := newCurrentOracle(t)
	document := `{"schemaVersion":3,"cardOrder":["c_aaaaaaaa"],"title":"Database body","cards":{"c_aaaaaaaa":{}}}`
	o.commit(t, 1, document)
	ctx := context.Background()
	counted := &bodyCountingDB{DB: o.db}
	first, err := CachedCurrentRevision(ctx, counted, o.id, o.owner, o.store)
	if err != nil || counted.bodyReads != 1 {
		t.Fatal("Go fill", err, counted.bodyReads)
	}
	key := cache.Key("card-body", o.owner, o.id, "1", first.SHA256)
	t.Cleanup(func() {
		client := redis.NewClient(&redis.Options{Addr: os.Getenv("TEST_VALKEY_ADDR"), Protocol: 2})
		defer client.Close()
		_ = client.Del(ctx, key).Err()
	})
	marker := []byte(strings.Replace(document, "Database body", "Native Valkey <é> body", 1))
	o.store.Set(ctx, key, marker, time.Hour)
	body := o.request(t, o.target, "GET", o.id, o.token, "", 200).(map[string]any)
	if body["document"].(map[string]any)["title"] != "Native Valkey <é> body" {
		t.Fatal("Rust did not consume Go native key/payload", body)
	}
	digest := strings.Repeat("d", 64)
	o.exec(t, `INSERT INTO card_assets(presentation_id,sha256,mime_type,width,height,source,remote_url) VALUES($1,$2,'image/jpeg',10,10,'{}','https://images.unsplash.com/cache')`, o.id, digest)
	// Each valid cache body is decoded with Go's partial struct rules, while raw
	// numeric tokens and unknown fields survive unchanged in the response.
	for _, tc := range []struct {
		name, value string
		status      int
	}{
		{"partial shape", `{"cards":{"c":{"nodes":[{"type":"image","assetId":"missing"}]}}}`, 200},
		{"case folding", `{"CARDſ":{"c":{"NODEſ":[{"TYPE":"image","ASSETID":"missing"}]}}}`, 200},
		{"duplicate merge", `{"cards":{"a":{"nodes":[]}},"CARDS":{"b":null},"unknown":1e400}`, 200},
		{"null root", `null`, 200},
		{"wrong root", `[]`, 500},
		{"wrong nodes", `{"cards":{"c":{"nodes":"bad"}}}`, 500},
		{"wrong field then corrected", `{"cards":{"c":{"nodes":[{"type":1,"TYPE":"image"}]}}}`, 500},
		{"null strings preserve", `{"cards":{"c":{"nodes":[{"type":"image","TYPE":null,"assetId":"missing","ASSETID":null}]}}}`, 200},
		{"surrogates", `{"cards":{"c":{"nodes":[{"type":"image","assetId":"\ud800"}]}},"\udc00":"unknown"}`, 200},
		{"duplicate nodes retain fields", `{"cards":{"c":{"nodes":[{"type":"image","assetId":"` + digest + `"}],"NODES":[{}]}}}`, 200},
		{"duplicate nodes retain backing tail", `{"cards":{"c":{"nodes":[{}, {"type":"image","assetId":"` + digest + `"}],"NODES":[{}],"Nodes":[{},null]}}}`, 200},
		{"empty nodes clear backing", `{"cards":{"c":{"nodes":[{"type":"image","assetId":"` + digest + `"}],"NODES":[],"Nodes":[{}]}}}`, 200},
		{"earlier node type error", `{"cards":{"c":{"nodes":[{"type":1}],"NODES":[{"type":"image"}]}}}`, 500},
		{"invalid utf8", string(append(append([]byte(`{"cards":{},"title":"`), 0xff, 0xed, 0xa0, 0x80), []byte(`"}`)...)), 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o.store.Set(ctx, key, []byte(tc.value), time.Hour)
			o.compare(t, "GET", o.id, o.token, "", tc.status)
		})
	}
	o.store.Set(ctx, key, []byte("broken JSON"), time.Hour)
	o.request(t, o.target, "GET", o.id, o.token, "", 200)
	after, err := CachedCurrentRevision(ctx, counted, o.id, o.owner, o.store)
	if err != nil || counted.bodyReads != 1 || !bytes.Equal(after.Document, first.Document) {
		t.Fatalf("Go did not consume Rust refill: err=%v bodyReads=%d body=%s", err, counted.bodyReads, after.Document)
	}
	client := redis.NewClient(&redis.Options{Addr: os.Getenv("TEST_VALKEY_ADDR"), Protocol: 2})
	defer client.Close()
	if ttl, err := client.PTTL(ctx, key).Result(); err != nil || ttl <= 0 || ttl > time.Hour {
		t.Fatalf("Rust immutable-body TTL=%v error=%v", ttl, err)
	}
}
