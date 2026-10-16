//go:build rustcompat

package auth

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
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
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPasswordSignInMatchesRust(t *testing.T) {
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
	userID := "signin-" + uuid.NewString()
	email := userID + "@example.test"
	unknown := "unknown-" + uuid.NewString() + "@example.test"
	proxy := "signin-proxy-" + uuid.NewString()
	password := "café-password"
	hash, err := hashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO users(id,name,email,email_verified,image,balance_millis,landing_page,created_at,updated_at) VALUES($1,'A <User> & Friends' || chr(8232),$2,true,'https://example.test/avatar?a=1&b=2',12345,'presentations','2026-01-02 03:04:05.123400','2026-01-03')`, userID, email)
	defer func() {
		if _, err := db.Exec(`DELETE FROM users WHERE id=$1`, userID); err != nil {
			t.Error(err)
		}
	}()
	credential := func(provider string, password any) {
		t.Helper()
		exec(`DELETE FROM accounts WHERE user_id=$1`, userID)
		exec(`INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES($1,$2,$3,$2,$4,'2026-01-02','2026-01-02')`, uuid.NewString(), userID, provider, password)
	}
	credential("credential", hash)
	secure := os.Getenv("TEST_SECURE_COOKIES") == "true"
	cookieName, sameSite := "slidesage_token", http.SameSiteLaxMode
	if secure {
		cookieName, sameSite = "__Secure-slidesage_token", http.SameSiteNoneMode
	}
	service, err := NewService(Config{Database: db, AuthSecret: os.Getenv("TEST_AUTH_SECRET"), CookieName: cookieName, SecureCookies: secure, SameSite: sameSite})
	if err != nil {
		t.Fatal(err)
	}
	rateSecret := os.Getenv("TEST_RATE_LIMIT_HASH_SECRET")
	if rateSecret == "" {
		rateSecret = os.Getenv("TEST_AUTH_SECRET")
	}
	keys := map[string]map[string]bool{"auth-sign-in-ip": {}, "auth-sign-in-email": {}}
	keyHash := func(scope, key string) string {
		digest := sha256.Sum256([]byte(rateSecret + "\x00" + scope + "\x00" + key))
		return hex.EncodeToString(digest[:])
	}
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
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { writeError(w, 404, "Resource not found") })
	reference := httptest.NewServer(middleware.RateLimit(db, rateSecret, service.AuthenticatedUserID, mux))
	defer reference.Close()
	client := &http.Client{Timeout: 15 * time.Second}
	var proxyHeaders map[string]string
	request := func(base, body, address string) (*http.Response, []byte, time.Time, time.Time) {
		t.Helper()
		req, err := http.NewRequest("POST", base+"/auth/sign-in/email", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("CF-Connecting-IP", address)
		req.Header.Set("X-Forwarded-For", "ignored-"+address+", next-proxy")
		req.Header.Set("X-Real-IP", "ignored-real-"+address)
		if proxyHeaders != nil {
			for _, name := range []string{"CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP"} {
				req.Header.Del(name)
			}
			for name, value := range proxyHeaders {
				req.Header.Set(name, value)
			}
		}
		started := time.Now()
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		return res, data, started, time.Now()
	}
	compare := func(t *testing.T, body string, status int, persistent bool) {
		t.Helper()
		var expected any
		var expectedCookies []*http.Cookie
		for index, base := range []string{reference.URL, target} {
			reset("auth-sign-in-ip", proxy)
			var input struct{ Email string }
			if len(body) <= 32*1024 && json.Unmarshal([]byte(body), &input) == nil && strings.TrimSpace(input.Email) != "" {
				reset("auth-sign-in-email", strings.ToLower(strings.TrimSpace(input.Email)))
			}
			res, data, started, finished := request(base, body, proxy)
			if res.StatusCode != status {
				t.Fatalf("server=%d status=%d want=%d body=%s", index, res.StatusCode, status, data)
			}
			if res.Header.Get("Content-Type") != "application/json" || len(data) == 0 || data[len(data)-1] != '\n' {
				t.Fatalf("response headers/body mismatch: %v %q", res.Header, data)
			}
			if strings.ContainsAny(string(data), "<>&\u2028\u2029") {
				t.Fatalf("missing Go escaping: %s", data)
			}
			var got map[string]any
			if err := json.Unmarshal(data, &got); err != nil {
				t.Fatal(err)
			}
			cookies := res.Cookies()
			if status == 200 {
				token, ok := got["token"].(string)
				if !ok {
					t.Fatalf("missing token: %v", got)
				}
				id, err := service.VerifyJWT(token)
				if err != nil || id != userID {
					t.Fatalf("Go must accept issued token: id=%q err=%v", id, err)
				}
				parts := strings.Split(token, ".")
				claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
				if err != nil {
					t.Fatal(err)
				}
				var claims map[string]any
				if err = json.Unmarshal(claimsBytes, &claims); err != nil {
					t.Fatal(err)
				}
				iat, exp := int64(claims["iat"].(float64)), int64(claims["exp"].(float64))
				if claims["email"] != email || iat < started.Unix() || iat > finished.Unix() || exp-iat != 7*24*3600 || len(claims) != 4 {
					t.Fatalf("invalid JWT claims: %v", claims)
				}
				if len(cookies) != 1 {
					t.Fatalf("expected one cookie: %v", cookies)
				}
				cookie := cookies[0]
				if cookie.Name != cookieName || cookie.Value != token || cookie.Path != "/" || !cookie.HttpOnly || cookie.Secure != secure || cookie.SameSite != sameSite || cookie.MaxAge != 0 || cookie.Domain != "" {
					t.Fatalf("cookie policy mismatch: %#v", cookie)
				}
				if persistent {
					if cookie.Expires.Unix() < started.Add(7*24*time.Hour).Unix() || cookie.Expires.Unix() > finished.Add(7*24*time.Hour).Unix() {
						t.Fatalf("cookie expiry=%v", cookie.Expires)
					}
					cookie.Expires = time.Unix(0, 0).UTC()
				} else if !cookie.Expires.IsZero() {
					t.Fatalf("session cookie has expiry: %v", cookie.Expires)
				}
				cookie.Value = "independently validated token"
				cookie.Raw = ""
				cookie.RawExpires = ""
				got["token"] = "independently validated token"
			} else if len(cookies) != 0 {
				t.Fatalf("error must not issue cookie: %v", cookies)
			}
			if index == 0 {
				expected, expectedCookies = got, cookies
			} else if !reflect.DeepEqual(expected, got) || !reflect.DeepEqual(expectedCookies, cookies) {
				t.Fatalf("Rust=%#v cookies=%#v\nGo=%#v cookies=%#v", got, cookies, expected, expectedCookies)
			}
		}
	}
	body := func(address, password string, extra string) string {
		return fmt.Sprintf(`{"email":%q,"password":%q%s}`, address, password, extra)
	}
	for _, tc := range []struct {
		name, input string
		status      int
		persistent  bool
	}{
		{"verified password", body(email, password, ""), 200, true},
		{"normalized email", body(" \t"+strings.ToUpper(email)+"\n", password, ""), 200, true},
		{"Unicode simple email lowercase", body(strings.Replace(strings.ToUpper(email), "I", "İ", 1), password, ""), 200, true},
		{"NFKC password", body(email, "cafe\u0301-password", ""), 200, true},
		{"remember true", body(email, password, `,"rememberMe":true`), 200, true},
		{"remember false", body(email, password, `,"rememberMe":false`), 200, false},
		{"remember null", body(email, password, `,"rememberMe":null`), 200, true},
		{"case folded fields", fmt.Sprintf(`{"EMAIL":%q,"Paſſword":%q,"REMEMBERME":false}`, email, password), 200, false},
		{"duplicate email and null", fmt.Sprintf(`{"email":%q,"email":null,"password":%q}`, email, password), 200, true},
		{"duplicate remember null", body(email, password, `,"rememberMe":false,"rememberMe":null`), 200, true},
		{"wrong password", body(email, "wrong-password", ""), 401, true},
		{"unknown email", body(unknown, password, ""), 401, true},
		{"invalid email", body("invalid", password, ""), 401, true},
		{"empty object", `{}`, 401, true},
		{"null body", `null`, 401, true},
		{"null strings", `{"email":null,"password":null}`, 401, true},
		{"empty body", ``, 400, true},
		{"array body", `[]`, 400, true},
		{"invalid string field", `{"email":42}`, 400, true},
		{"invalid bool field", body(email, password, `,"rememberMe":"true"`), 400, true},
		{"unknown field", body(email, password, `,"unexpected":true`), 400, true},
		{"trailing JSON", body(email, password, "") + `{}`, 400, true},
		{"oversized first value", `{"password":"` + strings.Repeat("x", 32768) + `"}`, 413, true},
		{"oversized trailing whitespace", body(email, password, "") + strings.Repeat(" ", 32768), 400, true},
		{"truncated Unicode password", fmt.Sprintf(`{"email":%q,"password":"`, email) + string([]byte{0xf0, 0x9f}) + `"}`, 401, true},
	} {
		t.Run(tc.name, func(t *testing.T) { compare(t, tc.input, tc.status, tc.persistent) })
	}
	t.Run("unverified account", func(t *testing.T) {
		exec(`UPDATE users SET email_verified=false WHERE id=$1`, userID)
		compare(t, body(email, password, ""), 401, true)
		compare(t, body(email, "wrong-password", ""), 401, true)
		exec(`UPDATE users SET email_verified=true WHERE id=$1`, userID)
	})
	t.Run("domain with a trailing dot and an earlier separator", func(t *testing.T) {
		original := email
		email += "."
		exec(`UPDATE users SET email=$1 WHERE id=$2`, email, userID)
		defer func() {
			exec(`UPDATE users SET email=$1 WHERE id=$2`, original, userID)
			email = original
		}()
		compare(t, body(email, password, ""), 200, true)
	})
	for _, tc := range []struct {
		name, provider string
		value          any
	}{
		{"passwordless", "credential", nil},
		{"empty hash", "credential", ""},
		{"legacy hash", "credential", "reset-required"},
		{"nonhex hash", "credential", strings.Repeat("z", 32) + ":" + strings.Repeat("g", 128)},
		{"wrong provider", "google", hash},
	} {
		t.Run(tc.name, func(t *testing.T) {
			credential(tc.provider, tc.value)
			compare(t, body(email, password, ""), 401, true)
		})
	}
	t.Run("latest non-null credential wins", func(t *testing.T) {
		credential("credential", hash)
		exec(`INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES($1,$2,'credential',$2,'reset-required','2026-01-03','2026-01-03'),($3,$2,'credential',$2,NULL,'2026-01-04','2026-01-04')`, uuid.NewString(), userID, uuid.NewString())
		compare(t, body(email, password, ""), 401, true)
	})
	t.Run("current balance and image", func(t *testing.T) {
		credential("credential", hash)
		for _, millis := range []int64{0, 1, 9223372036854775807} {
			exec(`UPDATE users SET balance_millis=$1,image=NULL WHERE id=$2`, millis, userID)
			compare(t, body(email, password, ""), 200, true)
		}
	})
	t.Run("proxy precedence and byte truncation", func(t *testing.T) {
		defer func() { proxyHeaders = nil }()
		for _, tc := range []struct {
			name    string
			headers map[string]string
			key     string
		}{
			{"CF wins", map[string]string{"CF-Connecting-IP": proxy, "X-Forwarded-For": "ignored-" + proxy + ", next", "X-Real-IP": "ignored-real-" + proxy}, proxy},
			{"XFF fallback", map[string]string{"CF-Connecting-IP": " ", "X-Forwarded-For": " " + proxy + " , next", "X-Real-IP": "ignored-real-" + proxy}, proxy},
			{"real fallback", map[string]string{"CF-Connecting-IP": " ", "X-Forwarded-For": " , next", "X-Real-IP": " " + proxy + " "}, proxy},
			{"UTF8 truncated byte", map[string]string{"CF-Connecting-IP": strings.Repeat("x", 127) + "é"}, strings.Repeat("x", 127) + string([]byte{0xc3})},
			{"raw non-UTF8 CF", map[string]string{"CF-Connecting-IP": " \t" + string([]byte{0xff}) + " \t", "X-Forwarded-For": "ignored-" + proxy}, string([]byte{0xff})},
			{"raw non-UTF8 XFF", map[string]string{"X-Forwarded-For": " " + string([]byte{0xff}) + " , next", "X-Real-IP": "ignored-" + proxy}, string([]byte{0xff})},
			{"Unicode trimming around non-UTF8 CF", map[string]string{"CF-Connecting-IP": "\u0085" + string([]byte{0xff}) + "\u00a0", "X-Forwarded-For": "ignored-" + proxy}, string([]byte{0xff})},
		} {
			t.Run(tc.name, func(t *testing.T) {
				proxyHeaders = tc.headers
				for index, base := range []string{reference.URL, target} {
					reset("auth-sign-in-ip", tc.key)
					reset("auth-sign-in-email", unknown)
					res, data, _, _ := request(base, body(unknown, "wrong", ""), proxy)
					if res.StatusCode != 401 {
						t.Fatalf("server=%d status=%d body=%s", index, res.StatusCode, data)
					}
					var count int
					if err := db.QueryRow(`SELECT request_count FROM api_rate_limits WHERE scope='auth-sign-in-ip' AND key_hash=$1 ORDER BY window_start DESC LIMIT 1`, keyHash("auth-sign-in-ip", tc.key)).Scan(&count); err != nil || count != 1 {
						t.Fatalf("server=%d wrong IP key: count=%d err=%v", index, count, err)
					}
				}
			})
		}
	})
	for _, tc := range []struct {
		name         string
		limit        int
		emailCounter bool
	}{
		{"email rate limit", 10, true}, {"IP rate limit", 30, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			address := "signin-rate-" + uuid.NewString()
			rateEmail := "signin-rate-" + uuid.NewString() + "@example.test"
			var expected map[string]any
			for index, base := range []string{reference.URL, target} {
				reset("auth-sign-in-ip", address)
				reset("auth-sign-in-email", rateEmail)
				for n := 1; n <= tc.limit+1; n++ {
					value := rateEmail
					if !tc.emailCounter {
						value = fmt.Sprintf("%d-%s", n, rateEmail)
						reset("auth-sign-in-email", value)
					}
					res, data, _, _ := request(base, body(value, "wrong", ""), address)
					want := 401
					if n > tc.limit {
						want = 429
					}
					if res.StatusCode != want {
						t.Fatalf("server=%d request=%d status=%d want=%d body=%s", index, n, res.StatusCode, want, data)
					}
					if n <= tc.limit {
						continue
					}
					if res.Header.Get("Content-Type") != "application/json; charset=utf-8" {
						t.Fatalf("rate content type=%q", res.Header.Get("Content-Type"))
					}
					var result map[string]any
					if err := json.Unmarshal(data, &result); err != nil {
						t.Fatal(err)
					}
					retry := int(result["retry_after"].(float64))
					if retry < 1 || retry > 900 || res.Header.Get("Retry-After") != fmt.Sprint(retry) {
						t.Fatalf("invalid retry: %v %v", res.Header, result)
					}
					result["retry_after"] = "independently validated fixed-window retry"
					if index == 0 {
						expected = result
					} else if !reflect.DeepEqual(expected, result) {
						t.Fatalf("Rust=%v Go=%v", result, expected)
					}
				}
				for scope, key := range map[string]string{"auth-sign-in-ip": address, "auth-sign-in-email": rateEmail} {
					if !tc.emailCounter && scope == "auth-sign-in-email" {
						continue
					}
					var count int
					if err := db.QueryRow(`SELECT request_count FROM api_rate_limits WHERE scope=$1 AND key_hash=$2 ORDER BY window_start DESC LIMIT 1`, scope, keyHash(scope, key)).Scan(&count); err != nil || count != tc.limit+1 {
						t.Fatalf("scope=%s count=%d err=%v", scope, count, err)
					}
				}
			}
		})
	}
}
