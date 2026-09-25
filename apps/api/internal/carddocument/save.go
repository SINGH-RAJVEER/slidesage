package carddocument

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var operationIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

type saveRequest struct {
	BaseRevision int             `json:"baseRevision"`
	OperationID  string          `json:"operationId"`
	Document     json.RawMessage `json:"document"`
}

// save stores an edited document as a new revision. The editor names the
// revision it edited; if another save landed first the request conflicts and
// nothing is written, so an edit never overwrites a newer one. Repeating an
// operation ID returns the revision the first request produced.
func (handler Handler) save(writer http.ResponseWriter, request *http.Request) {
	userID, err := handler.Identity(request)
	if err != nil || strings.TrimSpace(userID) == "" {
		writeError(writer, http.StatusUnauthorized, "Authentication required")
		return
	}
	if handler.Store == nil || handler.Converter == nil {
		writeError(writer, http.StatusServiceUnavailable, "Editing is not available")
		return
	}
	ctx := request.Context()
	raw, err := io.ReadAll(io.LimitReader(request.Body, MaxDocumentBytes+64<<10))
	if err != nil || len(raw) > MaxDocumentBytes+32<<10 {
		writeError(writer, http.StatusRequestEntityTooLarge, "The presentation is too large to save")
		return
	}
	var input saveRequest
	if err := json.Unmarshal(raw, &input); err != nil || input.BaseRevision < 1 || !operationIDPattern.MatchString(input.OperationID) || len(input.Document) == 0 {
		writeError(writer, http.StatusBadRequest, "Request must name a base revision, an operation ID, and a document")
		return
	}
	presentationID := request.PathValue("id")
	var status string
	err = handler.DB.QueryRowContext(ctx, `SELECT COALESCE(slides_data->>'status', '') FROM presentations WHERE id = $1 AND user_id = $2`, presentationID, userID).Scan(&status)
	if err != nil {
		writeError(writer, http.StatusNotFound, "Presentation not found")
		return
	}
	if status != "ready" {
		writeError(writer, http.StatusConflict, "This presentation cannot be edited while it is generating or failed")
		return
	}
	assetIDs, err := AssetIDsFor(ctx, handler.DB, presentationID)
	if err != nil {
		handler.fail(ctx, writer, "list presentation assets", err)
		return
	}
	document, issue, err := handler.Converter.ValidateDocument(ctx, input.Document, assetIDs)
	if err != nil {
		handler.fail(ctx, writer, "validate edited document", err)
		return
	}
	if issue != nil {
		writeJSON(writer, http.StatusUnprocessableEntity, map[string]any{"error": map[string]string{"message": "The presentation is not valid: " + issue.String()}, "issue": issue})
		return
	}
	revision, err := Prepare(ctx, handler.Store, PrepareInput{
		PresentationID: presentationID,
		AuthorID:       userID,
		OperationID:    input.OperationID,
		OperationKind:  OperationManualEdit,
		Document:       document,
		Provenance:     map[string]string{"source": "editor"},
	})
	if err != nil {
		handler.fail(ctx, writer, "store edited document", err)
		return
	}
	var shape struct {
		Title string `json:"title"`
	}
	_ = json.Unmarshal(document, &shape)

	tx, err := handler.DB.BeginTx(ctx, nil)
	if err != nil {
		handler.fail(ctx, writer, "begin save", err)
		return
	}
	defer tx.Rollback()
	committed, err := CommitTx(ctx, tx, input.BaseRevision, revision)
	switch {
	case errors.Is(err, ErrRevisionConflict):
		current, _ := CurrentRevision(ctx, handler.DB, presentationID, userID)
		writeJSON(writer, http.StatusConflict, map[string]any{"error": map[string]string{"message": "This presentation was changed elsewhere. Reload it before editing."}, "currentRevision": current.Number})
		return
	case errors.Is(err, ErrUnknownAsset):
		writeError(writer, http.StatusUnprocessableEntity, "The presentation shows an image it does not have")
		return
	case err != nil:
		handler.fail(ctx, writer, "commit edited document", err)
		return
	}
	if !committed.Duplicate {
		summary, _ := json.Marshal(map[string]any{
			"title":           shape.Title,
			"totalSlides":     committed.Revision.CardCount,
			"currentRevision": map[string]any{"revision": committed.Revision.Number, "cardCount": committed.Revision.CardCount},
		})
		if _, err := tx.ExecContext(ctx, `UPDATE presentations SET title = $1, slides_data = slides_data || $2::jsonb, revision = revision + 1, updated_at = NOW() WHERE id = $3`, shape.Title, summary, presentationID); err != nil {
			handler.fail(ctx, writer, "update presentation summary", err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		handler.fail(ctx, writer, "commit save", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"revision": committed.Revision, "document": document})
}
