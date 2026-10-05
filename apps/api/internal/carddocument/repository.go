package carddocument

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cache"
)

type querier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// CommitResult reports the revision a commit produced, or the revision an
// earlier commit of the same operation already produced.
type CommitResult struct {
	Revision  Revision
	Duplicate bool
}

// CommitTx records a prepared revision and advances the current pointer inside
// the caller's transaction, so the revision lands atomically with the write
// that owns it, such as generation billing.
//
// expected is the revision the writer based its work on, zero for a new
// document. A writer whose base is no longer current gets ErrRevisionConflict
// and nothing is recorded. Repeating an operation ID returns the first result.
func CommitTx(ctx context.Context, tx *sql.Tx, expected int, revision Revision) (CommitResult, error) {
	var current int
	err := tx.QueryRowContext(ctx, `SELECT COALESCE(current_card_revision, 0) FROM presentations WHERE id = $1 FOR UPDATE`, revision.PresentationID).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		return CommitResult{}, ErrPresentationMissing
	}
	if err != nil {
		return CommitResult{}, fmt.Errorf("lock presentation: %w", err)
	}
	existing, found, err := findByOperation(ctx, tx, revision.PresentationID, revision.OperationID)
	if err != nil {
		return CommitResult{}, err
	}
	if found {
		return CommitResult{Revision: existing, Duplicate: true}, nil
	}
	if expected != current {
		return CommitResult{}, ErrRevisionConflict
	}
	if len(revision.Document) == 0 || !json.Valid(revision.Document) {
		return CommitResult{}, fmt.Errorf("%w: new revisions require a JSONB body", ErrInvalidDocument)
	}
	if err := checkAssetsTx(ctx, tx, revision); err != nil {
		return CommitResult{}, err
	}
	if expected > 0 {
		base := expected
		revision.BaseRevision = &base
	}
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision), 0) + 1 FROM card_revisions WHERE presentation_id = $1`, revision.PresentationID).Scan(&revision.Number); err != nil {
		return CommitResult{}, fmt.Errorf("allocate card revision: %w", err)
	}
	provenance := revision.Provenance
	if len(provenance) == 0 {
		provenance = json.RawMessage(`{}`)
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO card_revisions (
			presentation_id, revision, sha256, byte_size, card_count, schema_version,
			author_id, operation_kind, operation_id, base_revision, provenance, document
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
		RETURNING created_at`,
		revision.PresentationID, revision.Number, revision.SHA256, revision.ByteSize,
		revision.CardCount, revision.SchemaVersion, revision.AuthorID, revision.OperationKind,
		revision.OperationID, revision.BaseRevision, []byte(provenance), []byte(revision.Document),
	).Scan(&revision.CreatedAt)
	if err != nil {
		return CommitResult{}, fmt.Errorf("insert card revision: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE presentations SET current_card_revision = $1, updated_at = NOW() WHERE id = $2`, revision.Number, revision.PresentationID); err != nil {
		return CommitResult{}, fmt.Errorf("advance current card revision: %w", err)
	}
	return CommitResult{Revision: revision}, nil
}

// CurrentRevision returns the current revision of a presentation the user owns.
func CurrentRevision(ctx context.Context, database querier, presentationID, userID string) (Revision, error) {
	return currentRevision(ctx, database, presentationID, userID, true)
}

// CachedCurrentRevision always reads ownership and the current revision from
// PostgreSQL. Only the immutable body is cached; assets and shares stay fresh.
func CachedCurrentRevision(ctx context.Context, database querier, presentationID, userID string, store cache.Store) (Revision, error) {
	if store == nil {
		return CurrentRevision(ctx, database, presentationID, userID)
	}
	revision, err := currentRevision(ctx, database, presentationID, userID, false)
	if err != nil {
		return Revision{}, err
	}
	key := cache.Key("card-body", userID, presentationID, strconv.Itoa(revision.Number), revision.SHA256)
	if body, hit := store.Get(ctx, key); hit && json.Valid(body) {
		revision.Document = append(json.RawMessage(nil), body...)
		return revision, nil
	}
	// Repeat authorization on a miss as ownership/deletion may have changed.
	var body []byte
	err = database.QueryRowContext(ctx, `SELECT r.document FROM card_revisions r
		JOIN presentations p ON p.id = r.presentation_id
		WHERE p.id = $1 AND p.user_id = $2 AND r.revision = $3`, presentationID, userID, revision.Number).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return Revision{}, ErrPresentationMissing
	}
	if err != nil {
		return Revision{}, err
	}
	revision.Document = append(json.RawMessage(nil), body...)
	if _, err := Load(revision); err != nil {
		return Revision{}, err
	}
	store.Set(ctx, key, body, time.Hour)
	return revision, nil
}

func currentRevision(ctx context.Context, database querier, presentationID, userID string, includeBody bool) (Revision, error) {
	row := database.QueryRowContext(ctx, `SELECT `+prefixed("r.", includeBody)+`
		FROM presentations p
		JOIN card_revisions r ON r.presentation_id = p.id AND r.revision = p.current_card_revision
		WHERE p.id = $1 AND p.user_id = $2`, presentationID, userID)
	revision, err := scanRevision(row)
	if errors.Is(err, sql.ErrNoRows) {
		var exists bool
		if existsErr := database.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM presentations WHERE id = $1 AND user_id = $2)`, presentationID, userID).Scan(&exists); existsErr != nil {
			return Revision{}, existsErr
		}
		if !exists {
			return Revision{}, ErrPresentationMissing
		}
		return Revision{}, ErrNoRevision
	}
	return revision, err
}

func findByOperation(ctx context.Context, database querier, presentationID, operationID string) (Revision, bool, error) {
	row := database.QueryRowContext(ctx, `SELECT `+prefixed("", true)+` FROM card_revisions WHERE presentation_id = $1 AND operation_id = $2`, presentationID, operationID)
	revision, err := scanRevision(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Revision{}, false, nil
	}
	if err != nil {
		return Revision{}, false, fmt.Errorf("find card revision by operation: %w", err)
	}
	return revision, true, nil
}

func prefixed(prefix string, includeBody bool) string {
	columns := []string{"presentation_id", "revision", "sha256", "byte_size", "card_count", "schema_version",
		"author_id", "operation_kind", "operation_id", "base_revision", "provenance", "created_at", "document"}
	result := ""
	for index, column := range columns {
		if index > 0 {
			result += ", "
		}
		if column == "document" && !includeBody {
			result += "NULL::jsonb"
		} else {
			result += prefix + column
		}
	}
	return result
}

func scanRevision(row *sql.Row) (Revision, error) {
	var revision Revision
	var base sql.NullInt64
	var provenance []byte
	var document []byte
	err := row.Scan(&revision.PresentationID, &revision.Number, &revision.SHA256, &revision.ByteSize,
		&revision.CardCount, &revision.SchemaVersion, &revision.AuthorID, &revision.OperationKind, &revision.OperationID,
		&base, &provenance, &revision.CreatedAt, &document)
	if err != nil {
		return Revision{}, err
	}
	if base.Valid {
		number := int(base.Int64)
		revision.BaseRevision = &number
	}
	revision.Provenance = append(json.RawMessage(nil), provenance...)
	revision.Document = append(json.RawMessage(nil), document...)
	return revision, nil
}
