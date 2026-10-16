//go:build rustcompat

package auth

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/middleware"
	"github.com/google/uuid"
)

// Exercise the original handler, service, repository, and persisted protection
// against the same database used by the live Rust process.
func TestSignInOptionsMatchesRust(t *testing.T) {
	target := strings.TrimRight(os.Getenv("API_UNDER_TEST_URL"), "/")
	if target == "" || os.Getenv("TEST_DATABASE_URL") == "" || os.Getenv("TEST_AUTH_SECRET") == "" || os.Getenv("TRUST_PROXY_HEADERS") != "true" {
		t.Fatal("API_UNDER_TEST_URL, TEST_DATABASE_URL, TEST_AUTH_SECRET and TRUST_PROXY_HEADERS=true are required")
	}
	db, err := sql.Open("pgx", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	user := "options-" + uuid.NewString()
	email := user + "@example.test"
	unknown := "unknown-" + uuid.NewString() + "@example.test"
	exec(`INSERT INTO users(id,name,email,email_verified) VALUES($1,'Options fixture',$2,true)`, user, email)
	defer func() {
		if _, err := db.Exec(`DELETE FROM users WHERE id=$1`, user); err != nil {
			t.Error(err)
		}
	}()
	credential := func(provider string, password any) {
		t.Helper()
		exec(`DELETE FROM accounts WHERE user_id=$1`, user)
		exec(`INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES($1,$2,$3,$2,$4,'2026-01-02','2026-01-02')`, uuid.NewString(), user, provider, password)
	}
	hash := strings.Repeat("a", 32) + ":" + strings.Repeat("b", 128)
	credential("credential", hash)
	service, err := NewService(Config{Database: db, AuthSecret: os.Getenv("TEST_AUTH_SECRET")})
	if err != nil {
		t.Fatal(err)
	}
	rateSecret := os.Getenv("TEST_RATE_LIMIT_HASH_SECRET")
	if rateSecret == "" {
		rateSecret = os.Getenv("TEST_AUTH_SECRET")
	}
	keyHash := func(scope, key string) string {
		digest := sha256.Sum256([]byte(rateSecret + "\x00" + scope + "\x00" + key))
		return hex.EncodeToString(digest[:])
	}
	keys := map[string]map[string]bool{"auth-sign-in-ip": {}, "auth-sign-in-email": {}}
	reset := func(scope, key string) {
		t.Helper()
		keys[scope][key] = true
		exec(`DELETE FROM api_rate_limits WHERE scope=$1 AND key_hash=$2`, scope, keyHash(scope, key))
	}
	defer func() {
		for scope, values := range keys {
			for key := range values {
				if _, err := db.Exec(`DELETE FROM api_rate_limits WHERE scope=$1 AND key_hash=$2`, scope, keyHash(scope, key)); err != nil {
					t.Error(err)
				}
			}
		}
	}()
	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, service)
	reference := httptest.NewServer(middleware.RateLimit(db, rateSecret, service.AuthenticatedUserID, mux))
	defer reference.Close()
	client := &http.Client{Timeout: 15 * time.Second}
	request := func(base, body, address string) (*http.Response, map[string]any) {
		t.Helper()
		req, err := http.NewRequest("POST", base+"/auth/sign-in/options", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("CF-Connecting-IP", address)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Cookies()) != 0 || len(data) == 0 || data[len(data)-1] != '\n' {
			t.Fatalf("unexpected cookies/body: %v %q", res.Cookies(), data)
		}
		contentType := "application/json"
		if res.StatusCode == 429 || res.StatusCode == 503 {
			contentType = "application/json; charset=utf-8"
		}
		if res.Header.Get("Content-Type") != contentType {
			t.Fatalf("content type=%q want=%q", res.Header.Get("Content-Type"), contentType)
		}
		var result map[string]any
		if err := json.Unmarshal(data, &result); err != nil {
			t.Fatalf("invalid response %q: %v", data, err)
		}
		return res, result
	}
	body := func(address string) string { return fmt.Sprintf(`{"email":%q}`, address) }
	compare := func(t *testing.T, input string, status int, hasPassword bool) {
		t.Helper()
		address := "options-ip-" + uuid.NewString()
		var expected map[string]any
		for index, base := range []string{reference.URL, target} {
			reset("auth-sign-in-ip", address)
			var parsed struct{ Email string }
			if len(input) <= 32*1024 && json.Unmarshal([]byte(input), &parsed) == nil && strings.TrimSpace(parsed.Email) != "" {
				reset("auth-sign-in-email", strings.ToLower(strings.TrimSpace(parsed.Email)))
			}
			res, result := request(base, input, address)
			if res.StatusCode != status {
				t.Fatalf("server=%d status=%d want=%d body=%v", index, res.StatusCode, status, result)
			}
			if status == 200 && !reflect.DeepEqual(result, map[string]any{"hasPassword": hasPassword}) {
				t.Fatalf("server=%d invalid password availability: %v", index, result)
			}
			if index == 0 {
				expected = result
			} else if !reflect.DeepEqual(expected, result) {
				t.Fatalf("Rust=%v Go=%v", result, expected)
			}
		}
	}
	for _, tc := range []struct {
		name, input string
		status      int
	}{
		{"password account", body(email), 200},
		{"normalized email", body(" \t" + strings.ToUpper(email) + "\n"), 200},
		{"Unicode simple lowercase", body(strings.Replace(strings.ToUpper(email), "I", "İ", 1)), 200},
		{"case folded key", fmt.Sprintf(`{"EmAiL":%q}`, email), 200},
		{"duplicate email", fmt.Sprintf(`{"email":%q,"email":%q}`, unknown, email), 200},
		{"null preserves email", fmt.Sprintf(`{"email":%q,"email":null}`, email), 200},
		{"unknown account", body(unknown), 404},
		{"invalid email", body("invalid"), 400},
		{"embedded ASCII whitespace", body("a b@example.test"), 400},
		{"too long email", body(strings.Repeat("a", 256) + "@example.test"), 400},
		{"empty object", `{}`, 400},
		{"null body", `null`, 400},
		{"null email", `{"email":null}`, 400},
		{"empty body", ``, 400},
		{"array body", `[]`, 400},
		{"number body", `42`, 400},
		{"wrong email type", `{"email":42}`, 400},
		{"unknown field", fmt.Sprintf(`{"email":%q,"password":"ignored"}`, email), 400},
		{"duplicate wrong type remains error", fmt.Sprintf(`{"email":42,"email":%q}`, email), 400},
		{"trailing JSON", body(email) + `{}`, 400},
		{"oversized first string", `{"email":"` + strings.Repeat("x", 32768) + `"}`, 413},
		{"oversized whitespace", body(email) + strings.Repeat(" ", 32768), 400},
		{"malformed UTF8 becomes replacement", `{"email":"` + string([]byte{0xf0, 0x9f}) + `@example.test"}`, 404},
		{"lone surrogate", `{"email":"\ud800@example.test"}`, 404},
	} {
		t.Run(tc.name, func(t *testing.T) { compare(t, tc.input, tc.status, true) })
	}
	for _, tc := range []struct {
		name, provider string
		password       any
		valid          bool
	}{
		{"null credential", "credential", nil, false},
		{"empty credential", "credential", "", false},
		{"legacy credential", "credential", "reset-required", false},
		{"valid hash shape", "credential", hash, true},
		{"non-hex hash shape", "credential", strings.Repeat("z", 32) + ":" + strings.Repeat("g", 128), true},
		{"Unicode byte length salt", "credential", strings.Repeat("é", 16) + ":" + strings.Repeat("b", 128), true},
		{"extra separator", "credential", hash + ":", false},
		{"wrong provider", "google", hash, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			credential(tc.provider, tc.password)
			compare(t, body(email), 200, tc.valid)
		})
	}
	t.Run("no credential", func(t *testing.T) {
		exec(`DELETE FROM accounts WHERE user_id=$1`, user)
		compare(t, body(email), 200, false)
	})
	t.Run("latest non-null credential wins", func(t *testing.T) {
		credential("credential", hash)
		exec(`INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES($1,$2,'credential',$2,'reset-required','2026-01-03','2026-01-03'),($3,$2,'credential',$2,NULL,'2026-01-04','2026-01-04')`, uuid.NewString(), user, uuid.NewString())
		compare(t, body(email), 200, false)
	})
	t.Run("unverified account", func(t *testing.T) {
		credential("credential", hash)
		exec(`UPDATE users SET email_verified=false WHERE id=$1`, user)
		compare(t, body(email), 200, true)
	})
	for _, tc := range []struct {
		name  string
		limit int
	}{
		{"email rate limit", 10}, {"IP rate limit", 30},
	} {
		t.Run(tc.name, func(t *testing.T) {
			address := "options-rate-" + uuid.NewString()
			rateEmail := "options-rate-" + uuid.NewString() + "@example.test"
			for index, base := range []string{reference.URL, target} {
				reset("auth-sign-in-ip", address)
				reset("auth-sign-in-email", rateEmail)
				for n := 1; n <= tc.limit+1; n++ {
					value := rateEmail
					if tc.limit == 30 {
						value = fmt.Sprintf("%d-%s", n, rateEmail)
						reset("auth-sign-in-email", value)
					}
					res, result := request(base, body(value), address)
					want := 404
					if n > tc.limit {
						want = 429
					}
					if res.StatusCode != want {
						t.Fatalf("server=%d request=%d status=%d want=%d body=%v", index, n, res.StatusCode, want, result)
					}
					if want == 429 {
						retry, ok := result["retry_after"].(float64)
						if !ok || retry < 1 || retry > 900 || res.Header.Get("Retry-After") != fmt.Sprint(int(retry)) || !reflect.DeepEqual(result["error"], map[string]any{"message": "Too many requests", "code": "RATE_LIMITED"}) {
							t.Fatalf("invalid rate response: %v %v", res.Header, result)
						}
					}
				}
				scope, key := "auth-sign-in-email", rateEmail
				if tc.limit == 30 {
					scope, key = "auth-sign-in-ip", address
				}
				var count int
				if err := db.QueryRow(`SELECT request_count FROM api_rate_limits WHERE scope=$1 AND key_hash=$2 ORDER BY window_start DESC LIMIT 1`, scope, keyHash(scope, key)).Scan(&count); err != nil || count != tc.limit+1 {
					t.Fatalf("server=%d persisted counter=%d err=%v", index, count, err)
				}
			}
		})
	}
	t.Run("database failures", func(t *testing.T) {
		if os.Getenv("TEST_RUST_DISPOSABLE_DATABASE") != "true" {
			t.Fatal("failure injection requires the private disposable compatibility runner and TEST_RUST_DISPOSABLE_DATABASE=true")
		}
		for _, tc := range []struct {
			table, column string
			status        int
		}{
			{"users", "email", 400}, {"accounts", "password", 400}, {"api_rate_limits", "request_count", 503},
		} {
			t.Run(tc.table, func(t *testing.T) {
				exec(fmt.Sprintf(`ALTER TABLE %s RENAME COLUMN %s TO rust_options_failure`, tc.table, tc.column))
				defer exec(fmt.Sprintf(`ALTER TABLE %s RENAME COLUMN rust_options_failure TO %s`, tc.table, tc.column))
				// Counter reset needs the normal schema and is unnecessary for these
				// two unique IPs. The existing email remains below its limit.
				var expected map[string]any
				for index, base := range []string{reference.URL, target} {
					address := "options-failure-" + uuid.NewString()
					keys["auth-sign-in-ip"][address] = true
					res, result := request(base, body(email), address)
					if res.StatusCode != tc.status {
						t.Fatalf("server=%d status=%d want=%d body=%v", index, res.StatusCode, tc.status, result)
					}
					if index == 0 {
						expected = result
					} else if !reflect.DeepEqual(expected, result) {
						t.Fatalf("Rust=%v Go=%v", result, expected)
					}
				}
			})
		}
	})
}
