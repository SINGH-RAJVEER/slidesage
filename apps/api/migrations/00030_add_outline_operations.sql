-- +goose Up
-- An outline is planned and paid for on its own, before the user approves it
-- and drafting starts.
ALTER TABLE generation_point_operations
	DROP CONSTRAINT generation_point_operations_kind_check,
	ADD CONSTRAINT generation_point_operations_kind_check
		CHECK (kind IN ('generation', 'iteration', 'research', 'outline'));

-- +goose Down
DELETE FROM generation_point_operations WHERE kind = 'outline';
ALTER TABLE generation_point_operations
	DROP CONSTRAINT generation_point_operations_kind_check,
	ADD CONSTRAINT generation_point_operations_kind_check
		CHECK (kind IN ('generation', 'iteration', 'research'));
