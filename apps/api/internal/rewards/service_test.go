package rewards

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestEvaluateOrdersDenials(t *testing.T) {
	config := DefaultConfig()
	now := time.Date(2026, 10, 31, 22, 0, 0, 0, time.UTC)
	adult := usage{verified: true, createdAt: now.Add(-48 * time.Hour), now: now}
	for _, item := range []struct {
		name    string
		usage   usage
		reason  string
		retryAt time.Time
		reward  int64
	}{
		{"eligible", adult, "", time.Time{}, 5000},
		{"unverified", usage{createdAt: adult.createdAt, now: now}, ReasonEmailUnverified, time.Time{}, 5000},
		{"new account", usage{verified: true, createdAt: now.Add(-time.Hour), now: now}, ReasonAccountTooNew, now.Add(23 * time.Hour), 5000},
		{"daily cap", usage{verified: true, createdAt: adult.createdAt, now: now, viewsToday: 5, monthMillis: 10000}, ReasonDailyCap, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), 5000},
		{"monthly cap", usage{verified: true, createdAt: adult.createdAt, now: now, viewsToday: 5, monthMillis: 60000}, ReasonMonthlyCap, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), 0},
		{"partial month", usage{verified: true, createdAt: adult.createdAt, now: now, monthMillis: 59000}, "", time.Time{}, 1000},
		{"cooldown", usage{verified: true, createdAt: adult.createdAt, now: now, lastClaim: sql.NullTime{Time: now.Add(-10 * time.Second), Valid: true}}, ReasonCooldown, now.Add(50 * time.Second), 5000},
	} {
		status := config.evaluate(item.usage)
		if status.Reason != item.reason || status.RewardMillis != item.reward {
			t.Fatalf("%s: reason %q reward %d", item.name, status.Reason, status.RewardMillis)
		}
		if (status.NextAvailableAt == nil) != item.retryAt.IsZero() || status.NextAvailableAt != nil && !status.NextAvailableAt.Equal(item.retryAt) {
			t.Fatalf("%s: next available %v, want %v", item.name, status.NextAvailableAt, item.retryAt)
		}
	}
}

func TestClaimCreditsOnceAfterMinimumWatch(t *testing.T) {
	database := integrationDatabase(t)
	service := Service{DB: database, Config: enabledConfig()}
	ctx := context.Background()
	userID := insertUser(t, database, true, 48*time.Hour)

	session, err := service.Issue(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	var early TooEarly
	if _, err := service.Claim(ctx, userID, session.ID); !errors.As(err, &early) {
		t.Fatalf("immediate claim error = %v, want TooEarly", err)
	}
	if _, err := service.Claim(ctx, insertUser(t, database, true, 48*time.Hour), session.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("other user's claim error = %v", err)
	}
	watched(t, database, session.ID)

	// Retried claims race on the balance row; exactly one may credit.
	var wait sync.WaitGroup
	results := make([]Claim, 4)
	failures := make([]error, 4)
	for index := range results {
		wait.Add(1)
		go func() {
			defer wait.Done()
			results[index], failures[index] = service.Claim(ctx, userID, session.ID)
		}()
	}
	wait.Wait()
	for index, claim := range results {
		if failures[index] != nil || claim != (Claim{5000, 15000}) {
			t.Fatalf("claim %d = %+v, %v", index, claim, failures[index])
		}
	}
	var entries int
	var delta int64
	if err := database.QueryRow(`SELECT COUNT(*), COALESCE(SUM(delta_millis), 0) FROM point_ledger WHERE user_id = $1 AND entry_type = 'ad_reward'`, userID).Scan(&entries, &delta); err != nil {
		t.Fatal(err)
	}
	if entries != 1 || delta != 5000 {
		t.Fatalf("ledger has %d ad credits totalling %d", entries, delta)
	}

	var denied Denied
	if _, err := service.Issue(ctx, userID); !errors.As(err, &denied) || denied.Reason != ReasonCooldown {
		t.Fatalf("issue during cooldown error = %v", err)
	}
}

func TestIssueRejectsIneligibleUsers(t *testing.T) {
	database := integrationDatabase(t)
	service := Service{DB: database, Config: enabledConfig()}
	for _, item := range []struct {
		verified bool
		age      time.Duration
		reason   string
	}{{false, 48 * time.Hour, ReasonEmailUnverified}, {true, time.Hour, ReasonAccountTooNew}} {
		var denied Denied
		if _, err := service.Issue(context.Background(), insertUser(t, database, item.verified, item.age)); !errors.As(err, &denied) || denied.Reason != item.reason {
			t.Fatalf("issue error = %v, want %s", err, item.reason)
		}
	}
	if _, err := (Service{DB: database}).Issue(context.Background(), "anyone"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled issue error = %v", err)
	}
}

func TestClaimRetiresExpiredAndOverCapSessions(t *testing.T) {
	database := integrationDatabase(t)
	service := Service{DB: database, Config: enabledConfig()}
	ctx := context.Background()
	userID := insertUser(t, database, true, 48*time.Hour)

	first, err := service.Issue(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`UPDATE ad_reward_sessions SET issued_at = NOW() - INTERVAL '20 minutes', expires_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Claim(ctx, userID, first.ID); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("expired claim error = %v", err)
	}

	// Another tab spends the day's views while this session's ad plays.
	second, err := service.Issue(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	for range 5 {
		id, err := randomID()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := database.Exec(`INSERT INTO ad_reward_sessions (id, user_id, status, reward_millis, issued_at, expires_at, claimed_at) VALUES ($1, $2, 'claimed', 5000, NOW() - INTERVAL '3 hours', NOW(), date_trunc('day', NOW(), 'UTC') + INTERVAL '1 second')`, id, userID); err != nil {
			t.Fatal(err)
		}
	}
	watched(t, database, second.ID)
	var denied Denied
	if _, err := service.Claim(ctx, userID, second.ID); !errors.As(err, &denied) || denied.Reason != ReasonDailyCap {
		t.Fatalf("over-cap claim error = %v", err)
	}
	if _, err := service.Claim(ctx, userID, second.ID); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("retried over-cap claim error = %v", err)
	}
	status, err := service.Status(ctx, userID)
	if err != nil || status.Reason != ReasonDailyCap || status.ViewsLeftToday != 0 {
		t.Fatalf("status = %+v, %v", status, err)
	}
}

func enabledConfig() Config {
	config := DefaultConfig()
	config.Enabled = true
	return config
}

// watched backdates a session past the minimum watch time.
func watched(t *testing.T, database *sql.DB, sessionID string) {
	t.Helper()
	if _, err := database.Exec(`UPDATE ad_reward_sessions SET issued_at = NOW() - INTERVAL '30 seconds' WHERE id = $1`, sessionID); err != nil {
		t.Fatal(err)
	}
}

func integrationDatabase(t *testing.T) *sql.DB {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgresql://slidesage:slidesage@127.0.0.1:5432/slidesage"
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Skipf("open PostgreSQL integration database: %v", err)
	}
	if err := database.PingContext(context.Background()); err != nil {
		database.Close()
		t.Skipf("PostgreSQL integration database is unavailable: %v", err)
	}
	var table sql.NullString
	if err := database.QueryRow(`SELECT to_regclass('ad_reward_sessions')`).Scan(&table); err != nil || !table.Valid {
		database.Close()
		t.Skip("ad reward migration is not applied")
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

// insertUser creates a user holding 10 points and removes it after the test.
func insertUser(t *testing.T, database *sql.DB, verified bool, age time.Duration) string {
	t.Helper()
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		t.Fatal(err)
	}
	suffix := hex.EncodeToString(value)
	userID := "reward-user-" + suffix
	if _, err := database.Exec(`INSERT INTO users (id, name, email, email_verified, balance_millis, created_at) VALUES ($1, 'Reward Test', $2, $3, 10000, NOW() - make_interval(secs => $4))`, userID, suffix+"@rewards.test", verified, age.Seconds()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = database.Exec(`DELETE FROM users WHERE id = $1`, userID) })
	return userID
}

func TestConfigFromEnvNeedsAnAdUnit(t *testing.T) {
	t.Setenv("AD_REWARDS_ENABLED", "true")
	t.Setenv("AD_REWARD_GPT_AD_UNIT", "")
	if ConfigFromEnv().Enabled {
		t.Fatal("enabled without an ad unit")
	}
	t.Setenv("AD_REWARD_GPT_AD_UNIT", " /1234/rewarded ")
	t.Setenv("AD_REWARD_POINTS_PER_VIEW", "3")
	config := ConfigFromEnv()
	if !config.Enabled || config.AdUnit != "/1234/rewarded" || config.RewardMillis != 3000 || config.DailyViews != 5 {
		t.Fatalf("config = %+v", config)
	}
}
