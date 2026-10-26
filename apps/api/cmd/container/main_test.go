package main

import (
	"strings"
	"testing"
)

func TestDatabaseTunnelCannotBeBypassed(t *testing.T) {
	for _, value := range []string{"postgresql://user:pass@database:5432/slidesage", "postgresql://user:pass@127.0.0.1:15432/db?host=other", "postgresql://user:pass@127.0.0.1:15432/db?port=5432", "postgresql://user:pass@127.0.0.1:15432/db?service=other"} {
		if validateDatabaseURL(value) == nil {
			t.Fatalf("accepted tunnel bypass %q", value)
		}
	}
	if err := validateDatabaseURL("postgresql://user:pass@127.0.0.1:15432/slidesage?sslmode=disable"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_SSH_HOST", "148.113.1.66")
	t.Setenv("DATABASE_SSH_PORT", "20135")
	t.Setenv("DATABASE_SSH_USER", "slidesage-db")
	t.Setenv("DATABASE_SSH_TARGET", "127.0.0.1:15432")
	args, err := tunnelArgs("/tmp/identity")
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, required := range []string{"-NT", "StrictHostKeyChecking=yes", "ExitOnForwardFailure=yes", "127.0.0.1:15432:127.0.0.1:15432", "BatchMode=yes"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("missing tunnel control %s", required)
		}
	}
	t.Setenv("DATABASE_SSH_HOST", "-oProxyCommand=unsafe")
	if _, err := tunnelArgs("/tmp/identity"); err == nil {
		t.Fatal("accepted SSH option as host")
	}
}
