package feedback

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/auth"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Preserve the original test's assertions. Remote mode reads real persistence
// back into its recording store; it does not replace the database with a mock.
func submitFeedbackForTest(t *testing.T, store *recordingStore, identity Identity, w http.ResponseWriter, request *http.Request) {
	t.Helper()
	target := os.Getenv("API_UNDER_TEST_URL")
	if target == "" {
		router{store: store, identity: identity}.submit(w, request)
		return
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		t.Fatal("invalid API_UNDER_TEST_URL")
	}
	databaseURL := os.Getenv("FEEDBACK_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("remote feedback tests require FEEDBACK_TEST_DATABASE_URL pointing to the disposable fixture database")
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var before, after int
	if err := database.QueryRow(`SELECT count(*) FROM feedback`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if userID, err := identity(request); err == nil {
		secret := os.Getenv("TEST_AUTH_SECRET")
		if secret == "" {
			t.Fatal("remote feedback tests require TEST_AUTH_SECRET matching the test API")
		}
		// Validation cases are independent; the rate-limit oracle tests the window separately.
		rateSecret := os.Getenv("TEST_RATE_LIMIT_HASH_SECRET")
		if rateSecret == "" {
			rateSecret = secret
		}
		digest := sha256.Sum256([]byte(rateSecret + "\x00feedback-submit\x00" + userID))
		if _, err := database.Exec(`DELETE FROM api_rate_limits WHERE scope = 'feedback-submit' AND key_hash = $1`, hex.EncodeToString(digest[:])); err != nil {
			t.Fatal(err)
		}
		service, err := auth.NewService(auth.Config{Database: database, AuthSecret: secret})
		if err != nil {
			t.Fatal(err)
		}
		token, err := service.GenerateJWT(userID, "", time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
	}
	proxy := httputil.NewSingleHostReverseProxy(parsed)
	transport := &http.Transport{ResponseHeaderTimeout: 5 * time.Second}
	defer transport.CloseIdleConnections()
	proxy.Transport = transport
	proxy.ErrorHandler = func(writer http.ResponseWriter, _ *http.Request, err error) {
		t.Errorf("feedback target failed: %v", err)
		writer.WriteHeader(http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, request)
	if err := database.QueryRow(`SELECT count(*) FROM feedback`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after == before {
		return
	}
	if after != before+1 {
		t.Fatalf("request inserted %d rows", after-before)
	}
	if err := database.QueryRow(`SELECT user_id, message FROM feedback ORDER BY created_at DESC, id DESC LIMIT 1`).Scan(&store.userID, &store.message); err != nil {
		t.Fatal(err)
	}
}
