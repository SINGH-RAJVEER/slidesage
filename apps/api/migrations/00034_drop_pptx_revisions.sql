-- +goose Up
-- Card revisions are the only presentation document. Nothing reads or writes
-- the PPTX revisions the retired pipeline produced, and a presentation without
-- a card revision is listed as unavailable either way. The stored PPTX objects
-- under presentations/{id}/objects/ are not removed here.

ALTER TABLE presentations
	DROP CONSTRAINT IF EXISTS presentations_current_pptx_revision_fkey,
	DROP CONSTRAINT IF EXISTS presentations_current_pptx_revision_check,
	DROP COLUMN IF EXISTS current_pptx_revision;

DROP TABLE IF EXISTS presentation_revisions;

-- +goose Down
-- Restores the schema only. The dropped revision rows are not recoverable.
ALTER TABLE presentations
	ADD COLUMN current_pptx_revision integer;

ALTER TABLE presentations
	ADD CONSTRAINT presentations_current_pptx_revision_check
		CHECK (current_pptx_revision IS NULL OR current_pptx_revision > 0);

CREATE TABLE presentation_revisions (
	presentation_id text NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
	revision integer NOT NULL CHECK (revision > 0),
	object_key text NOT NULL,
	sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	byte_size bigint NOT NULL CHECK (byte_size > 0),
	slide_count integer NOT NULL CHECK (slide_count > 0),
	mime_type text NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
		CHECK (mime_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
	template_id text,
	template_version integer,
	template_sha256 char(64),
	compiler_version text,
	author_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	source_operation_kind varchar(24) NOT NULL
		CHECK (source_operation_kind IN ('generation', 'ai_revision', 'editor_save', 'import')),
	source_operation_id text NOT NULL,
	editor_provider text,
	base_revision integer CHECK (base_revision IS NULL OR base_revision > 0),
	revision_index jsonb,
	created_at timestamptz NOT NULL DEFAULT NOW(),
	PRIMARY KEY (presentation_id, revision),
	UNIQUE (presentation_id, source_operation_id),
	CHECK (
		(template_id IS NULL AND template_version IS NULL AND template_sha256 IS NULL)
		OR (template_id IS NOT NULL AND template_version IS NOT NULL AND template_version > 0
			AND template_sha256 IS NOT NULL AND template_sha256 ~ '^[0-9a-f]{64}$')
	),
	CHECK (object_key = 'presentations/' || presentation_id || '/objects/' || sha256 || '.pptx'),
	CHECK (base_revision IS NULL OR base_revision < revision),
	CHECK (
		(source_operation_kind = 'generation'
			AND template_id IS NOT NULL AND compiler_version IS NOT NULL
			AND editor_provider IS NULL AND base_revision IS NULL)
		OR (source_operation_kind = 'ai_revision'
			AND compiler_version IS NOT NULL AND editor_provider IS NULL AND base_revision IS NOT NULL)
		OR (source_operation_kind = 'editor_save'
			AND compiler_version IS NULL AND editor_provider IS NOT NULL AND base_revision IS NOT NULL)
		OR (source_operation_kind = 'import'
			AND editor_provider IS NULL AND base_revision IS NULL)
	),
	FOREIGN KEY (presentation_id, base_revision)
		REFERENCES presentation_revisions(presentation_id, revision)
		DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE presentations
	ADD CONSTRAINT presentations_current_pptx_revision_fkey
		FOREIGN KEY (id, current_pptx_revision)
		REFERENCES presentation_revisions(presentation_id, revision)
		DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX presentation_revisions_created_idx
	ON presentation_revisions(presentation_id, created_at DESC);
