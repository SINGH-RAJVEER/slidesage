package carddocument

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// shareTokenBytes gives each link 256 bits, so a token cannot be guessed and
// the table can index its digest without a salt.
const shareTokenBytes = 32

// Share describes a presentation's live read-only link. The token itself is
// shown only when the link is created.
type Share struct {
	CreatedAt time.Time `json:"createdAt"`
	Token     string    `json:"token,omitempty"`
}

func shareDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newShareToken() (string, error) {
	raw := make([]byte, shareTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func newShareID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	raw[6] = raw[6]&0x0f | 0x40
	raw[8] = raw[8]&0x3f | 0x80
	encoded := hex.EncodeToString(raw)
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:], nil
}

// validShareToken rejects anything that could not have come from
// newShareToken before it reaches the database.
func validShareToken(token string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(decoded) == shareTokenBytes
}

// owned reports whether the signed-in user owns the presentation in the path,
// writing the refusal when they do not.
func (handler Handler) owned(writer http.ResponseWriter, request *http.Request) (string, string, bool) {
	userID, err := handler.Identity(request)
	if err != nil || strings.TrimSpace(userID) == "" {
		writeError(writer, http.StatusUnauthorized, "Authentication required")
		return "", "", false
	}
	presentationID := request.PathValue("id")
	var exists bool
	if err := handler.DB.QueryRowContext(request.Context(), `SELECT EXISTS (SELECT 1 FROM presentations WHERE id = $1 AND user_id = $2)`, presentationID, userID).Scan(&exists); err != nil {
		handler.fail(request.Context(), writer, "load presentation owner", err)
		return "", "", false
	}
	if !exists {
		writeError(writer, http.StatusNotFound, "Presentation not found")
		return "", "", false
	}
	return presentationID, userID, true
}

// getShare reports whether the presentation has a live link.
func (handler Handler) getShare(writer http.ResponseWriter, request *http.Request) {
	presentationID, _, ok := handler.owned(writer, request)
	if !ok {
		return
	}
	var share Share
	err := handler.DB.QueryRowContext(request.Context(), `SELECT created_at FROM presentation_shares WHERE presentation_id = $1 AND revoked_at IS NULL`, presentationID).Scan(&share.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(writer, http.StatusOK, map[string]any{"share": nil})
		return
	}
	if err != nil {
		handler.fail(request.Context(), writer, "load share", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"share": share})
}

// createShare issues a new link, revoking any earlier one in the same
// transaction so a presentation never has two.
func (handler Handler) createShare(writer http.ResponseWriter, request *http.Request) {
	presentationID, userID, ok := handler.owned(writer, request)
	if !ok {
		return
	}
	ctx := request.Context()
	token, err := newShareToken()
	if err != nil {
		handler.fail(ctx, writer, "create share token", err)
		return
	}
	id, err := newShareID()
	if err != nil {
		handler.fail(ctx, writer, "create share ID", err)
		return
	}
	share := Share{Token: token}
	err = handler.inTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE presentation_shares SET revoked_at = NOW() WHERE presentation_id = $1 AND revoked_at IS NULL`, presentationID); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `INSERT INTO presentation_shares (id, presentation_id, token_sha256, created_by) VALUES ($1, $2, $3, $4) RETURNING created_at`,
			id, presentationID, shareDigest(token), userID).Scan(&share.CreatedAt)
	})
	if err != nil {
		handler.fail(ctx, writer, "create share", err)
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{"share": share})
}

// revokeShare turns the live link off. Revoking when there is none succeeds.
func (handler Handler) revokeShare(writer http.ResponseWriter, request *http.Request) {
	presentationID, _, ok := handler.owned(writer, request)
	if !ok {
		return
	}
	if _, err := handler.DB.ExecContext(request.Context(), `UPDATE presentation_shares SET revoked_at = NOW() WHERE presentation_id = $1 AND revoked_at IS NULL`, presentationID); err != nil {
		handler.fail(request.Context(), writer, "revoke share", err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler Handler) inTx(ctx context.Context, work func(*sql.Tx) error) error {
	tx, err := handler.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := work(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// sharedPresentation resolves a live link to its presentation and owner. An
// unknown, malformed, or revoked token and a presentation that is not ready
// all look the same to the caller.
func (handler Handler) sharedPresentation(writer http.ResponseWriter, request *http.Request) (string, string, bool) {
	token := request.PathValue("token")
	if !validShareToken(token) {
		writeError(writer, http.StatusNotFound, "This link is not valid")
		return "", "", false
	}
	var presentationID, ownerID string
	err := handler.DB.QueryRowContext(request.Context(), `SELECT p.id, p.user_id FROM presentation_shares s
		JOIN presentations p ON p.id = s.presentation_id
		WHERE s.token_sha256 = $1 AND s.revoked_at IS NULL AND COALESCE(p.slides_data->>'status', '') = 'ready'`, shareDigest(token)).Scan(&presentationID, &ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(writer, http.StatusNotFound, "This link is not valid")
		return "", "", false
	}
	if err != nil {
		handler.fail(request.Context(), writer, "resolve share", err)
		return "", "", false
	}
	return presentationID, ownerID, true
}

// sharedSource is the part of a research source a viewer needs for a citation.
type sharedSource struct {
	URL   string `json:"url"`
	Title string `json:"title,omitempty"`
}

// shared returns the current document behind a link. It carries only what the
// deck shows: no revision provenance, author, or prompt.
func (handler Handler) shared(writer http.ResponseWriter, request *http.Request) {
	presentationID, ownerID, ok := handler.sharedPresentation(writer, request)
	if !ok {
		return
	}
	ctx := request.Context()
	revision, err := CurrentRevision(ctx, handler.DB, presentationID, ownerID)
	if errors.Is(err, ErrPresentationMissing) || errors.Is(err, ErrNoRevision) {
		writeError(writer, http.StatusNotFound, "This link is not valid")
		return
	}
	if err != nil {
		handler.fail(ctx, writer, "load shared revision", err)
		return
	}
	document, err := Load(revision)
	if err != nil {
		handler.fail(ctx, writer, "load shared document", err)
		return
	}
	ids, err := ReferencedAssets(document)
	if err != nil {
		handler.fail(ctx, writer, "read shared document assets", err)
		return
	}
	assets, err := AssetsFor(ctx, handler.DB, presentationID, ids)
	if err != nil {
		handler.fail(ctx, writer, "load shared document assets", err)
		return
	}
	var encoded []byte
	if err := handler.DB.QueryRowContext(ctx, `SELECT COALESCE(slides_data->'sources', '[]'::jsonb) FROM presentations WHERE id = $1`, presentationID).Scan(&encoded); err != nil {
		handler.fail(ctx, writer, "load shared sources", err)
		return
	}
	sources := []sharedSource{}
	_ = json.Unmarshal(encoded, &sources)
	writeJSON(writer, http.StatusOK, map[string]any{"document": document, "assets": assets, "sources": sources})
}

// sharedAsset serves an image of a shared presentation. It is cached like the
// owner's route, but only privately, so revoking a link is not undone by a
// shared cache.
func (handler Handler) sharedAsset(writer http.ResponseWriter, request *http.Request) {
	presentationID, _, ok := handler.sharedPresentation(writer, request)
	if !ok {
		return
	}
	handler.serveAsset(writer, request, presentationID, request.PathValue("sha256"))
}
