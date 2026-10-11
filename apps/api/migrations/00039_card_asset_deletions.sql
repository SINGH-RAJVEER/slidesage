-- +goose Up
-- Keep cleanup requests after account/presentation cascades remove the assets.
-- The trigger and deletion commit together; a rollback queues nothing.
CREATE TABLE card_asset_deletions (
	object_key text PRIMARY KEY CHECK (object_key ~ '^presentations/[^/]+/assets/[0-9a-f]{64}\.(jpg|png)$'),
	created_at timestamptz NOT NULL DEFAULT now(),
	retry_after timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX card_asset_deletions_retry_idx ON card_asset_deletions (retry_after, object_key);
CREATE INDEX card_assets_object_key_idx ON card_assets (object_key) WHERE object_key IS NOT NULL;

-- +goose StatementBegin
CREATE FUNCTION queue_card_asset_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.object_key IS NOT NULL THEN
		INSERT INTO card_asset_deletions (object_key) VALUES (OLD.object_key)
		ON CONFLICT (object_key) DO NOTHING;
	END IF;
	RETURN NULL;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER card_asset_deletion AFTER DELETE ON card_assets
	FOR EACH ROW EXECUTE FUNCTION queue_card_asset_deletion();

-- +goose Down
DROP TRIGGER card_asset_deletion ON card_assets;
DROP FUNCTION queue_card_asset_deletion();
DROP TABLE card_asset_deletions;
DROP INDEX card_assets_object_key_idx;
