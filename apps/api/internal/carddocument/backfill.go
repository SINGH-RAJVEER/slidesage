package carddocument

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// BackfillDocuments imports only missing bodies, committing each separately so
// interruption or a failed object can be retried without rereading completed
// revisions. Source keys and original byte metadata are retained. Run after
// Goose expansion and before deploying JSONB readers. No GCS objects are deleted.
func BackfillDocuments(ctx context.Context, database *sql.DB, store ObjectStore) error {
	for {
		var revision Revision
		var key sql.NullString
		err := database.QueryRowContext(ctx, `SELECT presentation_id, revision, object_key, sha256, byte_size, card_count, schema_version
			FROM card_revisions WHERE document IS NULL ORDER BY presentation_id, revision LIMIT 1`).Scan(
			&revision.PresentationID, &revision.Number, &key, &revision.SHA256, &revision.ByteSize, &revision.CardCount, &revision.SchemaVersion)
		if errors.Is(err, sql.ErrNoRows) {
			break
		}
		if err != nil {
			return fmt.Errorf("select missing card body: %w", err)
		}
		revision.ObjectKey = key.String
		body, err := readLegacyDocument(ctx, store, revision)
		if err != nil {
			return fmt.Errorf("backfill %s revision %d (%s): %w", revision.PresentationID, revision.Number, revision.ObjectKey, err)
		}
		result, err := database.ExecContext(ctx, `UPDATE card_revisions SET document = $1::jsonb
			WHERE presentation_id = $2 AND revision = $3 AND document IS NULL
			AND object_key = $4 AND sha256 = $5 AND byte_size = $6`,
			[]byte(body), revision.PresentationID, revision.Number, revision.ObjectKey, revision.SHA256, revision.ByteSize)
		if err != nil {
			return fmt.Errorf("import %s revision %d: %w", revision.PresentationID, revision.Number, err)
		}
		updated, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("check imported body: %w", err)
		}
		if updated == 0 {
			// A concurrent importer or account deletion can finish this row. A
			// changed source with a still-missing body must fail, not spin forever.
			var missing bool
			if err := database.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM card_revisions
				WHERE presentation_id = $1 AND revision = $2 AND document IS NULL)`,
				revision.PresentationID, revision.Number).Scan(&missing); err != nil {
				return fmt.Errorf("check concurrent import: %w", err)
			}
			if missing {
				return fmt.Errorf("backfill %s revision %d: legacy source metadata changed during import", revision.PresentationID, revision.Number)
			}
		}
	}
	// VALIDATE checks all rows under a table lock. The NOT VALID constraint has
	// already blocked new missing bodies since expansion, including old writers.
	if _, err := database.ExecContext(ctx, `ALTER TABLE card_revisions VALIDATE CONSTRAINT card_revisions_document_required`); err != nil {
		return fmt.Errorf("verify all card revision bodies are present: %w", err)
	}
	return nil
}

func readLegacyDocument(ctx context.Context, store ObjectStore, revision Revision) (json.RawMessage, error) {
	if store == nil || revision.ObjectKey == "" {
		return nil, fmt.Errorf("legacy body requires PRESENTATION_GCS_BUCKET and a source object key")
	}
	if revision.ByteSize <= 0 || revision.ByteSize > MaxDocumentBytes {
		return nil, ErrObjectSize
	}
	reader, err := store.OpenObject(ctx, revision.ObjectKey)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	body, err := io.ReadAll(io.LimitReader(reader, revision.ByteSize+1))
	if err != nil {
		return nil, fmt.Errorf("read legacy body: %w", err)
	}
	if int64(len(body)) != revision.ByteSize {
		return nil, ErrObjectSize
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != revision.SHA256 {
		return nil, ErrObjectDigest
	}
	if err := validateJSONB(body); err != nil {
		return nil, fmt.Errorf("%w: legacy source %q: %v; source object and revision metadata preserved; resolve compatibility explicitly before retrying migration, do not normalize or delete historical content", ErrInvalidDocument, revision.ObjectKey, err)
	}
	var shape documentShape
	if err := json.Unmarshal(body, &shape); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	if shape.SchemaVersion != revision.SchemaVersion || len(shape.CardOrder) != revision.CardCount ||
		revision.CardCount < 1 || revision.CardCount > 40 || len(shape.Cards) == 0 || shape.Cards[0] != '{' {
		return nil, fmt.Errorf("%w: legacy shape does not match revision metadata", ErrInvalidDocument)
	}
	return body, nil
}
