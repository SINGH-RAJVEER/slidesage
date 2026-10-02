package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"strings"

	"golang.org/x/crypto/scrypt"
	"golang.org/x/text/unicode/norm"
)

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	saltText := hex.EncodeToString(salt)
	derived, err := scrypt.Key([]byte(norm.NFKC.String(password)), []byte(saltText), 16384, 16, 1, 64)
	if err != nil {
		return "", err
	}
	return saltText + ":" + hex.EncodeToString(derived), nil
}

// verifyPassword checks a password against the salted scrypt hash every
// credential stores. Any other value, including the marker left where an older
// format was removed, never verifies.
func verifyPassword(hash, password string) bool {
	parts := strings.Split(hash, ":")
	if len(parts) != 2 || len(parts[0]) != 32 || len(parts[1]) != 128 {
		return false
	}
	expected, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	actual, err := scrypt.Key([]byte(norm.NFKC.String(password)), []byte(parts[0]), 16384, 16, 1, 64)
	return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1
}
