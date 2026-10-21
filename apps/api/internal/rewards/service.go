package rewards

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

var (
	ErrDisabled        = errors.New("ad rewards are unavailable")
	ErrUserNotFound    = errors.New("user not found")
	ErrSessionNotFound = errors.New("ad reward session not found")
	ErrSessionExpired  = errors.New("ad reward session expired")
)

// Reasons a user cannot earn right now.
const (
	ReasonEmailUnverified = "email_unverified"
	ReasonAccountTooNew   = "account_too_new"
	ReasonDailyCap        = "daily_cap"
	ReasonMonthlyCap      = "monthly_cap"
	ReasonCooldown        = "cooldown"
)

// Denied reports why a user cannot earn and, when it is a matter of waiting,
// when they next can.
type Denied struct {
	Reason  string
	RetryAt *time.Time
}

func (d Denied) Error() string { return "ad reward unavailable: " + d.Reason }

// TooEarly rejects a claim made before the minimum watch time has passed. The
// session stays claimable, so the client can retry at ClaimableAt.
type TooEarly struct{ ClaimableAt time.Time }

func (TooEarly) Error() string { return "ad reward claimed too early" }

// Status is what the earn UI shows before offering an ad.
type Status struct {
	Enabled             bool
	Reason              string
	RewardMillis        int64
	ViewsLeftToday      int
	MillisLeftThisMonth int64
	NextAvailableAt     *time.Time
	MinWatch            time.Duration
}

// Session is an issued ad view waiting for its claim.
type Session struct {
	ID          string
	ClaimableAt time.Time
	ExpiresAt   time.Time
}

// Claim is a credited view.
type Claim struct{ AwardedMillis, BalanceMillis int64 }

// Store is the persistence behind the ad reward routes.
type Store interface {
	Status(ctx context.Context, userID string) (Status, error)
	Issue(ctx context.Context, userID string) (Session, error)
	Claim(ctx context.Context, userID, sessionID string) (Claim, error)
}

// Service is the PostgreSQL Store. Time comes from the database clock so caps
// and watch times agree across API instances.
type Service struct {
	DB     *sql.DB
	Config Config
}

func (s Service) Status(ctx context.Context, userID string) (Status, error) {
	if !s.Config.Enabled {
		return Status{}, nil
	}
	current, err := loadUsage(ctx, s.DB, userID)
	if err != nil {
		return Status{}, err
	}
	return s.Config.evaluate(current), nil
}

// Issue opens a session for one ad view, replacing any session the user left
// unclaimed. Eligibility is checked here so an ad is never shown for a view
// that cannot be credited.
func (s Service) Issue(ctx context.Context, userID string) (Session, error) {
	if !s.Config.Enabled {
		return Session{}, ErrDisabled
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback()
	if _, err := lockUser(ctx, tx, userID); err != nil {
		return Session{}, err
	}
	current, err := loadUsage(ctx, tx, userID)
	if err != nil {
		return Session{}, err
	}
	status := s.Config.evaluate(current)
	if status.Reason != "" {
		recordSession(ctx, status.Reason)
		return Session{}, Denied{status.Reason, status.NextAvailableAt}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE ad_reward_sessions SET status = 'expired' WHERE user_id = $1 AND status = 'issued'`, userID); err != nil {
		return Session{}, err
	}
	id, err := randomID()
	if err != nil {
		return Session{}, err
	}
	session := Session{ID: id, ClaimableAt: current.now.Add(s.Config.MinWatch), ExpiresAt: current.now.Add(s.Config.SessionTTL)}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ad_reward_sessions (id, user_id, reward_millis, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5)`, session.ID, userID, status.RewardMillis, current.now, session.ExpiresAt); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(); err != nil {
		return Session{}, err
	}
	recordSession(ctx, "issued")
	return session, nil
}

// Claim credits a session once. A repeated claim of a credited session returns
// the original award, so a retried request never credits twice.
func (s Service) Claim(ctx context.Context, userID, sessionID string) (Claim, error) {
	if !s.Config.Enabled {
		return Claim{}, ErrDisabled
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Claim{}, err
	}
	defer tx.Rollback()
	// Claims of one user serialize on the balance row, which also makes the
	// cap check below race-free.
	balance, err := lockUser(ctx, tx, userID)
	if err != nil {
		return Claim{}, err
	}
	var status string
	var reward int64
	var issuedAt, expiresAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT status, reward_millis, issued_at, expires_at FROM ad_reward_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE`, sessionID, userID).Scan(&status, &reward, &issuedAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Claim{}, ErrSessionNotFound
	}
	if err != nil {
		return Claim{}, err
	}
	if status == "claimed" {
		return Claim{reward, balance}, tx.Commit()
	}
	current, err := loadUsage(ctx, tx, userID)
	if err != nil {
		return Claim{}, err
	}
	if status != "issued" || !current.now.Before(expiresAt) {
		recordClaim(ctx, "expired")
		if err := expire(ctx, tx, sessionID); err != nil {
			return Claim{}, err
		}
		return Claim{}, ErrSessionExpired
	}
	if claimable := issuedAt.Add(s.Config.MinWatch); current.now.Before(claimable) {
		recordClaim(ctx, "too_early")
		return Claim{}, TooEarly{claimable}
	}
	// The cooldown gated this session when it was issued; only the caps and
	// eligibility can have changed since.
	current.lastClaim = sql.NullTime{}
	verdict := s.Config.evaluate(current)
	if verdict.Reason != "" {
		recordClaim(ctx, verdict.Reason)
		if err := expire(ctx, tx, sessionID); err != nil {
			return Claim{}, err
		}
		return Claim{}, Denied{verdict.Reason, verdict.NextAvailableAt}
	}
	award := min(reward, verdict.MillisLeftThisMonth)
	if _, err := tx.ExecContext(ctx, `UPDATE ad_reward_sessions SET status = 'claimed', reward_millis = $1, claimed_at = $2 WHERE id = $3`, award, current.now, sessionID); err != nil {
		return Claim{}, err
	}
	if err := tx.QueryRowContext(ctx, `UPDATE users SET balance_millis = balance_millis + $1, updated_at = NOW() WHERE id = $2 RETURNING balance_millis`, award, userID).Scan(&balance); err != nil {
		return Claim{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO point_ledger (id, user_id, ad_reward_session_id, entry_type, delta_millis, balance_after_millis) VALUES (md5(random()::text || clock_timestamp()::text), $1, $2, 'ad_reward', $3, $4)`, userID, sessionID, award, balance); err != nil {
		return Claim{}, err
	}
	if err := tx.Commit(); err != nil {
		return Claim{}, err
	}
	recordClaim(ctx, "credited")
	return Claim{award, balance}, nil
}

// usage is a user's eligibility and ad earnings as of the database clock.
type usage struct {
	verified    bool
	createdAt   time.Time
	now         time.Time
	viewsToday  int
	monthMillis int64
	lastClaim   sql.NullTime
}

type querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func loadUsage(ctx context.Context, q querier, userID string) (usage, error) {
	var current usage
	err := q.QueryRowContext(ctx, `
		SELECT u.email_verified, u.created_at, b.now,
			COUNT(s.id) FILTER (WHERE s.claimed_at >= b.day_start),
			COALESCE(SUM(s.reward_millis), 0),
			(SELECT MAX(claimed_at) FROM ad_reward_sessions WHERE user_id = u.id AND status = 'claimed')
		FROM users u
		CROSS JOIN (SELECT NOW() AS now, date_trunc('day', NOW(), 'UTC') AS day_start, date_trunc('month', NOW(), 'UTC') AS month_start) b
		LEFT JOIN ad_reward_sessions s ON s.user_id = u.id AND s.status = 'claimed' AND s.claimed_at >= b.month_start
		WHERE u.id = $1
		GROUP BY u.id, b.now, b.day_start`, userID).Scan(&current.verified, &current.createdAt, &current.now, &current.viewsToday, &current.monthMillis, &current.lastClaim)
	if errors.Is(err, sql.ErrNoRows) {
		return usage{}, ErrUserNotFound
	}
	return current, err
}

// evaluate decides whether a view can be credited now and how much it earns.
func (c Config) evaluate(current usage) Status {
	now := current.now.UTC()
	status := Status{
		Enabled:             true,
		RewardMillis:        c.RewardMillis,
		ViewsLeftToday:      max(0, c.DailyViews-current.viewsToday),
		MillisLeftThisMonth: max(0, c.MonthlyMillis-current.monthMillis),
		MinWatch:            c.MinWatch,
	}
	status.RewardMillis = min(status.RewardMillis, status.MillisLeftThisMonth)
	deny := func(reason string, retryAt *time.Time) Status {
		status.Reason, status.NextAvailableAt = reason, retryAt
		return status
	}
	if !current.verified {
		return deny(ReasonEmailUnverified, nil)
	}
	if adult := current.createdAt.Add(c.MinAccountAge); now.Before(adult) {
		return deny(ReasonAccountTooNew, &adult)
	}
	if status.MillisLeftThisMonth == 0 {
		nextMonth := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		return deny(ReasonMonthlyCap, &nextMonth)
	}
	if status.ViewsLeftToday == 0 {
		tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
		return deny(ReasonDailyCap, &tomorrow)
	}
	if current.lastClaim.Valid {
		if ready := current.lastClaim.Time.Add(c.Cooldown); now.Before(ready) {
			return deny(ReasonCooldown, &ready)
		}
	}
	return status
}

func lockUser(ctx context.Context, tx *sql.Tx, userID string) (int64, error) {
	var balance int64
	err := tx.QueryRowContext(ctx, `SELECT balance_millis FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&balance)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrUserNotFound
	}
	return balance, err
}

// expire retires a session and commits, so a rejected claim cannot be retried.
func expire(ctx context.Context, tx *sql.Tx, sessionID string) error {
	if _, err := tx.ExecContext(ctx, `UPDATE ad_reward_sessions SET status = 'expired' WHERE id = $1 AND status = 'issued'`, sessionID); err != nil {
		return err
	}
	return tx.Commit()
}

func randomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	bytes[6] = bytes[6]&0x0f | 0x40
	bytes[8] = bytes[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
