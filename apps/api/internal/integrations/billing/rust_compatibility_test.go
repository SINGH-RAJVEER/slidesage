//go:build rustcompat

package billing

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

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/auth"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// The same requests and assertions exercise the original Go handler and live Rust API.
// Use only a disposable database migrated with the unchanged application runner.
func TestBillingBalanceMatchesRust(t *testing.T) {
	target := os.Getenv("API_UNDER_TEST_URL")
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		t.Fatal("API_UNDER_TEST_URL must point to the test Rust API")
	}
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	secret := os.Getenv("TEST_AUTH_SECRET")
	if databaseURL == "" || secret == "" {
		t.Fatal("TEST_DATABASE_URL and TEST_AUTH_SECRET are required for the disposable test API")
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	cookieName := os.Getenv("TEST_COOKIE_NAME")
	if cookieName == "" {
		cookieName = "slidesage_token"
	}
	identity, err := auth.NewService(auth.Config{Database: database, AuthSecret: secret, CookieName: cookieName})
	if err != nil {
		t.Fatal(err)
	}
	userID := "billing-compat-" + time.Now().UTC().Format("20060102150405.000000000")
	otherID := userID + "-other"
	for _, id := range []string{userID, otherID} {
		if _, err := database.Exec(`INSERT INTO users (id, name, email) VALUES ($1, 'Billing fixture', $2)`, id, id+"@example.test"); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if _, err := database.Exec(`DELETE FROM users WHERE id = $1`, id); err != nil {
				t.Errorf("remove billing fixture: %v", err)
			}
		}()
	}
	tokenFor := func(id string, ttl time.Duration) string {
		t.Helper()
		token, err := identity.GenerateJWT(id, "", ttl)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	token := tokenFor(userID, time.Hour)
	cookie := cookieName + "=" + token
	otherToken := tokenFor(otherID, time.Hour)
	mux := http.NewServeMux()
	RegisterRoutes(mux, PaymentService{DB: database}, &RazorpayClient{}, identity.AuthenticatedUserID)
	// Match the API's catch-all for unsupported methods.
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": "Resource not found"}})
	})
	reference := httptest.NewServer(mux)
	defer reference.Close()
	transport := &http.Transport{ResponseHeaderTimeout: 5 * time.Second}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	unauthorized := `{"error":{"message":"Unauthorized"}}`
	for _, tc := range []struct {
		name, method, authorization, cookie string
		millis                              int64
		status                              int
		body                                string
	}{
		{"default balance", "GET", "Bearer " + token, "", 50000, 200, `{"slide_tokens":50}`},
		{"zero", "GET", "Bearer " + token, "", 0, 200, `{"slide_tokens":0}`},
		{"one milli", "GET", "Bearer " + token, "", 1, 200, `{"slide_tokens":0.001}`},
		{"fractional", "GET", "Bearer " + token, "", 12345, 200, `{"slide_tokens":12.345}`},
		{"maximum bigint", "GET", "Bearer " + token, "", 9223372036854775807, 200, `{"slide_tokens":9223372036854776}`},
		{"cookie", "GET", "", cookie, 12345, 200, `{"slide_tokens":12.345}`},
		{"quoted cookie", "GET", "", cookieName + "=\"" + token + "\"", 1, 200, `{"slide_tokens":0.001}`},
		{"bearer selects own user", "GET", "Bearer " + otherToken, cookie, 12345, 200, `{"slide_tokens":50}`},
		{"missing credentials", "GET", "", "", 50000, 401, unauthorized},
		{"invalid bearer blocks cookie", "GET", "Bearer bad", cookie, 50000, 401, unauthorized},
		// HTTP removes the trailing space, so "Bearer" falls back to the cookie.
		{"bare bearer uses cookie over HTTP", "GET", "Bearer ", cookie, 50000, 200, `{"slide_tokens":50}`},
		{"expired token", "GET", "Bearer " + tokenFor(userID, -time.Hour), "", 50000, 401, unauthorized},
		{"wrong cookie name", "GET", "", "wrong_token=" + token, 50000, 401, unauthorized},
		{"deleted user", "GET", "Bearer " + tokenFor(userID+"-missing", time.Hour), "", 50000, 500, `{"error":{"message":"Internal server error"}}`},
		{"head", "HEAD", "Bearer " + token, "", 50000, 200, ""},
		{"unsupported method", "POST", "Bearer " + token, "", 50000, 404, `{"error":{"message":"Resource not found"}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := database.Exec(`UPDATE users SET balance_millis = $1 WHERE id = $2`, tc.millis, userID); err != nil {
				t.Fatal(err)
			}
			for _, server := range []struct{ name, base string }{{"Go", reference.URL}, {"Rust", strings.TrimRight(target, "/")}} {
				request, err := http.NewRequest(tc.method, server.base+"/billing/balance", nil)
				if err != nil {
					t.Fatal(err)
				}
				if tc.authorization != "" {
					request.Header.Set("Authorization", tc.authorization)
				}
				if tc.cookie != "" {
					request.Header.Set("Cookie", tc.cookie)
				}
				response, err := client.Do(request)
				if err != nil {
					t.Fatal(err)
				}
				body, err := io.ReadAll(response.Body)
				response.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				if response.StatusCode != tc.status {
					t.Fatalf("%s status=%d want=%d body=%s", server.name, response.StatusCode, tc.status, body)
				}
				contentType := "application/json; charset=utf-8"
				if tc.status == 404 {
					contentType = "application/json"
				}
				if response.Header.Get("Content-Type") != contentType {
					t.Fatalf("%s Content-Type=%q", server.name, response.Header.Get("Content-Type"))
				}
				if tc.method == "HEAD" {
					if len(body) != 0 {
						t.Fatalf("%s HEAD body=%q", server.name, body)
					}
					continue
				}
				if len(body) == 0 || body[len(body)-1] != '\n' {
					t.Fatalf("%s missing JSON newline: %q", server.name, body)
				}
				var got, want any
				if err := json.Unmarshal(body, &got); err != nil {
					t.Fatal(err)
				}
				if err := json.Unmarshal([]byte(tc.body), &want); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("%s body=%s want=%s", server.name, body, tc.body)
				}
			}
			var after int64
			if err := database.QueryRow(`SELECT balance_millis FROM users WHERE id = $1`, userID).Scan(&after); err != nil {
				t.Fatal(err)
			}
			if after != tc.millis {
				t.Fatalf("balance read changed stored millis: %d want %d", after, tc.millis)
			}
		})
	}
}
