-- +goose Up
-- Images shown by card documents. A document refers to an asset only by its
-- digest; this table holds what the server knows about it and scopes it to one
-- presentation, so a document can never show another presentation's image.

CREATE TABLE card_assets (
	presentation_id text NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
	sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	object_key text NOT NULL,
	mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
	byte_size bigint NOT NULL CHECK (byte_size > 0),
	width integer NOT NULL CHECK (width > 0),
	height integer NOT NULL CHECK (height > 0),
	-- Where the image came from: provider, photographer, page, license, and the
	-- query or prompt that found it.
	source jsonb NOT NULL,
	created_at timestamptz NOT NULL DEFAULT NOW(),
	PRIMARY KEY (presentation_id, sha256),
	CHECK (object_key LIKE 'presentations/' || presentation_id || '/assets/' || sha256 || '.%')
);

-- +goose Down
DROP TABLE IF EXISTS card_assets;
