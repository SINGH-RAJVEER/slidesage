// Command seed adds the documented test user to the local development
// database. It refuses to run against any database that is not on this
// machine, because the user's password is public.
package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/auth"
)

// The test user's credentials, documented in docs/DEVELOPMENT_SETUP.md.
const (
	testName        = "Test User"
	testEmail       = "test@slidesage.local"
	testPassword    = "slidesage-test"
	testSlideTokens = 500
)

func main() {
	session := flag.Bool("session", false, "also print a signed-in session cookie for browser automation")
	flag.Parse()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL must be set")
	}
	if err := requireLocalDatabase(databaseURL); err != nil {
		log.Fatal(err)
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	service, err := auth.NewService(auth.Config{
		Database:   database,
		AuthSecret: env("AUTH_SECRET", "slidesage-local-development-secret"),
	})
	if err != nil {
		log.Fatal(err)
	}
	user, err := service.SeedUser(ctx, testName, testEmail, testPassword, testSlideTokens)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Seeded %s (%s)\nEmail:    %s\nPassword: %s\n", user.Name, user.ID, testEmail, testPassword)

	if *session {
		signedIn, _, err := service.SignIn(ctx, testEmail, testPassword)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("Cookie:   slidesage_token=%s\n", signedIn.Token)
	}
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
