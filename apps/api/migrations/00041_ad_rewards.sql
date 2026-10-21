-- +goose Up
CREATE TABLE ad_reward_sessions (
	id text PRIMARY KEY,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	status varchar(16) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'claimed', 'expired')),
	reward_millis bigint NOT NULL CHECK (reward_millis > 0),
	issued_at timestamptz NOT NULL DEFAULT NOW(),
	expires_at timestamptz NOT NULL,
	claimed_at timestamptz,
	CONSTRAINT ad_reward_sessions_claim_time CHECK ((status = 'claimed') = (claimed_at IS NOT NULL))
);

-- Caps count a user's claims per UTC day and month.
CREATE INDEX ad_reward_sessions_user_claimed_idx
	ON ad_reward_sessions(user_id, claimed_at)
	WHERE status = 'claimed';

-- A user holds at most one session waiting for its ad to finish.
CREATE UNIQUE INDEX ad_reward_sessions_user_issued_idx
	ON ad_reward_sessions(user_id)
	WHERE status = 'issued';

-- Every ad credit names its session, so a session can credit points once.
ALTER TABLE point_ledger ADD COLUMN ad_reward_session_id text REFERENCES ad_reward_sessions(id) ON DELETE CASCADE;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_ad_reward_session_unique UNIQUE (ad_reward_session_id, entry_type);

ALTER TABLE point_ledger DROP CONSTRAINT point_ledger_entry_type_check;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_entry_type_check
	CHECK (entry_type IN ('signup_credit', 'purchase_credit', 'model_reservation', 'research_reservation', 'reservation_release', 'lease_release', 'adjustment', 'ad_reward'));

ALTER TABLE point_ledger DROP CONSTRAINT point_ledger_source_present;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_source_present
	CHECK (operation_id IS NOT NULL OR payment_id IS NOT NULL OR ad_reward_session_id IS NOT NULL OR entry_type IN ('signup_credit', 'adjustment'));

-- +goose Down
DELETE FROM point_ledger WHERE entry_type = 'ad_reward';

ALTER TABLE point_ledger DROP CONSTRAINT point_ledger_source_present;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_source_present
	CHECK (operation_id IS NOT NULL OR payment_id IS NOT NULL OR entry_type IN ('signup_credit', 'adjustment'));

ALTER TABLE point_ledger DROP CONSTRAINT point_ledger_entry_type_check;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_entry_type_check
	CHECK (entry_type IN ('signup_credit', 'purchase_credit', 'model_reservation', 'research_reservation', 'reservation_release', 'lease_release', 'adjustment'));

ALTER TABLE point_ledger DROP COLUMN ad_reward_session_id;
DROP TABLE ad_reward_sessions;
