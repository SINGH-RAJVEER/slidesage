package rewards

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeStore struct {
	status    Status
	err       error
	claimedBy string
}

func (s *fakeStore) Status(context.Context, string) (Status, error) { return s.status, s.err }

func (s *fakeStore) Issue(context.Context, string) (Session, error) {
	return Session{ID: "session-1", ClaimableAt: time.Unix(15, 0), ExpiresAt: time.Unix(600, 0)}, s.err
}

func (s *fakeStore) Claim(_ context.Context, _ string, sessionID string) (Claim, error) {
	s.claimedBy = sessionID
	return Claim{2000, 12000}, s.err
}

func TestRoutesMapOutcomes(t *testing.T) {
	signedIn := func(*http.Request) (string, error) { return "user-1", nil }
	later := time.Now().Add(time.Hour)
	for _, item := range []struct {
		name     string
		method   string
		path     string
		identity Identity
		err      error
		status   int
		code     string
	}{
		{"signed out", http.MethodGet, "/rewards/ads", func(*http.Request) (string, error) { return "", errors.New("no session") }, nil, http.StatusUnauthorized, ""},
		{"issued", http.MethodPost, "/rewards/ads/sessions", signedIn, nil, http.StatusCreated, ""},
		{"disabled", http.MethodPost, "/rewards/ads/sessions", signedIn, ErrDisabled, http.StatusNotFound, "AD_REWARDS_UNAVAILABLE"},
		{"unverified", http.MethodPost, "/rewards/ads/sessions", signedIn, Denied{Reason: ReasonEmailUnverified}, http.StatusForbidden, "AD_REWARD_INELIGIBLE"},
		{"capped", http.MethodPost, "/rewards/ads/sessions", signedIn, Denied{ReasonDailyCap, &later}, http.StatusTooManyRequests, "AD_REWARD_LIMITED"},
		{"claimed", http.MethodPost, "/rewards/ads/sessions/session-1/claim", signedIn, nil, http.StatusOK, ""},
		{"early", http.MethodPost, "/rewards/ads/sessions/session-1/claim", signedIn, TooEarly{later}, http.StatusConflict, "AD_REWARD_TOO_EARLY"},
		{"expired", http.MethodPost, "/rewards/ads/sessions/session-1/claim", signedIn, ErrSessionExpired, http.StatusGone, "AD_REWARD_SESSION_EXPIRED"},
	} {
		store := &fakeStore{err: item.err}
		mux := http.NewServeMux()
		RegisterRoutes(mux, store, item.identity)
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, httptest.NewRequest(item.method, item.path, nil))
		if recorder.Code != item.status {
			t.Fatalf("%s: status = %d, body = %s", item.name, recorder.Code, recorder.Body)
		}
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(recorder.Body.Bytes(), &body)
		if body.Error.Code != item.code {
			t.Fatalf("%s: code = %q", item.name, body.Error.Code)
		}
		if item.status == http.StatusTooManyRequests && recorder.Header().Get("Retry-After") == "" {
			t.Fatalf("%s: missing Retry-After", item.name)
		}
		if item.name == "claimed" && store.claimedBy != "session-1" {
			t.Fatalf("claimed session %q", store.claimedBy)
		}
	}
}

func TestStatusReportsPoints(t *testing.T) {
	next := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	store := &fakeStore{status: Status{Enabled: true, Reason: ReasonDailyCap, RewardMillis: 2000, MillisLeftThisMonth: 50000, NextAvailableAt: &next, MinWatch: 15 * time.Second}}
	mux := http.NewServeMux()
	RegisterRoutes(mux, store, func(*http.Request) (string, error) { return "user-1", nil })
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/rewards/ads", nil))
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["eligible"] != false || body["reason"] != ReasonDailyCap || body["points_per_view"] != 2.0 || body["points_left_this_month"] != 50.0 || body["next_available_at"] != "2026-11-01T00:00:00Z" || body["min_watch_seconds"] != 15.0 {
		t.Fatalf("status body = %v", body)
	}
}
