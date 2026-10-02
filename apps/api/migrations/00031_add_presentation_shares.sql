-- +goose Up
-- Read-only links to a presentation. Only a digest of each token is kept, so a
-- leaked database cannot be turned into working links. A presentation has at
-- most one live link; revoking it keeps the row as a record.

CREATE TABLE presentation_shares (
	id uuid PRIMARY KEY,
	presentation_id text NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
	token_sha256 char(64) NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
	created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT NOW(),
	revoked_at timestamptz
);

CREATE UNIQUE INDEX presentation_shares_live ON presentation_shares (presentation_id) WHERE revoked_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS presentation_shares;
