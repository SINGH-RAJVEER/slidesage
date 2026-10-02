-- +goose Up
-- Card documents stored in PostgreSQL are the only presentation format. This
-- removes everything they replaced:
--
-- * Presentations without a card document: every deck the PPTX pipeline made,
--   and any card deck with a revision whose body was never imported from GCS.
--   Neither can be opened. Their point operations stay, unlinked, as billing
--   history, and a reservation still held for one is refunded when it expires.
-- * The pgvector tables of the retired retrieval pipeline, and the extension.
-- * Columns nothing reads: users.last_login_date and user_ai_preferences.use_byok.
-- * The GCS object key on card revisions, and the allowance for importing a
--   missing body into an otherwise immutable revision.
--
-- This is an intentional deletion. The pre-migration backup is the only copy.

CREATE TEMPORARY TABLE purged_presentations ON COMMIT DROP AS
SELECT p.id FROM presentations p
WHERE p.current_card_revision IS NULL
	OR EXISTS (SELECT 1 FROM card_revisions r WHERE r.presentation_id = p.id AND r.document IS NULL);

-- The parent reference is not enforced on delete, so it is cleared first.
UPDATE presentations SET parent_presentation_id = NULL
WHERE parent_presentation_id IN (SELECT id FROM purged_presentations);

DROP TABLE IF EXISTS presentation_embeddings;
DROP TABLE IF EXISTS rag_context;
DROP TABLE IF EXISTS search_embeddings;

DELETE FROM presentations WHERE id IN (SELECT id FROM purged_presentations);
-- The revision foreign keys are deferred; checking them now clears the events
-- the delete queued, which would otherwise block altering card_revisions.
SET CONSTRAINTS ALL IMMEDIATE;

-- The extension is shared by the whole database, so it stays when another
-- schema still uses it or this role does not own it.
-- +goose StatementBegin
DO $$
BEGIN
	DROP EXTENSION IF EXISTS vector;
EXCEPTION WHEN dependent_objects_still_exist OR insufficient_privilege THEN
	RAISE NOTICE 'vector extension kept: %', SQLERRM;
END $$;
-- +goose StatementEnd

ALTER TABLE users DROP COLUMN IF EXISTS last_login_date;
ALTER TABLE user_ai_preferences DROP COLUMN IF EXISTS use_byok;

-- Every remaining revision has its body, so the body is required outright and
-- a revision can no longer be updated at all.
DROP TRIGGER card_revision_immutable ON card_revisions;
DROP FUNCTION protect_card_revision();
DROP INDEX card_revisions_missing_document_idx;

ALTER TABLE card_revisions
	DROP CONSTRAINT card_revisions_document_required,
	ALTER COLUMN document SET NOT NULL,
	DROP COLUMN object_key;

COMMENT ON COLUMN card_revisions.sha256 IS 'SHA-256 of the compact submitted JSON bytes. Not a hash of the JSONB serialization.';
COMMENT ON COLUMN card_revisions.byte_size IS 'Byte size of the same submitted bytes hashed by sha256; the JSONB serialization may differ.';

-- +goose StatementBegin
CREATE FUNCTION protect_card_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'card revisions are immutable';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER card_revision_immutable BEFORE UPDATE ON card_revisions
	FOR EACH ROW EXECUTE FUNCTION protect_card_revision();

-- +goose Down
-- The deleted decks, embeddings, and columns cannot be rebuilt from what is
-- left. Recovery is a restore of the pre-migration backup.
-- +goose StatementBegin
DO $$ BEGIN
	RAISE EXCEPTION 'the legacy purge cannot be downgraded; restore the pre-migration backup instead';
END $$;
-- +goose StatementEnd
