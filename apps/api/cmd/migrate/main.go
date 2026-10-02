package main

import (
	"context"
	"database/sql"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river/riverdriver/riverdatabasesql"
	"github.com/riverqueue/river/rivermigrate"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/migrations"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL must be set")
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()
	database.SetMaxOpenConns(1)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	pingContext, cancelPing := context.WithTimeout(ctx, time.Duration(envInt("DATABASE_CONNECT_TIMEOUT", 10))*time.Second)
	if err := database.PingContext(pingContext); err != nil {
		cancelPing()
		log.Fatal(err)
	}
	cancelPing()
	if _, err := database.ExecContext(ctx, `SET lock_timeout = '30s'`); err != nil {
		log.Fatal(err)
	}
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatal(err)
	}
	if err := goose.UpContext(ctx, database, "."); err != nil {
		log.Fatal(err)
	}

	migrator, err := rivermigrate.New(riverdatabasesql.New(database), nil)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		log.Fatal(err)
	}
	purgeLegacyObjects(ctx)
}

// purgeLegacyObjects deletes what the retired pipelines left in the image
// bucket. A failure is logged rather than fatal: the schema is already
// migrated, a failed release would leave services paused, and the next run
// tries again.
func purgeLegacyObjects(ctx context.Context) {
	bucket := strings.TrimSpace(os.Getenv("PRESENTATION_GCS_BUCKET"))
	if bucket == "" {
		return
	}
	store, err := carddocument.NewGCSBlobStore(ctx, bucket)
	if err != nil {
		log.Printf("legacy objects were not purged: %v", err)
		return
	}
	defer store.Close()
	deleted, err := store.DeleteLegacyObjects(ctx)
	if err != nil {
		log.Printf("legacy objects were not all purged (%d deleted): %v", deleted, err)
		return
	}
	log.Printf("deleted %d legacy objects", deleted)
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
