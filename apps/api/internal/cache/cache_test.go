package cache

import (
	"context"
	"net"
	"os"
	"testing"
	"time"
)

func TestDisabledAndConfiguration(t *testing.T) {
	t.Setenv("CACHE_REDIS_ADDR", "")
	client, err := FromEnv()
	if err != nil || client != nil {
		t.Fatalf("disabled cache = %v, %v", client, err)
	}
	if _, hit := client.Get(context.Background(), "absent"); hit {
		t.Fatal("disabled cache hit")
	}
	client.Set(context.Background(), "absent", []byte("value"), time.Second)
	if err := client.Close(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CACHE_REDIS_ADDR", "127.0.0.1:6379")
	t.Setenv("NODE_ENV", "production")
	t.Setenv("CACHE_REDIS_CA_PEM", "")
	t.Setenv("CACHE_REDIS_PASSWORD", "")
	if _, err := FromEnv(); err == nil {
		t.Fatal("production accepted plaintext unauthenticated cache")
	}
	t.Setenv("NODE_ENV", "test")
	t.Setenv("CACHE_REDIS_CA_PEM", "invalid")
	if _, err := FromEnv(); err == nil {
		t.Fatal("invalid CA accepted")
	}
	t.Setenv("CACHE_REDIS_CA_PEM", "")
	t.Setenv("CACHE_TIMEOUT_MS", "0")
	if _, err := FromEnv(); err == nil {
		t.Fatal("invalid timeout accepted")
	}
}

func TestKeySeparatesIdentities(t *testing.T) {
	if Key("ab", "c") == Key("a", "bc") {
		t.Fatal("ambiguous identities collide")
	}
	if Key("list", "user-a", "1") == Key("list", "user-b", "1") {
		t.Fatal("users share a key")
	}
}

func TestTimeoutFallsBackAndBypasses(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	// Accept but never answer the Redis handshake, simulating a hung server.
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			defer conn.Close()
			<-time.After(time.Second)
		}
	}()
	t.Setenv("NODE_ENV", "test")
	t.Setenv("CACHE_REDIS_ADDR", listener.Addr().String())
	t.Setenv("CACHE_REDIS_CA_PEM", "")
	t.Setenv("CACHE_REDIS_PASSWORD", "")
	t.Setenv("CACHE_TIMEOUT_MS", "25")
	client, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	started := time.Now()
	if _, hit := client.Get(context.Background(), "absent"); hit {
		t.Fatal("hung server returned a hit")
	}
	if time.Since(started) > 500*time.Millisecond {
		t.Fatal("cache failure blocked beyond its budget")
	}
	if client.retryAt.Load() <= time.Now().UnixNano() {
		t.Fatal("failed cache was not bypassed")
	}
	client.Set(context.Background(), "key", []byte("value"), time.Second)
	if _, hit := client.Get(context.Background(), "absent"); hit {
		t.Fatal("bypassed server returned a hit")
	}
}

func TestRedisRoundTripAndExpiry(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not set")
	}
	t.Setenv("NODE_ENV", "test")
	t.Setenv("CACHE_REDIS_ADDR", address)
	t.Setenv("CACHE_REDIS_PASSWORD", "")
	t.Setenv("CACHE_REDIS_CA_PEM", "")
	t.Setenv("CACHE_TIMEOUT_MS", "500")
	client, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx := context.Background()
	key := Key(t.Name(), time.Now().String())
	client.Set(ctx, key, []byte("value"), time.Second)
	if value, hit := client.Get(ctx, key); !hit || string(value) != "value" {
		t.Fatalf("round trip = %q, %v", value, hit)
	}
	if ttl, err := client.redis.PTTL(ctx, key).Result(); err != nil || ttl <= 0 || ttl > time.Second {
		t.Fatalf("expiry = %v, %v", ttl, err)
	}
	if err := client.redis.PExpire(ctx, key, time.Millisecond).Err(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, hit := client.Get(ctx, key); hit {
		t.Fatal("expired value survived")
	}
	client.Set(ctx, key, make([]byte, MaxValueBytes+1), time.Second)
	if _, hit := client.Get(ctx, key); hit {
		t.Fatal("oversized value stored")
	}
}
