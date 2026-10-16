//go:build rustcompat

package presentation

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
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

// Require both directions to consume real native cache entries, not merely emit
// similar response JSON after separate authoritative reads.
func TestRustPresentationListSharesGoCache(t *testing.T) {
	address := os.Getenv("TEST_VALKEY_ADDR")
	target := strings.TrimRight(os.Getenv("API_UNDER_TEST_URL"), "/")
	if address == "" || target == "" || os.Getenv("TEST_DATABASE_URL") == "" || os.Getenv("TEST_AUTH_SECRET") == "" {
		t.Fatal("TEST_VALKEY_ADDR, API_UNDER_TEST_URL, TEST_DATABASE_URL and TEST_AUTH_SECRET are required")
	}
	t.Setenv("CACHE_VALKEY_ADDR", address)
	t.Setenv("CACHE_VALKEY_AUTH", "")
	t.Setenv("CACHE_VALKEY_CA_PEM", "")
	t.Setenv("CACHE_TIMEOUT_MS", "500")
	t.Setenv("NODE_ENV", "test")
	store, err := cache.FromEnv()
	if err != nil || store == nil {
		t.Fatal("native Go cache", err)
	}
	defer store.Close()
	db, err := sql.Open("pgx", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	user := "cross-cache-é-" + uuid.NewString()
	for _, query := range []string{
		`INSERT INTO users (id, name, email) VALUES ($1, 'Cache', $1 || '@test.invalid')`,
		`INSERT INTO presentations (id, user_id, title, prompt, slides_data) VALUES ($1, $1, 'Shared <é> cache', 'Prompt', '{"totalSlides":3,"status":"ready"}')`,
	} {
		if _, err := db.Exec(query, user); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, query := range []string{`DELETE FROM users WHERE id = $1`, `DELETE FROM presentation_cache_versions WHERE user_id = $1`} {
			if _, err := db.Exec(query, user); err != nil {
				t.Error(err)
			}
		}
	}()
	ctx := context.Background()
	counted := &countedDB{DB: db}
	service := NewService(NewRepository(counted)).WithCache(store)
	summaries, total, more, err := service.List(ctx, user, 20, 0)
	if err != nil || total != 1 || more || counted.lists != 1 {
		t.Fatalf("initial Go fill: %v %d %v %v", summaries, total, more, err)
	}
	version, err := service.repository.CacheVersion(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	key := cache.Key("presentation-list", user, strconv.FormatInt(version, 10), "20", "0")
	if _, hit := store.Get(ctx, key); !hit {
		t.Fatal("Go cache fill was not stored in Valkey")
	}
	identity, err := auth.NewService(auth.Config{Database: db, AuthSecret: os.Getenv("TEST_AUTH_SECRET"), CookieName: "slidesage_token"})
	if err != nil {
		t.Fatal(err)
	}
	token, err := identity.GenerateJWT(user, "", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	readRust := func() {
		t.Helper()
		request, err := http.NewRequest(http.MethodGet, target+"/presentations", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		response, err := (&http.Client{Timeout: time.Second}).Do(request)
		if err != nil {
			t.Fatal("Rust must consume the Go cache without querying presentation bodies", err)
		}
		defer response.Body.Close()
		var body struct {
			Presentations []PresentationSummary `json:"presentations"`
			Total         int                   `json:"total"`
			HasMore       bool                  `json:"has_more"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil || response.StatusCode != http.StatusOK {
			t.Fatalf("Rust response: status %d, error %v", response.StatusCode, err)
		}
		if !reflect.DeepEqual(body.Presentations, summaries) || body.Total != total || body.HasMore != more {
			t.Fatalf("Rust cache response differs: %#v, expected %#v", body, summaries)
		}
	}
	transaction, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer transaction.Rollback()
	if _, err := transaction.Exec(`LOCK TABLE presentations IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	readRust()
	if err := transaction.Rollback(); err != nil {
		t.Fatal(err)
	}
	// Corrupt the active entry so Rust must refill it, then require a Go hit.
	store.Set(ctx, key, []byte("broken JSON"), 30*time.Second)
	readRust()
	got, gotTotal, gotMore, err := service.List(ctx, user, 20, 0)
	if err != nil || !reflect.DeepEqual(got, summaries) || gotTotal != total || gotMore != more || counted.lists != 1 {
		t.Fatalf("Go did not consume Rust's fill: %#v %d %v error=%v body_queries=%d", got, gotTotal, gotMore, err, counted.lists)
	}
	client := redis.NewClient(&redis.Options{Addr: address, Protocol: 2})
	defer client.Close()
	defer client.Del(ctx, key)
	if ttl, err := client.PTTL(ctx, key).Result(); err != nil || ttl <= 0 || ttl > 30*time.Second {
		t.Fatalf("Rust list cache TTL = %v, error %v", ttl, err)
	}
}
