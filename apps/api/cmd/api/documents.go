package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/stockimages"
)

// registerDocumentRoutes serves PostgreSQL documents. Object storage is optional
// for document access, but required for stored image uploads and reads.
func registerDocumentRoutes(mux *http.ServeMux, database *sql.DB, identity func(*http.Request) (string, error)) error {
	handler := carddocument.Handler{DB: database, Identity: identity, Converter: carddocument.ConverterFromEnv(), Stock: stockimages.FromEnv()}
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
