package feedback

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type recordingStore struct{ userID, message string }

func (s *recordingStore) Save(_ context.Context, userID, message string) (string, time.Time, error) {
	s.userID, s.message = userID, message
	return "feedback-1", time.Unix(0, 0), nil
}

func TestSubmitValidatesAndStoresTrimmedFeedback(t *testing.T) {
	signedIn := func(*http.Request) (string, error) { return "user-1", nil }
	for _, item := range []struct {
		name     string
		identity Identity
		body     string
		status   int
	}{
		{"signed out", func(*http.Request) (string, error) { return "", errors.New("no session") }, `{"message":"hi"}`, http.StatusUnauthorized},
		{"blank", signedIn, `{"message":"   "}`, http.StatusBadRequest},
		{"unknown field", signedIn, `{"message":"hi","rating":5}`, http.StatusBadRequest},
		{"too long", signedIn, `{"message":"` + strings.Repeat("é", MaxMessageLength+1) + `"}`, http.StatusBadRequest},
		{"stored", signedIn, `{"message":"  Love the themes  "}`, http.StatusCreated},
		{"case insensitive field", signedIn, `{"Message":"  Love the themes  "}`, http.StatusCreated},
		{"null after value", signedIn, `{"message":"Love the themes","message":null}`, http.StatusCreated},
		{"trailing JSON", signedIn, `{"message":"hi"} {}`, http.StatusBadRequest},
		{"null body", signedIn, `null`, http.StatusBadRequest},
		{"null message", signedIn, `{"message":null}`, http.StatusBadRequest},
		{"wrong message type", signedIn, `{"message":42}`, http.StatusBadRequest},
		{"Unicode field folding", signedIn, `{"meſſage":"Love the themes"}`, http.StatusCreated},
		{"oversized value", signedIn, `{"message":"` + strings.Repeat("x", 33*1024) + `"}`, http.StatusRequestEntityTooLarge},
		{"oversized trailing whitespace", signedIn, `{"message":"hi"}` + strings.Repeat(" ", 33*1024), http.StatusBadRequest},
	} {
		store := &recordingStore{}
		recorder := httptest.NewRecorder()
		submitFeedbackForTest(t, store, item.identity, recorder, httptest.NewRequest(http.MethodPost, "/feedback", strings.NewReader(item.body)))
		if recorder.Code != item.status {
			t.Fatalf("%s: status = %d, body = %s", item.name, recorder.Code, recorder.Body)
		}
		stored := item.status == http.StatusCreated
		if stored != (store.message != "") {
			t.Fatalf("%s: stored message = %q", item.name, store.message)
		}
		if stored && (store.userID != "user-1" || store.message != "Love the themes") {
			t.Fatalf("%s: stored %q for %q", item.name, store.message, store.userID)
		}
	}
}

func TestSubmitPreservesGoUnicodeDecoding(t *testing.T) {
	signedIn := func(*http.Request) (string, error) { return "user-1", nil }
	for _, item := range []struct{ body, expected string }{
		{`{"message":"\ud800"}`, "\ufffd"},
		{`{"message":"\udc00"}`, "\ufffd"},
		{`{"message":"\ud83d\ude00"}`, "\U0001f600"},
		{`{"message":"\\ud800"}`, `\ud800`},
		{"{\"message\":\"\xff\"}", "\ufffd"},
		{"{\"message\":\"\xe2\x82\"}", "\ufffd\ufffd"},
	} {
		store := &recordingStore{}
		recorder := httptest.NewRecorder()
		submitFeedbackForTest(t, store, signedIn, recorder, httptest.NewRequest(http.MethodPost, "/feedback", strings.NewReader(item.body)))
		if recorder.Code != http.StatusCreated || store.userID != "user-1" || store.message != item.expected {
			t.Fatalf("Unicode decode differs: status=%d message=%q expected=%q", recorder.Code, store.message, item.expected)
		}
	}
}
