-- +goose Up
CREATE TABLE feedback (
	id text PRIMARY KEY,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_created_at_idx ON feedback (created_at DESC);

-- +goose Down
DROP TABLE feedback;
