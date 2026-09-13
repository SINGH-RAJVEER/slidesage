-- +goose Up
-- Generated decks are rendered from their immutable PPTX revisions in the
-- browser. The preview worker has no remaining consumer, so its mutable claim
-- and readiness state no longer belongs on an otherwise immutable revision.

DROP INDEX IF EXISTS presentation_revisions_preview_claim_idx;

ALTER TABLE presentation_revisions
	DROP COLUMN preview_started_at,
	DROP COLUMN preview_count,
	DROP COLUMN preview_status;

-- +goose Down
ALTER TABLE presentation_revisions
	ADD COLUMN preview_status varchar(16) NOT NULL DEFAULT 'pending',
	ADD COLUMN preview_count integer NOT NULL DEFAULT 0,
	ADD COLUMN preview_started_at timestamptz;

ALTER TABLE presentation_revisions
	ADD CONSTRAINT presentation_revisions_preview_status_check
		CHECK (preview_status IN ('pending', 'rendering', 'ready', 'failed')),
	ADD CONSTRAINT presentation_revisions_preview_count_check
		CHECK (preview_count >= 0 AND preview_count <= slide_count),
	ADD CONSTRAINT presentation_revisions_preview_ready_count_check
		CHECK (preview_status <> 'ready' OR preview_count = slide_count),
	ADD CONSTRAINT presentation_revisions_preview_started_check
		CHECK (preview_status <> 'rendering' OR preview_started_at IS NOT NULL);

CREATE INDEX presentation_revisions_preview_claim_idx
	ON presentation_revisions(preview_status, preview_started_at)
	WHERE preview_status <> 'ready';
