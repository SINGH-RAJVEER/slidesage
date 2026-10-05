-- +goose Up
CREATE SEQUENCE presentation_cache_version_seq;

-- No FK: account deletion cascades through presentations, whose delete trigger
-- must still invalidate the old owner's cache. Keep the tombstone to avoid reuse.
CREATE TABLE presentation_cache_versions (
	user_id text PRIMARY KEY,
	version bigint NOT NULL
);

INSERT INTO presentation_cache_versions (user_id, version)
	SELECT DISTINCT user_id, 0 FROM presentations;

-- +goose StatementBegin
CREATE FUNCTION advance_presentation_cache_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		INSERT INTO presentation_cache_versions (user_id, version)
		VALUES (OLD.user_id, nextval('presentation_cache_version_seq'))
		ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version;
	END IF;
	IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
		INSERT INTO presentation_cache_versions (user_id, version)
		VALUES (NEW.user_id, nextval('presentation_cache_version_seq'))
		ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version;
	END IF;
	RETURN NULL;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER presentation_cache_version AFTER INSERT OR UPDATE OR DELETE ON presentations
	FOR EACH ROW EXECUTE FUNCTION advance_presentation_cache_version();

-- +goose Down
DROP TRIGGER presentation_cache_version ON presentations;
DROP FUNCTION advance_presentation_cache_version();
DROP TABLE presentation_cache_versions;
DROP SEQUENCE presentation_cache_version_seq;
