package main

import (
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"testing"
)

func TestSecurityRejectsUnsafeUntrustedOrigin(t *testing.T) {
	t.Setenv("CORS_ORIGINS", "https://slidesage.app")
	handler := securityHandlerForTest(t)
	request := httptest.NewRequest(http.MethodPost, "/profile", nil)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestSecuritySetsCredentialedCORSHeaders(t *testing.T) {
	t.Setenv("CORS_ORIGINS", "https://slidesage.app")
	handler := securityHandlerForTest(t)
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("Origin", "https://slidesage.app")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Header().Get("Access-Control-Allow-Origin") != "https://slidesage.app" {
		t.Fatalf("headers: %#v", response.Header())
	}
	if response.Header().Get("Access-Control-Allow-Headers") != "Content-Type, Authorization, Idempotency-Key, Last-Event-ID" {
		t.Fatalf("allowed headers: %q", response.Header().Get("Access-Control-Allow-Headers"))
	}
	if response.Header().Get("Access-Control-Expose-Headers") != "X-Generation-Job-ID, X-Presentation-ID" {
		t.Fatalf("exposed headers: %q", response.Header().Get("Access-Control-Expose-Headers"))
	}
}

// Reuse the original request/assertion cases against an external implementation.
// Without API_UNDER_TEST_URL the normal Go test path is unchanged.
func securityHandlerForTest(t *testing.T) http.Handler {
	t.Helper()
	if target := os.Getenv("API_UNDER_TEST_URL"); target != "" {
		parsed, err := url.Parse(target)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			t.Fatalf("invalid API_UNDER_TEST_URL: %q", target)
		}
		proxy := httputil.NewSingleHostReverseProxy(parsed)
		proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
			t.Errorf("API_UNDER_TEST_URL request failed: %v", err)
			w.WriteHeader(http.StatusBadGateway)
		}
		return proxy
	}
	return withSecurity(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
}
