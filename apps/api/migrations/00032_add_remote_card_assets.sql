-- +goose Up
-- Photos from libraries that require hotlinking, such as Unsplash, are shown
-- from the library's own image URL. Such an asset has that URL instead of a
-- stored object, and its ID is a digest of the library and photo ID.

ALTER TABLE card_assets
	ALTER COLUMN object_key DROP NOT NULL,
	ALTER COLUMN byte_size DROP NOT NULL,
	ADD COLUMN remote_url text CHECK (remote_url LIKE 'https://images.unsplash.com/%'),
	ADD CONSTRAINT card_assets_stored_or_remote CHECK (
		(object_key IS NOT NULL AND byte_size IS NOT NULL AND remote_url IS NULL)
		OR (object_key IS NULL AND byte_size IS NULL AND remote_url IS NOT NULL)
	);

-- +goose Down
DELETE FROM card_assets WHERE remote_url IS NOT NULL;
ALTER TABLE card_assets
	DROP CONSTRAINT card_assets_stored_or_remote,
	DROP COLUMN remote_url,
	ALTER COLUMN object_key SET NOT NULL,
	ALTER COLUMN byte_size SET NOT NULL;
