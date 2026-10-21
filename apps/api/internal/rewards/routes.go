package rewards

import (
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Identity resolves the current authenticated user for reward routes.
type Identity func(*http.Request) (string, error)

// RegisterRoutes adds the authenticated /rewards/ads routes.
func RegisterRoutes(mux *http.ServeMux, store Store, identity Identity) {
	if mux == nil {
		panic("rewards mux is required")
	}
	r := router{store: store, identity: identity}
	mux.HandleFunc("GET /rewards/ads", r.status)
	mux.HandleFunc("POST /rewards/ads/sessions", r.issue)
	mux.HandleFunc("POST /rewards/ads/sessions/{id}/claim", r.claim)
}

type router struct {
	store    Store
	identity Identity
}

func (r router) status(w http.ResponseWriter, request *http.Request) {
	userID, ok := r.userID(w, request)
	if !ok {
		return
	}
	status, err := r.store.Status(request.Context(), userID)
	if err != nil {
		r.fail(w, request, err)
		return
	}
	body := map[string]any{"enabled": status.Enabled}
	if status.Enabled {
		body["ad_unit"] = status.AdUnit
		body["eligible"] = status.Reason == ""
		body["reason"] = nullable(status.Reason)
		body["points_per_view"] = points(status.RewardMillis)
		body["views_left_today"] = status.ViewsLeftToday
		body["points_left_this_month"] = points(status.MillisLeftThisMonth)
		body["next_available_at"] = timestamp(status.NextAvailableAt)
		body["min_watch_seconds"] = int(status.MinWatch / time.Second)
	}
	writeJSON(w, http.StatusOK, body)
}

func (r router) issue(w http.ResponseWriter, request *http.Request) {
	userID, ok := r.userID(w, request)
	if !ok {
		return
	}
	session, err := r.store.Issue(request.Context(), userID)
	if err != nil {
		r.fail(w, request, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"session_id":   session.ID,
		"claimable_at": session.ClaimableAt.UTC().Format(time.RFC3339Nano),
		"expires_at":   session.ExpiresAt.UTC().Format(time.RFC3339Nano),
	})
}

func (r router) claim(w http.ResponseWriter, request *http.Request) {
	userID, ok := r.userID(w, request)
	if !ok {
		return
	}
	sessionID := request.PathValue("id")
	if sessionID == "" || len(sessionID) > 64 {
		writeError(w, http.StatusNotFound, "Ad reward session not found", "AD_REWARD_SESSION_NOT_FOUND", 0)
		return
	}
	claim, err := r.store.Claim(request.Context(), userID, sessionID)
	if err != nil {
		r.fail(w, request, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"points_awarded": points(claim.AwardedMillis), "new_balance": points(claim.BalanceMillis)})
}

func (r router) userID(w http.ResponseWriter, request *http.Request) (string, bool) {
	if r.identity == nil {
		writeError(w, http.StatusUnauthorized, "Unauthorized", "", 0)
		return "", false
	}
	userID, err := r.identity(request)
	if err != nil || strings.TrimSpace(userID) == "" {
		writeError(w, http.StatusUnauthorized, "Unauthorized", "", 0)
		return "", false
	}
	return userID, true
}

func (r router) fail(w http.ResponseWriter, request *http.Request, err error) {
	var denied Denied
	var early TooEarly
	switch {
	case errors.Is(err, ErrDisabled):
		writeError(w, http.StatusNotFound, "Ad rewards are unavailable", "AD_REWARDS_UNAVAILABLE", 0)
	case errors.Is(err, ErrSessionNotFound):
		writeError(w, http.StatusNotFound, "Ad reward session not found", "AD_REWARD_SESSION_NOT_FOUND", 0)
	case errors.Is(err, ErrSessionExpired):
		writeError(w, http.StatusGone, "Ad reward session expired", "AD_REWARD_SESSION_EXPIRED", 0)
	case errors.As(err, &early):
		writeError(w, http.StatusConflict, "Finish watching the ad to earn points", "AD_REWARD_TOO_EARLY", retryAfter(early.ClaimableAt))
	case errors.As(err, &denied) && (denied.Reason == ReasonEmailUnverified || denied.Reason == ReasonAccountTooNew):
		writeError(w, http.StatusForbidden, deniedMessage(denied.Reason), "AD_REWARD_INELIGIBLE", 0)
	case errors.As(err, &denied):
		seconds := 0
		if denied.RetryAt != nil {
			seconds = retryAfter(*denied.RetryAt)
		}
		writeError(w, http.StatusTooManyRequests, deniedMessage(denied.Reason), "AD_REWARD_LIMITED", seconds)
	default:
		slog.ErrorContext(request.Context(), "ad reward request failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, "Internal server error", "", 0)
	}
}

func deniedMessage(reason string) string {
	switch reason {
	case ReasonEmailUnverified:
		return "Verify your email to earn points from ads"
	case ReasonAccountTooNew:
		return "New accounts can earn points from ads after their first day"
	case ReasonDailyCap:
		return "You have earned today's ad points"
	case ReasonMonthlyCap:
		return "You have earned this month's ad points"
	default:
		return "Wait a moment before watching another ad"
	}
}

func retryAfter(at time.Time) int {
	return max(1, int(math.Ceil(time.Until(at).Seconds())))
}

func points(millis int64) float64 {
	return float64(millis) / 1000
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func timestamp(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func writeError(w http.ResponseWriter, status int, message, code string, retryAfter int) {
	failure := map[string]string{"message": message}
	if code != "" {
		failure["code"] = code
	}
	body := map[string]any{"error": failure}
	if retryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
		body["retry_after"] = retryAfter
	}
	writeJSON(w, status, body)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
