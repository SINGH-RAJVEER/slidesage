// Package cache provides optional, disposable Redis storage. A cache failure
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
)

const MaxValueBytes = 4 << 20

type Store interface {
	Get(context.Context, string) ([]byte, bool)
	Set(context.Context, string, []byte, time.Duration)
}

type Client struct {
	redis    *redis.Client
	timeout  time.Duration
	retryAt  atomic.Int64
	requests metric.Int64Counter
	latency  metric.Float64Histogram
}

// FromEnv does not connect during startup. An absent address disables caching.
func FromEnv() (*Client, error) {
	address := strings.TrimSpace(os.Getenv("CACHE_REDIS_ADDR"))
	if address == "" {
		return nil, nil
	}
	if os.Getenv("NODE_ENV") == "production" && (os.Getenv("CACHE_REDIS_CA_PEM") == "" || os.Getenv("CACHE_REDIS_PASSWORD") == "") {
		return nil, errors.New("production cache requires TLS CA and authentication")
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
		Addr: address, Password: os.Getenv("CACHE_REDIS_PASSWORD"), Protocol: 2,
		PoolSize: 8, MaxActiveConns: 8, MinIdleConns: 0,
		DialTimeout: timeout, ReadTimeout: timeout, WriteTimeout: timeout,
		PoolTimeout: timeout, ContextTimeoutEnabled: true, MaxRetries: -1,
		ConnMaxIdleTime: time.Minute,
	}
	if pem := os.Getenv("CACHE_REDIS_CA_PEM"); pem != "" {
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM([]byte(pem)) {
			return nil, errors.New("CACHE_REDIS_CA_PEM contains no valid certificates")
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
	return &Client{redis: redis.NewClient(options), timeout: timeout, requests: requests, latency: latency}, nil
}

// Key hashes length-delimited identities so user content never enters Redis keys.
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
	value, err := client.redis.Get(opCtx, key).Bytes()
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
	if err := client.redis.Set(opCtx, key, value, ttl).Err(); err != nil {
		client.failed(ctx, "set", started)
		return
	}
	client.observe(ctx, "set", "ok", started)
}

func (client *Client) failed(ctx context.Context, operation string, started time.Time) {
	// Cancellation by the caller does not mean Redis is unhealthy.
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
	return client.redis.Close()
}
