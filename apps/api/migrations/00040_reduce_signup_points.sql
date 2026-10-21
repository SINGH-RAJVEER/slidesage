-- +goose Up
ALTER TABLE users ALTER COLUMN balance_millis SET DEFAULT 10000;

-- +goose Down
ALTER TABLE users ALTER COLUMN balance_millis SET DEFAULT 50000;
