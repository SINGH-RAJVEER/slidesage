package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteErrorCodeUsesBetterAuthErrorShape(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeErrorCode(recorder, http.StatusConflict, "email address is not verified", "EMAIL_NOT_VERIFIED")

	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected status %d, got %d", http.StatusConflict, recorder.Code)
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["code"] != "EMAIL_NOT_VERIFIED" || response["message"] != "email address is not verified" {
		t.Fatalf("unexpected response: %#v", response)
	}
	if _, nested := response["error"]; nested {
		t.Fatalf("coded Better Auth errors must not be nested: %#v", response)
	}
}

func TestWriteServiceErrorReportsMissingAccountForPasswordReset(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeServiceError(recorder, ErrAccountNotFound)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, recorder.Code)
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["code"] != "ACCOUNT_NOT_FOUND" {
		t.Fatalf("expected an ACCOUNT_NOT_FOUND code, got: %#v", response)
	}
	message, _ := response["message"].(string)
	if !strings.Contains(message, "Create an account") {
		t.Fatalf("expected the message to point at sign-up, got: %q", message)
	}
}
