package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestUpsertOAuthUserCreditsSignupPoints(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgresql://slidesage:slidesage@127.0.0.1:5432/slidesage"
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Skipf("open PostgreSQL integration database: %v", err)
	}
	defer database.Close()
	if err := database.Ping(); err != nil {
		t.Skipf("PostgreSQL integration database is unavailable: %v", err)
	}
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		t.Fatal(err)
	}
	email := hex.EncodeToString(value) + "@oauth.test"

	user, err := NewRepository(database).UpsertOAuthUser(context.Background(), "google", "google-"+email, "OAuth Test", email, "", "access", "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = database.Exec(`DELETE FROM users WHERE id = $1`, user.ID) })

	var balance, credited int64
	if err := database.QueryRow(`SELECT u.balance_millis, l.delta_millis FROM users u JOIN point_ledger l ON l.user_id = u.id AND l.entry_type = 'signup_credit' WHERE u.id = $1`, user.ID).Scan(&balance, &credited); err != nil {
		t.Fatal(err)
	}
	if want := pointsToMillis(signupPoints); user.SlideTokens != signupPoints || balance != want || credited != want {
		t.Fatalf("user has %v points, balance %d, signup credit %d; want %d", user.SlideTokens, balance, credited, want)
	}
}
