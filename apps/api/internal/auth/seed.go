package auth

import (
	"context"
	"errors"
	"strings"
)

// SeedUser creates a verified email-and-password user for local development.
// Running it again for the same email resets the password and marks the
// email verified, so the documented credentials always sign in.
func (service *Service) SeedUser(ctx context.Context, name, email, password string, slideTokens float64) (User, error) {
	name = strings.TrimSpace(name)
	email = normalizeEmail(email)
	if name == "" || email == "" || len(password) < 8 {
		return User{}, errors.New("name, valid email, and a password of at least 8 characters are required")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return User{}, err
	}
	existing, err := service.repository.UserByEmail(ctx, email)
	if errors.Is(err, ErrNotFound) {
		now := service.config.Now().UTC()
		userID, err := randomID()
		if err != nil {
			return User{}, err
		}
		accountID, err := randomID()
		if err != nil {
			return User{}, err
		}
		user := User{ID: userID, Name: name, Email: email, EmailVerified: true, SlideTokens: slideTokens, CreatedAt: now, UpdatedAt: now}
		return user, service.repository.CreateUserWithCredential(ctx, user, accountID, hash)
	}
	if err != nil {
		return User{}, err
	}
	accountID, _, err := service.repository.CredentialByUserID(ctx, existing.ID)
	if err != nil {
		return User{}, errors.New("the seed email belongs to a user without a password; delete that user first")
	}
	if err := service.repository.UpdateCredentialPassword(ctx, accountID, hash); err != nil {
		return User{}, err
	}
	return service.repository.MarkEmailVerified(ctx, existing.ID)
}
