-- +goose Up
-- Sign-in reads only salted scrypt hashes on 'credential' accounts. Unsalted
-- SHA-256 and PBKDF2 hashes used to be accepted and upgraded on the next
-- sign-in; any not yet upgraded are replaced by a marker no format matches.
-- The credential row stays, so its owner can sign in again after a
-- forgot-password reset.
UPDATE accounts
SET password = 'reset-required', updated_at = NOW()
WHERE provider_id = 'credential'
	AND (password ~ '^[0-9a-fA-F]{64}$' OR password LIKE 'pbkdf2-sha256$%');

-- Rows in the older 'email' provider format are read by neither sign-in nor
-- reset. Each becomes a credential row with the same marker, or is removed
-- when its user already has one.
DELETE FROM accounts AS old
WHERE old.provider_id = 'email'
	AND EXISTS (SELECT 1 FROM accounts AS c WHERE c.user_id = old.user_id AND c.provider_id = 'credential');
UPDATE accounts
SET provider_id = 'credential', account_id = user_id, password = 'reset-required', updated_at = NOW()
WHERE provider_id = 'email';

-- +goose Down
-- The replaced hashes are not kept, so there is nothing to restore.
