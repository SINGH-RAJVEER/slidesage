// Package cache provides optional, disposable Valkey storage. A cache failure
// is a miss; callers retain authoritative reads and authorization in PostgreSQL.
package cache

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const MaxValueBytes = 4 << 20

type Store interface {
	Get(context.Context, string) ([]byte, bool)
	Set(context.Context, string, []byte, time.Duration)
}

// Client uses go-redis, which speaks the Redis 7.2 protocol that Valkey preserves.
type Client struct {
	valkey   *redis.Client
	timeout  time.Duration
	retryAt  atomic.Int64
	requests metric.Int64Counter
	latency  metric.Float64Histogram
}

// FromEnv does not connect during startup. An absent address disables caching.
func FromEnv() (*Client, error) {
	address := strings.TrimSpace(os.Getenv("CACHE_VALKEY_ADDR"))
	if address == "" {
		return nil, nil
	}
	authMode := os.Getenv("CACHE_VALKEY_AUTH")
	if authMode != "" && authMode != "iam" && authMode != "password" {
		return nil, errors.New("CACHE_VALKEY_AUTH must be empty, iam, or password")
	}
	password := os.Getenv("CACHE_VALKEY_PASSWORD")
	if authMode == "password" && password == "" {
		return nil, errors.New("CACHE_VALKEY_AUTH=password requires CACHE_VALKEY_PASSWORD")
	}
	// Memorystore needs TLS and IAM. A self-hosted Valkey that is reachable only
	// over a private container network needs a password instead.
	managed := authMode == "iam" && os.Getenv("CACHE_VALKEY_CA_PEM") != ""
	if os.Getenv("NODE_ENV") == "production" && !managed && authMode != "password" {
		return nil, errors.New("production cache requires TLS CA with IAM authentication, or a password")
	}
	timeout := 100 * time.Millisecond
	if raw := os.Getenv("CACHE_TIMEOUT_MS"); raw != "" {
		millis, err := strconv.Atoi(raw)
		if err != nil || millis < 1 || millis > 1000 {
			return nil, errors.New("CACHE_TIMEOUT_MS must be between 1 and 1000")
		}
		timeout = time.Duration(millis) * time.Millisecond
	}
	options := &redis.Options{
		Addr: address, Protocol: 2,
		PoolSize: 8, MaxActiveConns: 8, MinIdleConns: 0,
		DialTimeout: timeout, ReadTimeout: timeout, WriteTimeout: timeout,
		PoolTimeout: timeout, ContextTimeoutEnabled: true, MaxRetries: -1,
		ConnMaxIdleTime: time.Minute,
	}
	if authMode == "iam" {
		source, err := google.DefaultTokenSource(context.Background(), "https://www.googleapis.com/auth/cloud-platform")
		if err != nil {
			return nil, fmt.Errorf("cache IAM credentials: %w", err)
		}
		options.CredentialsProviderContext = iamCredentials(source)
	} else if authMode == "password" {
		options.Password = password
	}
	if pem := os.Getenv("CACHE_VALKEY_CA_PEM"); pem != "" {
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM([]byte(pem)) {
			return nil, errors.New("CACHE_VALKEY_CA_PEM contains no valid certificates")
		}
		options.TLSConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	}
	meter := otel.Meter("slidesage/cache")
	requests, err := meter.Int64Counter("slidesage.cache.requests")
	if err != nil {
		return nil, err
	}
	latency, err := meter.Float64Histogram("slidesage.cache.duration", metric.WithUnit("ms"))
	if err != nil {
		return nil, err
	}
	return &Client{valkey: redis.NewClient(options), timeout: timeout, requests: requests, latency: latency}, nil
}

// iamCredentials authenticates each new connection with a fresh access token.
// Memorystore keeps authenticated connections open after the token expires.
// The token source caches tokens but ignores contexts, so a slow metadata
// server is bounded by the operation budget instead.
func iamCredentials(source oauth2.TokenSource) func(context.Context) (string, string, error) {
	return func(ctx context.Context) (string, string, error) {
		type result struct {
			token *oauth2.Token
			err   error
		}
		done := make(chan result, 1)
		go func() {
			token, err := source.Token()
			done <- result{token, err}
		}()
		select {
		case fetched := <-done:
			if fetched.err != nil {
				return "", "", fetched.err
			}
			return "", fetched.token.AccessToken, nil
		case <-ctx.Done():
			return "", "", ctx.Err()
		}
	}
}

// Key hashes length-delimited identities so user content never enters cache keys.
func Key(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		fmt.Fprintf(hash, "%d:%s", len(part), part)
	}
	return fmt.Sprintf("slidesage:cache:v1:%x", hash.Sum(nil))
}

func (client *Client) Get(ctx context.Context, key string) ([]byte, bool) {
	if client == nil {
		return nil, false
	}
	started := time.Now()
	if started.UnixNano() < client.retryAt.Load() {
		client.observe(ctx, "get", "bypass", started)
		return nil, false
	}
	opCtx, cancel := context.WithTimeout(ctx, client.timeout)
	defer cancel()
	value, err := client.valkey.Get(opCtx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		client.observe(ctx, "get", "miss", started)
		return nil, false
	}
	if err != nil {
		client.failed(ctx, "get", started)
		return nil, false
	}
	if len(value) > MaxValueBytes {
		client.observe(ctx, "get", "miss", started)
		return nil, false
	}
	client.observe(ctx, "get", "hit", started)
	return value, true
}

func (client *Client) Set(ctx context.Context, key string, value []byte, ttl time.Duration) {
	if client == nil || len(value) > MaxValueBytes || ttl <= 0 {
		return
	}
	started := time.Now()
	if started.UnixNano() < client.retryAt.Load() {
		client.observe(ctx, "set", "bypass", started)
		return
	}
	opCtx, cancel := context.WithTimeout(ctx, client.timeout)
	defer cancel()
	if err := client.valkey.Set(opCtx, key, value, ttl).Err(); err != nil {
		client.failed(ctx, "set", started)
		return
	}
	client.observe(ctx, "set", "ok", started)
}

func (client *Client) failed(ctx context.Context, operation string, started time.Time) {
	// Cancellation by the caller does not mean Valkey is unhealthy.
	if ctx.Err() == nil {
		previous := client.retryAt.Load()
		if previous <= started.UnixNano() && client.retryAt.CompareAndSwap(previous, time.Now().Add(5*time.Second).UnixNano()) {
			slog.WarnContext(ctx, "cache unavailable; using PostgreSQL for the next five seconds")
		}
	}
	client.observe(ctx, operation, "error", started)
}

func (client *Client) observe(ctx context.Context, operation, outcome string, started time.Time) {
	attrs := metric.WithAttributes(attribute.String("operation", operation), attribute.String("outcome", outcome))
	client.requests.Add(ctx, 1, attrs)
	client.latency.Record(ctx, float64(time.Since(started))/float64(time.Millisecond), attrs)
}

func (client *Client) Close() error {
	if client == nil {
		return nil
	}
	return client.valkey.Close()
}
