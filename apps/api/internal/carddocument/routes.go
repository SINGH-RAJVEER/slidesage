package carddocument

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/stockimages"
)

// Handler serves card documents to their owners, and read-only to anyone
// holding a live share link.
type Handler struct {
	DB    *sql.DB
	Store ObjectStore
	// Converter validates edited documents; without it the save route
	// reports that editing is unavailable.
	Converter *Converter
	// Stock lists the stock photo libraries, the default first; none
	// disables photo search.
	Stock    []stockimages.Source
	Identity func(*http.Request) (string, error)
}

func RegisterRoutes(mux *http.ServeMux, handler Handler) {
	mux.HandleFunc("GET /presentations/{id}/document", handler.current)
	mux.HandleFunc("GET /presentations/{id}/assets/{sha256}", handler.asset)
	mux.HandleFunc("PUT /presentations/{id}/document", handler.save)
	mux.HandleFunc("GET /images/search", handler.searchPhotos)
	mux.HandleFunc("POST /presentations/{id}/assets/stock", handler.addStockPhoto)
	mux.HandleFunc("POST /presentations/{id}/assets/upload", handler.uploadPhoto)
	mux.HandleFunc("GET /presentations/{id}/export/pptx", handler.exportPptx)
	mux.HandleFunc("GET /presentations/{id}/share", handler.getShare)
	mux.HandleFunc("POST /presentations/{id}/share", handler.createShare)
	mux.HandleFunc("DELETE /presentations/{id}/share", handler.revokeShare)
	mux.HandleFunc("GET /shared/{token}", handler.shared)
	mux.HandleFunc("GET /shared/{token}/assets/{sha256}", handler.sharedAsset)
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
	ids, err := ReferencedAssets(document)
	if err != nil {
		handler.fail(ctx, writer, "read card document assets", err)
		return
	}
	assets, err := AssetsFor(ctx, handler.DB, revision.PresentationID, ids)
	if err != nil {
		handler.fail(ctx, writer, "load card document assets", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"revision": revision, "document": document, "assets": assets})
}

// asset serves one stored image to the presentation's owner. Assets are
// content-addressed, so a response never changes and may be cached for good.
func (handler Handler) asset(writer http.ResponseWriter, request *http.Request) {
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
	presentationID, digest := request.PathValue("id"), request.PathValue("sha256")
	var owner string
	err = handler.DB.QueryRowContext(ctx, `SELECT user_id FROM presentations WHERE id = $1`, presentationID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && owner != userID) {
		writeError(writer, http.StatusNotFound, "Image not found")
		return
	}
	if err != nil {
		handler.fail(ctx, writer, "load image owner", err)
		return
	}
	handler.serveAsset(writer, request, presentationID, digest)
}

func (handler Handler) serveAsset(writer http.ResponseWriter, request *http.Request, presentationID, digest string) {
	ctx := request.Context()
	assets, err := AssetsFor(ctx, handler.DB, presentationID, []string{digest})
	if err != nil {
		handler.fail(ctx, writer, "load image asset", err)
		return
	}
	asset, found := assets[digest]
	if !found {
		writeError(writer, http.StatusNotFound, "Image not found")
		return
	}
	etag := `"` + asset.SHA256 + `"`
	if request.Header.Get("If-None-Match") == etag {
		writer.WriteHeader(http.StatusNotModified)
		return
	}
	reader, err := handler.Store.OpenObject(ctx, asset.ObjectKey)
	if err != nil {
		handler.fail(ctx, writer, "open image asset", err)
		return
	}
	defer reader.Close()
	writer.Header().Set("Content-Type", asset.MIMEType)
	writer.Header().Set("Content-Length", strconv.FormatInt(asset.ByteSize, 10))
	writer.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	writer.Header().Set("ETag", etag)
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.WriteHeader(http.StatusOK)
	_, _ = io.Copy(writer, reader)
}

func (Handler) fail(ctx context.Context, writer http.ResponseWriter, action string, err error) {
	slog.ErrorContext(ctx, action, "error", err)
	writeError(writer, http.StatusInternalServerError, "Unable to load the presentation")
}
