package cardconverter

import (
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPathnameResolvesDotSegmentsLikeTheURLParser(t *testing.T) {
	cases := map[string]string{
		"/v1/./templates":              "/v1/templates",
		"/discard/../v1/templates":     "/v1/templates",
		"/discard/%2e%2E/v1/templates": "/v1/templates",
		`/v1\templates`:                "/v1/templates",
		"/v1/templates/.":              "/v1/templates/",
		"/v1/templates/..":             "/v1/",
		"/v1//templates":               "/v1//templates",
		"/v1/%74emplates":              "/v1/%74emplates",
	}
	for path, want := range cases {
		if got := pathname(path); got != want {
			t.Errorf("pathname(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestDecodeUTF8ReplacesMaximalSubparts(t *testing.T) {
	raw, _ := hex.DecodeString("efbbbfe28241eda080f09080c0afff")
	if got := decodeUTF8(raw); got != "�A�������" {
		t.Fatalf("decodeUTF8 = %q", got)
	}
}

func TestDecodeBase64IsLenientLikeBuffer(t *testing.T) {
	cases := map[string]string{"QUJD": "414243", "QU JD": "414243", "QU*JD": "414243", "-_-_": "fbffbf", "QQ=QQ": "41", "Q": "", "QUJDRA": "41424344"}
	for text, want := range cases {
		if got := hex.EncodeToString(decodeBase64(text)); got != want {
			t.Errorf("decodeBase64(%q) = %s, want %s", text, got, want)
		}
	}
}

func TestRefusesAnotherSchemaVersion(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/templates", strings.NewReader(`{"templateId":"grove-lesson"}`))
	request.Header.Add(SchemaVersionHeader, "3")
	request.Header.Add(SchemaVersionHeader, "3")
	Handler{}.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict || recorder.Body.String() != `{"error":"schema version 3, 3 is not served; this converter serves 3"}` {
		t.Fatalf("%d %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json;charset=utf-8" {
		t.Fatalf("content type %q", got)
	}
}
