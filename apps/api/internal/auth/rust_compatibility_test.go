//go:build rustcompat

package auth

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"testing"
	"time"
)

// Uses the original Go functions as the oracle in both directions. Only synthetic
// credentials travel through stdin; the example executable is required explicitly.
func TestRustPasswordAndJWTCompatibility(t *testing.T) {
	binary := os.Getenv("RUST_AUTH_COMPAT_BIN")
	if binary == "" {
		t.Fatal("RUST_AUTH_COMPAT_BIN must point to the compiled auth_compat example")
	}
	call := func(input map[string]any) map[string]any {
		t.Helper()
		encoded, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		command := exec.Command(binary)
		command.Stdin = bytes.NewReader(encoded)
		output, err := command.Output()
		if err != nil {
			t.Fatalf("Rust fixture process failed: %v", err)
		}
		var decoded map[string]any
		if err := json.Unmarshal(output, &decoded); err != nil {
			t.Fatal(err)
		}
		return decoded
	}
	password := "Pa\u0308ssword123!"
	goHash, err := hashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if call(map[string]any{"operation": "verify_password", "hash": goHash, "password": "Pässword123!"})["valid"] != true {
		t.Fatal("Rust did not accept the Go-generated normalized password hash")
	}
	rustHash := call(map[string]any{"operation": "hash", "password": password})["hash"].(string)
	if !verifyPassword(rustHash, "Pässword123!") {
		t.Fatal("Go did not accept the Rust-generated hash")
	}
	secret := "test-secret-key-that-is-at-least-32-bytes-long"
	service := &Service{config: Config{AuthSecret: secret, Now: time.Now}}
	goToken, err := service.GenerateJWT("user-123", "test@example.com", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if call(map[string]any{"operation": "verify_token", "secret": secret, "token": goToken})["subject"] != "user-123" {
		t.Fatal("Rust did not accept the Go-generated token")
	}
	rustToken := call(map[string]any{"operation": "issue_token", "secret": secret, "user_id": "user-123", "email": "test@example.com"})["token"].(string)
	if subject, err := service.VerifyJWT(rustToken); err != nil || subject != "user-123" {
		t.Fatalf("Go did not accept the Rust-generated token: subject=%q error=%v", subject, err)
	}
}
