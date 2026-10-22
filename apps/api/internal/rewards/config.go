// Package rewards credits points for rewarded ad views.
//
// Web rewarded ads have no server-side verification: the browser alone sees
// the ad network's grant event. Every claim is therefore treated as possibly
// forged, and the caps here bound what a forged claim can earn.
package rewards

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds the reward economics. Every value is deployment configuration
// so it can be tuned from observed fill and eCPM without a release.
type Config struct {
	Enabled bool
	// AdUnit is the Google Ad Manager rewarded ad unit path the web client
	// requests, such as /1234567/slidesage_rewarded.
	AdUnit string
	// RewardMillis is the credit for one completed view.
	RewardMillis int64
	// DailyViews caps claimed views per user per UTC day.
	DailyViews int
	// MonthlyMillis caps ad credit per user per UTC calendar month.
	MonthlyMillis int64
	// MinWatch is the shortest accepted time between issuing a session and
	// claiming it, which a script must wait out like a viewer.
	MinWatch time.Duration
	// Cooldown separates one claimed view from the next session.
	Cooldown time.Duration
	// SessionTTL is how long an issued session can still be claimed.
	SessionTTL time.Duration
	// MinAccountAge keeps freshly created accounts from earning.
	MinAccountAge time.Duration
}

// DefaultConfig is the reward economics documented in docs/AD_REWARDS.md.
func DefaultConfig() Config {
	return Config{
		RewardMillis:  5000,
		DailyViews:    5,
		MonthlyMillis: 60000,
		MinWatch:      15 * time.Second,
		Cooldown:      time.Minute,
		SessionTTL:    10 * time.Minute,
		MinAccountAge: 24 * time.Hour,
	}
}

// ConfigFromEnv reads AD_REWARD* variables over DefaultConfig. Ad rewards stay
// off unless AD_REWARDS_ENABLED is true and an ad unit is configured.
func ConfigFromEnv() Config {
	config := DefaultConfig()
	config.Enabled, _ = strconv.ParseBool(strings.TrimSpace(os.Getenv("AD_REWARDS_ENABLED")))
	config.AdUnit = strings.TrimSpace(os.Getenv("AD_REWARD_GPT_AD_UNIT"))
	config.RewardMillis = int64(envInt("AD_REWARD_POINTS_PER_VIEW", int(config.RewardMillis/1000))) * 1000
	config.DailyViews = envInt("AD_REWARD_DAILY_VIEWS", config.DailyViews)
	config.MonthlyMillis = int64(envInt("AD_REWARD_MONTHLY_POINTS", int(config.MonthlyMillis/1000))) * 1000
	config.MinWatch = time.Duration(envInt("AD_REWARD_MIN_WATCH_SECONDS", int(config.MinWatch/time.Second))) * time.Second
	config.Cooldown = time.Duration(envInt("AD_REWARD_COOLDOWN_SECONDS", int(config.Cooldown/time.Second))) * time.Second
	config.SessionTTL = time.Duration(envInt("AD_REWARD_SESSION_TTL_SECONDS", int(config.SessionTTL/time.Second))) * time.Second
	config.MinAccountAge = time.Duration(envInt("AD_REWARD_MIN_ACCOUNT_AGE_HOURS", int(config.MinAccountAge/time.Hour))) * time.Hour
	// A configuration that can never credit points is the same as disabled.
	if config.AdUnit == "" || config.RewardMillis <= 0 || config.DailyViews <= 0 || config.MonthlyMillis <= 0 || config.SessionTTL <= config.MinWatch {
		config.Enabled = false
	}
	return config
}

// envInt reads a non-negative integer, falling back on a missing or invalid value.
func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value < 0 {
		return fallback
	}
	return value
}
