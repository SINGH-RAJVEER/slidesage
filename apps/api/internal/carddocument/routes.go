package carddocument

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
)

// Handler serves card documents to their owners.
type Handler struct {
	DB       *sql.DB
	Store    ObjectStore
	Identity func(*http.Request) (string, error)
}

func RegisterRoutes(mux *http.ServeMux, handler Handler) {
	mux.HandleFunc("GET /presentations/{id}/document", handler.current)
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]any{"error": map[string]string{"message": message}})
}

// current returns the saved card document the presentation currently points
// at, together with the revision that identifies it.
func (handler Handler) current(writer http.ResponseWriter, request *http.Request) {
	userID, err := handler.Identity(request)
	if err != nil || strings.TrimSpace(userID) == "" {
		writeError(writer, http.StatusUnauthorized, "Authentication required")
		return
	}
	if handler.Store == nil {
		writeError(writer, http.StatusServiceUnavailable, "Presentation storage is not configured")
		return
	}
	ctx := request.Context()
	revision, err := CurrentRevision(ctx, handler.DB, request.PathValue("id"), userID)
	switch {
	case errors.Is(err, ErrPresentationMissing):
		writeError(writer, http.StatusNotFound, "Presentation not found")
		return
	case errors.Is(err, ErrNoRevision):
		writeError(writer, http.StatusConflict, "This presentation has no saved document yet")
		return
	case err != nil:
		handler.fail(ctx, writer, "load card revision", err)
		return
	}
	document, err := Load(ctx, handler.Store, revision)
	if err != nil {
		handler.fail(ctx, writer, "load card document", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"revision": revision, "document": document})
}

func (Handler) fail(ctx context.Context, writer http.ResponseWriter, action string, err error) {
	slog.ErrorContext(ctx, action, "error", err)
	writeError(writer, http.StatusInternalServerError, "Unable to load the presentation")
}
