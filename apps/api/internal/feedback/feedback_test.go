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
	} {
		store := &recordingStore{}
		recorder := httptest.NewRecorder()
		router{store: store, identity: item.identity}.submit(recorder, httptest.NewRequest(http.MethodPost, "/feedback", strings.NewReader(item.body)))
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
