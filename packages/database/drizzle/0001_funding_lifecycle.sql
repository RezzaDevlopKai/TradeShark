-- TradeShark funding lifecycle tables.
-- This migration assumes the baseline schema has already created users,
-- assets, and ledger_accounts.

DO $$ BEGIN
  CREATE TYPE funding_status AS ENUM ('pending', 'confirmed', 'credited', 'failed', 'reversed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE withdrawal_status AS ENUM ('requested', 'pending', 'approved', 'submitted', 'confirmed', 'failed', 'reversed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS deposits (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  pending_account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  amount numeric(38, 18) NOT NULL,
  status funding_status NOT NULL DEFAULT 'pending',
  external_reference text NOT NULL UNIQUE,
  confirmation_count integer NOT NULL DEFAULT 0,
  confirmed_at timestamptz,
  credited_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deposits_amount_positive CHECK (amount > 0),
  CONSTRAINT deposits_confirmation_count_nonnegative CHECK (confirmation_count >= 0)
);

CREATE INDEX IF NOT EXISTS deposits_user_status_idx
  ON deposits(user_id, status, created_at);

CREATE TABLE IF NOT EXISTS withdrawals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  pending_account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  amount numeric(38, 18) NOT NULL,
  status withdrawal_status NOT NULL DEFAULT 'requested',
  destination text NOT NULL,
  external_reference text UNIQUE,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT withdrawals_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS withdrawals_user_status_idx
  ON withdrawals(user_id, status, created_at);
