package carddocument

import (
	"context"
	"fmt"
	"regexp"
)

// legacyObject matches what the retired pipelines wrote under a presentation:
// PPTX revisions, their preview renders, and card bodies from before they
// moved into PostgreSQL. Images, under assets/, never match.
var legacyObject = regexp.MustCompile(`^presentations/[^/]+/(objects|revisions|cards)/`)

// DeleteLegacyObjects removes every legacy object from the bucket and reports
// how many it deleted. Nothing reads them, and the decks they belonged to are
// gone. Repeating it finds nothing more to delete.
func (store *GCSBlobStore) DeleteLegacyObjects(ctx context.Context) (int, error) {
	deleted := 0
	err := store.backend.EachKey(ctx, "presentations/", func(key string) error {
		if !legacyObject.MatchString(key) {
			return nil
		}
		if err := store.backend.Delete(ctx, key); err != nil {
			return fmt.Errorf("delete legacy object %s: %w", key, err)
		}
		deleted++
		return nil
	})
	return deleted, err
}
