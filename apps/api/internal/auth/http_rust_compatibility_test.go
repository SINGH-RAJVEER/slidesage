//go:build rustcompat

package auth

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestAuthReadRoutesMatchRust(t *testing.T) {
	target := os.Getenv("API_UNDER_TEST_URL")
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		t.Fatal("API_UNDER_TEST_URL must point to the test Rust API")
	}
	if os.Getenv("TEST_DATABASE_URL") == "" || os.Getenv("TEST_AUTH_SECRET") == "" {
		t.Fatal("TEST_DATABASE_URL and TEST_AUTH_SECRET are required")
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
	user, other := "auth-compat-"+uuid.NewString(), "auth-other-"+uuid.NewString()
	exec(t, `INSERT INTO users(id,name,email,balance_millis,created_at,updated_at) VALUES($1,'A <User> & Friends' || chr(8232),$1 || '@example.test',12345,'2026-01-02 03:04:05.123400','2026-01-03 00:00:00'),($2,'Other',$2 || '@example.test',50000,'2026-01-02','2026-01-02')`, user, other)
	defer func() {
		if _, err := db.Exec(`DELETE FROM users WHERE id IN ($1,$2)`, user, other); err != nil {
			t.Error(err)
		}
	}()
	secure := os.Getenv("TEST_SECURE_COOKIES") == "true"
	cookieName, sameSite := "slidesage_token", http.SameSiteLaxMode
	wrongCookieName := "__Secure-slidesage_token"
	if secure {
		cookieName, wrongCookieName, sameSite = wrongCookieName, cookieName, http.SameSiteNoneMode
	}
	service, err := NewService(Config{Database: db, AuthSecret: os.Getenv("TEST_AUTH_SECRET"), CookieName: cookieName, SecureCookies: secure, SameSite: sameSite})
	if err != nil {
		t.Fatal(err)
	}
	tokenFor := func(user string, ttl time.Duration) string {
		t.Helper()
		token, err := service.GenerateJWT(user, "", ttl)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	token, otherToken := tokenFor(user, time.Hour), tokenFor(other, time.Hour)
	cookie := cookieName + "=" + token
	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, service)
	RegisterProfileRoutes(mux, service)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { writeError(w, 404, "Resource not found") })
	reference := httptest.NewServer(mux)
	defer reference.Close()
	transport := &http.Transport{ResponseHeaderTimeout: 5 * time.Second}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	compare := func(t *testing.T, method, path, authorization, cookie, body string, status int) map[string]any {
		t.Helper()
		var expected any
		var expectedCookies []string
		for index, base := range []string{reference.URL, strings.TrimRight(target, "/")} {
			req, err := http.NewRequest(method, base+path, strings.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			if authorization != "" {
				req.Header.Set("Authorization", authorization)
			}
			if cookie != "" {
				req.Header.Set("Cookie", cookie)
			}
			started := time.Now()
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			finished := time.Now()
			data, err := io.ReadAll(res.Body)
			res.Body.Close()
			if err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != status {
				t.Fatalf("server=%d %s %s status=%d want=%d body=%s", index, method, path, res.StatusCode, status, data)
			}
			if res.Header.Get("Content-Type") != "application/json" {
				t.Fatalf("Content-Type=%q", res.Header.Get("Content-Type"))
			}
			if index == 0 {
				expectedCookies = res.Header.Values("Set-Cookie")
			} else if !reflect.DeepEqual(expectedCookies, res.Header.Values("Set-Cookie")) {
				t.Fatalf("Set-Cookie Rust=%v Go=%v", res.Header.Values("Set-Cookie"), expectedCookies)
			}
			if method == "HEAD" {
				if len(data) != 0 {
					t.Fatalf("HEAD body=%s", data)
				}
				continue
			}
			if len(data) == 0 || data[len(data)-1] != '\n' {
				t.Fatalf("missing JSON newline: %q", data)
			}
			if strings.ContainsAny(string(data), "<>&\u2028\u2029") {
				t.Fatalf("missing Go JSON escaping: %s", data)
			}
			var got any
			if err := json.Unmarshal(data, &got); err != nil {
				t.Fatal(err)
			}
			if path == "/auth/get-session" && got != nil && status == 200 {
				session := got.(map[string]any)["session"].(map[string]any)
				text, ok := session["expiresAt"].(string)
				if !ok {
					t.Fatal(session)
				}
				expires, err := time.Parse(time.RFC3339Nano, text)
				if err != nil || !strings.HasSuffix(text, "Z") || expires.Before(started.Add(7*24*time.Hour)) || expires.After(finished.Add(7*24*time.Hour)) {
					t.Fatalf("expiresAt must be lookup-time + 7 days: %q (%v)", text, err)
				}
				// Only this independently validated clock field varies between requests.
				session["expiresAt"] = "validated lookup-time + 7 days"
			}
			if index == 0 {
				expected = got
			} else if !reflect.DeepEqual(expected, got) {
				t.Fatalf("Rust=%v\nGo=%v", got, expected)
			}
		}
		if expected == nil {
			return nil
		}
		return expected.(map[string]any)
	}
	for _, tc := range []struct {
		name, authorization, cookie string
		authenticated               bool
	}{
		{"bearer", "Bearer " + token, "", true},
		{"cookie", "", cookie, true},
		{"quoted cookie", "", cookieName + "=\"" + token + "\"", true},
		{"bearer precedes other cookie", "Bearer " + token, cookieName + "=" + otherToken, true},
		{"missing credentials", "", "", false},
		{"invalid token", "Bearer invalid", "", false},
		{"invalid bearer blocks cookie", "Bearer invalid", cookie, false},
		{"non-ASCII bearer blocks cookie", "Bearer é", cookie, false},
		{"non-UTF8 bearer blocks cookie", "Bearer " + string([]byte{0xff}), cookie, false},
		{"unrelated non-ASCII cookie", "", "other=é; " + cookie, true},
		{"unrelated non-UTF8 cookie", "", "other=" + string([]byte{0xff}) + "; " + cookie, true},
		{"invalid configured cookie before valid cookie", "", cookieName + "=é; " + cookie, true},
		{"expired token", "Bearer " + tokenFor(user, -time.Hour), "", false},
		{"missing database user", "Bearer " + tokenFor(user+"-missing", time.Hour), "", false},
		{"wrong cookie name", "", wrongCookieName + "=" + token, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := compare(t, "GET", "/auth/get-session", tc.authorization, tc.cookie, "", 200)
			if (got != nil) != tc.authenticated {
				t.Fatal(got)
			}
			status := 401
			if tc.authenticated {
				status = 200
			}
			compare(t, "GET", "/profile", tc.authorization, tc.cookie, "", status)
		})
	}
	for _, tc := range []struct {
		name, provider string
		password       *string
		valid          bool
	}{
		{"passwordless", "credential", nil, false},
		{"empty password", "credential", ptr(""), false},
		{"legacy password", "credential", ptr("reset-required"), false},
		{"valid shape", "credential", ptr(strings.Repeat("a", 32) + ":" + strings.Repeat("b", 128)), true},
		{"non-hex shape", "credential", ptr(strings.Repeat("z", 32) + ":" + strings.Repeat("g", 128)), true},
		{"unicode salt bytes", "credential", ptr(strings.Repeat("é", 16) + ":" + strings.Repeat("b", 128)), true},
		{"wrong provider", "google", ptr(strings.Repeat("a", 32) + ":" + strings.Repeat("b", 128)), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			exec(t, `DELETE FROM accounts WHERE user_id=$1`, user)
			exec(t, `INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES($1,$2,$3,$2,$4,now(),now())`, uuid.NewString(), user, tc.provider, tc.password)
			got := compare(t, "GET", "/profile", "Bearer "+token, "", "", 200)
			if got["hasPassword"] != tc.valid {
				t.Fatal(got)
			}
		})
	}
	t.Run("latest non-null credential wins", func(t *testing.T) {
		exec(t, `DELETE FROM accounts WHERE user_id=$1`, user)
		for _, tc := range []struct {
			timestamp string
			password  *string
		}{
			{"2026-01-01", ptr(strings.Repeat("a", 32) + ":" + strings.Repeat("b", 128))},
			{"2026-01-02", ptr("reset-required")},
			{"2026-01-03", nil},
		} {
			exec(t, `INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES($1,$2,'credential',$2,$3,$4::text::timestamp,now())`, uuid.NewString(), user, tc.password, tc.timestamp)
		}
		got := compare(t, "GET", "/profile", "Bearer "+token, "", "", 200)
		if got["hasPassword"] != false {
			t.Fatal(got)
		}
	})
	t.Run("current user data and unverified account", func(t *testing.T) {
		for _, millis := range []int64{0, 1, 12345, 9223372036854775807} {
			exec(t, `UPDATE users SET balance_millis=$1,image='https://example.test/avatar?a=1&b=2',landing_page='presentations',email_verified=false WHERE id=$2`, millis, user)
			got := compare(t, "GET", "/profile", "Bearer "+token, "", "", 200)
			u := got["user"].(map[string]any)
			if u["slideTokens"] != float64(millis)/1000 || u["landingPage"] != "presentations" || u["emailVerified"] != false {
				t.Fatal(u)
			}
			compare(t, "GET", "/auth/get-session", "Bearer "+token, "", "", 200)
		}
	})
	t.Run("methods and stateless sign-out", func(t *testing.T) {
		compare(t, "HEAD", "/auth/get-session", "Bearer "+token, "", "", 200)
		compare(t, "HEAD", "/profile", "Bearer "+token, "", "", 200)
		compare(t, "POST", "/auth/get-session", "Bearer "+token, "", "", 404)
		compare(t, "GET", "/auth/sign-out", "Bearer "+token, "", "", 404)
		for _, authorization := range []string{"", "Bearer invalid", "Bearer " + token} {
			got := compare(t, "POST", "/auth/sign-out", authorization, cookie, strings.Repeat("not JSON", 5000), 200)
			if got["success"] != true {
				t.Fatal(got)
			}
		}
		// Sign-out clears the cookie; the reference does not revoke valid bearer tokens.
		compare(t, "GET", "/auth/get-session", "Bearer "+token, "", "", 200)
	})
}

func ptr(value string) *string { return &value }
