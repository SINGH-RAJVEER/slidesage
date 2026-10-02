-- +goose Up
ALTER TABLE card_revisions
	ADD COLUMN document jsonb,
	ALTER COLUMN object_key DROP NOT NULL;

-- NOT VALID permits existing GCS-only rows until cmd/migrate imports them,
-- but immediately rejects new writes without a body.
ALTER TABLE card_revisions
	ADD CONSTRAINT card_revisions_document_required CHECK (document IS NOT NULL) NOT VALID,
	ADD CONSTRAINT card_revisions_document_shape CHECK (
		CASE WHEN document IS NULL THEN true
			WHEN jsonb_typeof(document) = 'object'
				AND jsonb_typeof(document->'cardOrder') = 'array'
				AND jsonb_typeof(document->'cards') = 'object'
			THEN COALESCE(
				document->'schemaVersion' = to_jsonb(schema_version)
				AND jsonb_array_length(document->'cardOrder') = card_count
				AND card_count BETWEEN 1 AND 40, false)
			ELSE false
		END
	);

COMMENT ON COLUMN card_revisions.sha256 IS 'SHA-256 of compact submitted JSON bytes, or original verified GCS bytes for imported revisions. Not a hash of JSONB serialization.';
COMMENT ON COLUMN card_revisions.byte_size IS 'Byte size of the same submitted or original GCS bytes hashed by sha256; JSONB serialization may differ.';
COMMENT ON COLUMN card_revisions.object_key IS 'Legacy GCS source retained for tracing. New revisions have no object key.';

CREATE INDEX card_revisions_missing_document_idx ON card_revisions(presentation_id, revision)
	WHERE document IS NULL;

-- Only the one-time null-to-body import may update an immutable revision.
-- +goose StatementBegin
CREATE FUNCTION protect_card_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.object_key IS NOT NULL THEN
			RAISE EXCEPTION 'new card revisions cannot use GCS object keys';
		END IF;
	ELSIF OLD.document IS NOT NULL
		OR NEW.document IS NULL
		OR (to_jsonb(OLD) - 'document') IS DISTINCT FROM (to_jsonb(NEW) - 'document') THEN
		RAISE EXCEPTION 'card revisions are immutable';
	END IF;
	RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER card_revision_immutable BEFORE INSERT OR UPDATE ON card_revisions
	FOR EACH ROW EXECUTE FUNCTION protect_card_revision();

-- +goose Down
-- A downgrade would strand JSONB-only revisions. Keep the data and require an
-- explicit export/rollback plan rather than dropping authoritative bodies.
-- +goose StatementBegin
DO $$ BEGIN
	RAISE EXCEPTION 'card document migration cannot be downgraded without exporting JSONB-only revisions';
END $$;
-- +goose StatementEnd
