//go:build rustcompat

package middleware

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/auth"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestFeedbackRateLimitMatchesRust(t *testing.T) {
	target, databaseURL, secret := os.Getenv("API_UNDER_TEST_URL"), os.Getenv("FEEDBACK_TEST_DATABASE_URL"), os.Getenv("TEST_AUTH_SECRET")
	if target == "" || databaseURL == "" || secret == "" {
		t.Fatal("API_UNDER_TEST_URL, FEEDBACK_TEST_DATABASE_URL and TEST_AUTH_SECRET are required")
	}
	rateSecret := os.Getenv("TEST_RATE_LIMIT_HASH_SECRET")
	if rateSecret == "" {
		rateSecret = secret
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	service, err := auth.NewService(auth.Config{Database: database, AuthSecret: secret})
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	for _, implementation := range []string{"go", "rust"} {
		userID := fmt.Sprintf("rate-compat-%s-%d", implementation, time.Now().UnixNano())
		goHandler := RateLimit(database, rateSecret, func(*http.Request) (string, error) { return userID, nil }, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadRequest) }))
		token, err := service.GenerateJWT(userID, "", time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		for attempt := 1; attempt <= 11; attempt++ {
			recorder := httptest.NewRecorder()
			if implementation == "go" {
				goHandler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/feedback", strings.NewReader(`{"message":" "}`)))
			} else {
				request, err := http.NewRequest(http.MethodPost, strings.TrimRight(target, "/")+"/feedback", strings.NewReader(`{"message":" "}`))
				if err != nil {
					t.Fatal(err)
				}
				request.Header.Set("Authorization", "Bearer "+token)
				response, err := client.Do(request)
				if err != nil {
					t.Fatal(err)
				}
				recorder.Code = response.StatusCode
				recorder.HeaderMap = response.Header
				_, err = recorder.Body.ReadFrom(response.Body)
				response.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
			}
			expected := http.StatusBadRequest
			if attempt == 11 {
				expected = http.StatusTooManyRequests
			}
			if recorder.Code != expected {
				t.Fatalf("%s attempt %d: status=%d body=%s", implementation, attempt, recorder.Code, recorder.Body)
			}
			if attempt == 11 {
				var body struct {
					Error      struct{ Code, Message string }
					RetryAfter int `json:"retry_after"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if body.Error.Code != "RATE_LIMITED" || body.Error.Message != "Too many requests" || body.RetryAfter < 1 || body.RetryAfter > 3600 || recorder.Header().Get("Retry-After") != fmt.Sprint(body.RetryAfter) {
					t.Fatalf("%s rate-limit response differs: headers=%v body=%s", implementation, recorder.Header(), recorder.Body)
				}
			}
		}
		var count int
		if err := database.QueryRow(`SELECT request_count FROM api_rate_limits WHERE scope = 'feedback-submit' AND key_hash = $1`, hashKey(rateSecret, "feedback-submit", userID)).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 11 {
			t.Fatalf("%s persisted count = %d", implementation, count)
		}
	}
}
