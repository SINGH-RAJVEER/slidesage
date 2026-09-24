package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
)

// registerDocumentRoutes serves saved card documents. Object storage is
// optional so a local API still boots without a bucket; the route then
// reports that storage is not configured.
func registerDocumentRoutes(mux *http.ServeMux, database *sql.DB, identity func(*http.Request) (string, error)) error {
	handler := carddocument.Handler{DB: database, Identity: identity}
	if bucket := strings.TrimSpace(os.Getenv("PRESENTATION_GCS_BUCKET")); bucket != "" {
		store, err := carddocument.NewGCSBlobStore(context.Background(), bucket)
		if err != nil {
			return fmt.Errorf("open presentation object store: %w", err)
		}
		handler.Store = store
	}
	carddocument.RegisterRoutes(mux, handler)
	return nil
}
