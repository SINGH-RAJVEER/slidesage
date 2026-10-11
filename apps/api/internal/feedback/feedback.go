// Package feedback stores free-form product feedback from signed-in users.
package feedback

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// MaxMessageLength is the longest accepted message, in characters.
const MaxMessageLength = 4000

const bodyLimit int64 = 32 * 1024

// Identity resolves the current authenticated user for feedback routes.
type Identity func(*http.Request) (string, error)

// Store persists one feedback message and returns its ID and creation time.
type Store interface {
	Save(ctx context.Context, userID, message string) (string, time.Time, error)
}

// Repository is the PostgreSQL Store.
type Repository struct{ DB *sql.DB }

func (r Repository) Save(ctx context.Context, userID, message string) (string, time.Time, error) {
	if r.DB == nil {
		return "", time.Time{}, errors.New("feedback database is required")
	}
	id, err := randomID()
	if err != nil {
		return "", time.Time{}, err
	}
	var createdAt time.Time
	err = r.DB.QueryRowContext(ctx, `INSERT INTO feedback (id, user_id, message) VALUES ($1, $2, $3) RETURNING created_at`, id, userID, message).Scan(&createdAt)
	return id, createdAt, err
}

// RegisterRoutes adds the authenticated POST /feedback route.
func RegisterRoutes(mux *http.ServeMux, store Store, identity Identity) {
	if mux == nil {
		panic("feedback mux is required")
	}
	mux.HandleFunc("POST /feedback", router{store: store, identity: identity}.submit)
}

type router struct {
	store    Store
	identity Identity
}

func (r router) submit(w http.ResponseWriter, request *http.Request) {
	if r.identity == nil {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	userID, err := r.identity(request)
	if err != nil || strings.TrimSpace(userID) == "" {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	var input struct {
		Message string `json:"message"`
	}
	if err := decodeJSON(request, &input); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			writeError(w, http.StatusRequestEntityTooLarge, "Request body is too large")
		} else {
			writeError(w, http.StatusBadRequest, "Invalid request body")
		}
		return
	}
	message := strings.TrimSpace(input.Message)
	if message == "" {
		writeError(w, http.StatusBadRequest, "Feedback cannot be empty")
		return
	}
	if utf8.RuneCountInString(message) > MaxMessageLength {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Feedback must be at most %d characters", MaxMessageLength))
		return
	}
	id, createdAt, err := r.store.Save(request.Context(), userID, message)
	if err != nil {
		slog.ErrorContext(request.Context(), "feedback save failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, "Could not save feedback")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"feedback": map[string]any{"id": id, "created_at": createdAt.UTC().Format(time.RFC3339Nano)}})
}

func decodeJSON(request *http.Request, output any) error {
	body := http.MaxBytesReader(nil, request.Body, bodyLimit)
	defer body.Close()
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"message": message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func randomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	bytes[6] = bytes[6]&0x0f | 0x40
	bytes[8] = bytes[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
