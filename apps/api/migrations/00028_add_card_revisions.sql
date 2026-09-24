-- +goose Up
-- Card documents are the authoritative presentation. Each revision is an
-- immutable JSON object in GCS, addressed by digest; PostgreSQL holds its
-- metadata and the current-revision pointer that compare-and-swap writes move.

CREATE TABLE card_revisions (
	presentation_id text NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
	revision integer NOT NULL CHECK (revision > 0),
	object_key text NOT NULL,
	sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	byte_size bigint NOT NULL CHECK (byte_size > 0),
	card_count integer NOT NULL CHECK (card_count > 0),
	schema_version integer NOT NULL CHECK (schema_version > 0),
	-- The author is the presentation's owner, so account deletion removes the
	-- revisions with it. A RESTRICT or NO ACTION check would fire before the
	-- cascade through presentations reaches this table and block the delete.
	author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	operation_kind varchar(24) NOT NULL
		CHECK (operation_kind IN ('generation', 'ai_revision', 'manual_edit')),
	operation_id text NOT NULL,
	base_revision integer,
	-- Model, provider, prompt and plan versions, and source IDs, so a generated
	-- revision can be traced back to what produced it.
	provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT NOW(),
	PRIMARY KEY (presentation_id, revision),
	UNIQUE (presentation_id, operation_id),
	CHECK (object_key = 'presentations/' || presentation_id || '/cards/' || sha256 || '.json'),
	CHECK (base_revision IS NULL OR (base_revision > 0 AND base_revision < revision)),
	CHECK (operation_kind = 'generation' OR base_revision IS NOT NULL),
	FOREIGN KEY (presentation_id, base_revision)
		REFERENCES card_revisions(presentation_id, revision)
		DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE presentations
	ADD COLUMN current_card_revision integer
		CHECK (current_card_revision IS NULL OR current_card_revision > 0),
	ADD CONSTRAINT presentations_current_card_revision_fkey
		FOREIGN KEY (id, current_card_revision)
		REFERENCES card_revisions(presentation_id, revision)
		DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX card_revisions_created_idx ON card_revisions(presentation_id, created_at DESC);

-- +goose Down
ALTER TABLE presentations
	DROP CONSTRAINT IF EXISTS presentations_current_card_revision_fkey,
	DROP COLUMN IF EXISTS current_card_revision;

DROP TABLE IF EXISTS card_revisions;
