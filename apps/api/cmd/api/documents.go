package main

import (
	"database/sql"
	"fmt"
	"net/http"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cache"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/stockimages"
)

// registerDocumentRoutes serves PostgreSQL documents. Object storage is optional
// for document access, but required for stored image uploads and reads.
func registerDocumentRoutes(mux *http.ServeMux, database *sql.DB, identity func(*http.Request) (string, error), store cache.Store) error {
	handler := carddocument.Handler{DB: database, Identity: identity, Converter: carddocument.ConverterFromEnv(), Stock: stockimages.FromEnv(), Cache: store}
	objects, err := carddocument.StoreFromEnv()
	if err != nil {
		return fmt.Errorf("open presentation object store: %w", err)
	}
	if objects != nil {
		handler.Store = objects
	}
	carddocument.RegisterRoutes(mux, handler)
	return nil
}
