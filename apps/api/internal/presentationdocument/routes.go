// Package presentationdocument exposes owner-checked canonical revision artifacts.
package presentationdocument

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/pptxcompiler"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentationrevision"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/slidepreview"
	"github.com/riverqueue/river"
)

// slideEditorProvider marks the revisions this API writes itself, as opposed to
// the ones a third-party editor saves.
const slideEditorProvider = "slidesage-viewer"

type Handler struct {
	DB       *sql.DB
	Objects  presentationrevision.ObjectStore
	Identity func(*http.Request) (string, error)
	Queue    *river.Client[*sql.Tx]
}

func RegisterRoutes(mux *http.ServeMux, h Handler) {
	mux.HandleFunc("GET /presentations/{id}/revision", h.download)
	mux.HandleFunc("GET /presentations/{id}/revision/status", h.status)
	mux.HandleFunc("GET /presentations/{id}/revisions", h.history)
	mux.HandleFunc("GET /presentations/{id}/revisions/{revision}/previews/{index}", h.preview)
	mux.HandleFunc("GET /presentations/{id}/revisions/{revision}/pdf", h.pdf)
	mux.HandleFunc("POST /presentations/{id}/revisions/{revision}/previews/retry", h.retry)
	mux.HandleFunc("DELETE /presentations/{id}/revisions/{revision}/slides/{index}", h.deleteSlide)
}
func fail(w http.ResponseWriter, status int, message string) { http.Error(w, message, status) }
func respond(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(value)
}
func (h Handler) owned(w http.ResponseWriter, r *http.Request) (string, int, bool) {
	user, err := h.Identity(r)
	if err != nil || user == "" {
		fail(w, 401, "authentication required")
		return "", 0, false
	}
	var number int
	err = h.DB.QueryRowContext(r.Context(), `SELECT COALESCE(current_pptx_revision,0) FROM presentations WHERE id=$1 AND user_id=$2`, r.PathValue("id"), user).Scan(&number)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "presentation not found")
		return "", 0, false
	}
	if err != nil {
		fail(w, 500, "could not read presentation")
		return "", 0, false
	}
	return user, number, true
}
func (h Handler) revision(w http.ResponseWriter, r *http.Request) (presentationrevision.Revision, bool) {
	_, current, ok := h.owned(w, r)
	if !ok {
		return presentationrevision.Revision{}, false
	}
	value := r.PathValue("revision")
	if value == "" {
		value = r.URL.Query().Get("revision")
	}
	number := current
	if value != "" {
		var err error
		number, err = strconv.Atoi(value)
		if err != nil || number <= 0 {
			fail(w, 400, "invalid revision")
			return presentationrevision.Revision{}, false
		}
	}
	if number == 0 {
		fail(w, 409, "presentation has no PPTX revision; regenerate it")
		return presentationrevision.Revision{}, false
	}
	revision, found, err := presentationrevision.NewPostgresRepository(h.DB).FindRevision(r.Context(), r.PathValue("id"), presentationrevision.RevisionNumber(number))
	if err != nil {
		fail(w, 500, "could not read revision")
		return revision, false
	}
	if !found {
		fail(w, 404, "revision not found")
		return revision, false
	}
	return revision, true
}
func (h Handler) status(w http.ResponseWriter, r *http.Request) {
	revision, ok := h.revision(w, r)
	if !ok {
		return
	}
	respond(w, presentationrevision.Snapshot(revision))
}
func (h Handler) stream(w http.ResponseWriter, r *http.Request, key, mime string) {
	if h.Objects == nil {
		fail(w, 503, "document storage unavailable")
		return
	}
	object, err := h.Objects.OpenObject(r.Context(), key)
	if errors.Is(err, presentationrevision.ErrObjectNotFound) {
		fail(w, 404, "artifact not found")
		return
	}
	if err != nil {
		fail(w, 500, "could not read artifact")
		return
	}
	defer object.Close()
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, object)
}
func (h Handler) download(w http.ResponseWriter, r *http.Request) {
	revision, ok := h.revision(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="presentation.pptx"`)
	h.stream(w, r, revision.ObjectKey, revision.MIMEType)
}
func (h Handler) preview(w http.ResponseWriter, r *http.Request) {
	revision, ok := h.revision(w, r)
	if !ok {
		return
	}
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil || index < 0 || index >= revision.SlideCount {
		fail(w, 404, "slide not found")
		return
	}
	if revision.PreviewStatus != presentationrevision.PreviewReady {
		fail(w, 409, "previews are not ready")
		return
	}
	h.stream(w, r, presentationrevision.PreviewObjectKey(revision.PresentationID, revision.Number, index), presentationrevision.PreviewContentType)
}
func (h Handler) pdf(w http.ResponseWriter, r *http.Request) {
	revision, ok := h.revision(w, r)
	if !ok {
		return
	}
	if revision.PreviewStatus != presentationrevision.PreviewReady {
		fail(w, 409, "PDF is still processing")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="presentation.pdf"`)
	h.stream(w, r, presentationrevision.PDFObjectKey(revision.PresentationID, revision.Number), "application/pdf")
}
func (h Handler) retry(w http.ResponseWriter, r *http.Request) {
	revision, ok := h.revision(w, r)
	if !ok {
		return
	}
	if revision.PreviewStatus == presentationrevision.PreviewReady {
		respond(w, map[string]string{"status": "ready"})
		return
	}
	if err := slidepreview.EnqueueNow(r.Context(), h.Queue, revision.PresentationID, revision.Number); err != nil {
		fail(w, 503, "could not schedule previews")
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
func (h Handler) history(w http.ResponseWriter, r *http.Request) {
	_, _, ok := h.owned(w, r)
	if !ok {
		return
	}
	rows, err := h.DB.QueryContext(r.Context(), `SELECT revision,source_operation_kind,created_at,preview_status FROM presentation_revisions WHERE presentation_id=$1 ORDER BY revision DESC LIMIT 100`, r.PathValue("id"))
	if err != nil {
		fail(w, 500, "could not read revisions")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var number int
		var source, status string
		var created any
		if err := rows.Scan(&number, &source, &created, &status); err != nil {
			fail(w, 500, "could not read revision")
			return
		}
		items = append(items, map[string]any{"revision": number, "source": source, "createdAt": created, "previewStatus": status})
	}
	if rows.Err() != nil {
		fail(w, 500, "could not read revisions")
		return
	}
	respond(w, items)
}

// deleteSlide commits a new revision of the deck without one slide. Revisions
// are immutable, so the slide is not erased: the deletion is the next revision,
// and the one before it stays in the history. The operation ID is derived from
// the revision and slide, so a retried request returns the revision the first
// attempt committed instead of deleting a second slide.
func (h Handler) deleteSlide(w http.ResponseWriter, r *http.Request) {
	user, current, ok := h.owned(w, r)
	if !ok {
		return
	}
	number, err := strconv.Atoi(r.PathValue("revision"))
	if err != nil || number <= 0 {
		fail(w, 400, "invalid revision")
		return
	}
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil || index < 0 {
		fail(w, 404, "slide not found")
		return
	}
	// Deleting rewrites the deck, so it may only start from the revision the
	// viewer is showing. An older one would silently discard newer work.
	if number != current {
		fail(w, 409, "this presentation has changed; reload before deleting a slide")
		return
	}
	if h.Objects == nil {
		fail(w, 503, "document storage unavailable")
		return
	}
	repository := presentationrevision.NewPostgresRepository(h.DB)
	source, found, err := repository.FindRevision(r.Context(), r.PathValue("id"), presentationrevision.RevisionNumber(number))
	if err != nil {
		fail(w, 500, "could not read revision")
		return
	}
	if !found {
		fail(w, 404, "revision not found")
		return
	}
	if index >= source.SlideCount {
		fail(w, 404, "slide not found")
		return
	}
	object, err := h.Objects.OpenObject(r.Context(), source.ObjectKey)
	if errors.Is(err, presentationrevision.ErrObjectNotFound) {
		fail(w, 404, "artifact not found")
		return
	}
	if err != nil {
		fail(w, 500, "could not read artifact")
		return
	}
	contents, err := io.ReadAll(io.LimitReader(object, presentationrevision.DefaultMaxPPTXBytes+1))
	object.Close()
	if err != nil {
		fail(w, 500, "could not read artifact")
		return
	}
	reduced, err := pptxcompiler.RemoveSlide(contents, index+1)
	if errors.Is(err, pptxcompiler.ErrLastSlide) {
		fail(w, 409, "a presentation must keep at least one slide")
		return
	}
	if err != nil {
		fail(w, 422, "this presentation's slide could not be removed")
		return
	}
	base := source.Number
	committed, err := presentationrevision.NewService(repository, h.Objects, 0).Commit(r.Context(), presentationrevision.CommitInput{
		PresentationID:   source.PresentationID,
		AuthorID:         user,
		Operation:        presentationrevision.SourceOperation{ID: fmt.Sprintf("slide-delete:%d:%d", number, index), Kind: presentationrevision.SourceOperationEditorSave},
		ExpectedRevision: base,
		BaseRevision:     &base,
		PPTX:             bytes.NewReader(reduced),
		MIMEType:         presentationrevision.PPTXContentType,
		EditorProvider:   slideEditorProvider,
	})
	if errors.Is(err, presentationrevision.ErrRevisionConflict) {
		fail(w, 409, "this presentation has changed; reload before deleting a slide")
		return
	}
	if err != nil {
		fail(w, 500, "could not save the presentation")
		return
	}
	// The revision is committed and downloadable even when the render queue is
	// unreachable, and the viewer can ask for previews again.
	_ = slidepreview.EnqueueNow(r.Context(), h.Queue, committed.Revision.PresentationID, committed.Revision.Number)
	respond(w, presentationrevision.Snapshot(committed.Revision))
}
