package carddocument

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
)

var storedAssetKey = regexp.MustCompile(`^presentations/[^/]+/assets/[0-9a-f]{64}\.(jpg|png)$`)

// DeleteObject removes only stored image objects. Missing objects are success.
func (store *GCSBlobStore) DeleteObject(ctx context.Context, key string) error {
	if !storedAssetKey.MatchString(key) || validateObjectKey(key) != nil {
		return errors.New("invalid image object key")
	}
	return store.backend.Delete(ctx, key)
}

// CleanupDeletedAssets processes a bounded batch of committed deletion requests.
// Failures remain queued. A crash after GCS deletion is safe to retry, and row
// locks prevent concurrent maintenance jobs from processing the same request.
func CleanupDeletedAssets(ctx context.Context, database *sql.DB, store interface {
	DeleteObject(context.Context, string) error
}, limit int) (int, error) {
	if limit <= 0 {
		return 0, errors.New("image cleanup limit must be positive")
	}
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT object_key FROM card_asset_deletions
		WHERE retry_after <= now() ORDER BY retry_after, object_key LIMIT $1 FOR UPDATE SKIP LOCKED`, limit)
	if err != nil {
		return 0, err
	}
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return 0, err
		}
		keys = append(keys, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	deleted := 0
	var failures []error
	for _, key := range keys {
		// A recreated presentation may have registered the same immutable image.
		var referenced bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM card_assets WHERE object_key = $1)`, key).Scan(&referenced); err != nil {
			return 0, err
		}
		if !referenced {
			if err := store.DeleteObject(ctx, key); err != nil {
				failures = append(failures, fmt.Errorf("delete image %s: %w", key, err))
				if _, err := tx.ExecContext(ctx, `UPDATE card_asset_deletions SET retry_after = now() + interval '15 minutes' WHERE object_key = $1`, key); err != nil {
					return 0, err
				}
				continue
			}
			deleted++
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM card_asset_deletions WHERE object_key = $1`, key); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return deleted, errors.Join(failures...)
}
