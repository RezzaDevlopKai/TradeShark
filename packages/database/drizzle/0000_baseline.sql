-- TradeShark baseline schema.
-- This migration creates the core schema required before funding lifecycle migrations.

CREATE TYPE user_status AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE entitlement_status AS ENUM ('granted', 'consumed', 'revoked', 'expired');
CREATE TYPE share_state AS ENUM ('started', 'completed_by_user', 'verified', 'rejected', 'expired');
CREATE TYPE actor_type AS ENUM ('user', 'engine', 'system', 'admin');
CREATE TYPE ledger_account_type AS ENUM ('USER_AVAILABLE', 'USER_LOCKED', 'USER_PENDING_DEPOSIT', 'USER_PENDING_WITHDRAWAL', 'TREASURY', 'FEE_REVENUE', 'TRADING_CLEARING', 'CREATOR_TREASURY', 'SYSTEM_SUSPENSE', 'EXTERNAL_SETTLEMENT');
CREATE TYPE ledger_direction AS ENUM ('debit', 'credit');
CREATE TYPE journal_status AS ENUM ('posted', 'reversed');
CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_status AS ENUM ('pending', 'open', 'partially_filled', 'filled', 'cancelled', 'rejected');
CREATE TYPE activity_source AS ENUM ('user', 'engine', 'system', 'admin', 'promotion');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  status user_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX identities_provider_subject_uq ON identities(provider, provider_subject);
CREATE INDEX identities_user_idx ON identities(user_id);

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  symbol text NOT NULL UNIQUE,
  name text NOT NULL,
  decimals integer NOT NULL,
  chain text,
  contract_address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_decimals_check CHECK (decimals >= 0 AND decimals <= 30)
);

CREATE TABLE markets (
  id uuid PRIMARY KEY,
  symbol text NOT NULL UNIQUE,
  base_asset_id uuid NOT NULL REFERENCES assets(id),
  quote_asset_id uuid NOT NULL REFERENCES assets(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  account_type ledger_account_type NOT NULL,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ledger_accounts_user_asset_type_uq ON ledger_accounts(user_id, asset_id, account_type);

CREATE TABLE journal_transactions (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  reference_type text NOT NULL,
  reference_id uuid,
  status journal_status NOT NULL DEFAULT 'posted',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES journal_transactions(id),
  account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  direction ledger_direction NOT NULL,
  amount numeric(38,18) NOT NULL,
  sequence integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_entries_amount_positive CHECK (amount > 0)
);
CREATE UNIQUE INDEX journal_entries_transaction_sequence_uq ON journal_entries(transaction_id, sequence);
CREATE INDEX journal_entries_transaction_idx ON journal_entries(transaction_id);
CREATE INDEX journal_entries_account_idx ON journal_entries(account_id);

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  side order_side NOT NULL,
  status order_status NOT NULL DEFAULT 'pending',
  quantity numeric(38,18) NOT NULL,
  limit_price numeric(38,18),
  fee_rate numeric(20,10) NOT NULL DEFAULT 0.0055,
  client_order_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_quantity_positive CHECK (quantity > 0),
  CONSTRAINT orders_limit_price_positive CHECK (limit_price IS NULL OR limit_price > 0)
);
CREATE UNIQUE INDEX orders_user_client_order_uq ON orders(user_id, client_order_id);
CREATE INDEX orders_user_idx ON orders(user_id, created_at);

CREATE TABLE trades (
  id uuid PRIMARY KEY,
  market_id uuid NOT NULL REFERENCES markets(id),
  buy_order_id uuid NOT NULL REFERENCES orders(id),
  sell_order_id uuid NOT NULL REFERENCES orders(id),
  price numeric(38,18) NOT NULL,
  quantity numeric(38,18) NOT NULL,
  fee_amount numeric(38,18) NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trades_price_positive CHECK (price > 0),
  CONSTRAINT trades_quantity_positive CHECK (quantity > 0),
  CONSTRAINT trades_fee_nonnegative CHECK (fee_amount >= 0)
);
CREATE INDEX trades_market_time_idx ON trades(market_id, executed_at);

CREATE TABLE coin_projects (
  id uuid PRIMARY KEY,
  creator_user_id uuid NOT NULL REFERENCES users(id),
  symbol text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  status text NOT NULL DEFAULT 'draft',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coin_projects_creator_idx ON coin_projects(creator_user_id);
CREATE UNIQUE INDEX coin_projects_symbol_uq ON coin_projects(symbol);

CREATE TABLE coin_creation_entitlements (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  entitlement_type text NOT NULL,
  status entitlement_status NOT NULL DEFAULT 'granted',
  source text NOT NULL DEFAULT 'initial_free',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX coin_creation_entitlements_user_type_uq ON coin_creation_entitlements(user_id, entitlement_type);

CREATE TABLE coin_creation_redemptions (
  id uuid PRIMARY KEY,
  entitlement_id uuid NOT NULL REFERENCES coin_creation_entitlements(id),
  user_id uuid NOT NULL REFERENCES users(id),
  coin_project_id uuid NOT NULL REFERENCES coin_projects(id),
  idempotency_key text NOT NULL UNIQUE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unlock_campaigns (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  required_share_state share_state NOT NULL DEFAULT 'verified',
  reward_type text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE share_intents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  campaign_id uuid NOT NULL REFERENCES unlock_campaigns(id),
  channel text NOT NULL,
  state share_state NOT NULL DEFAULT 'started',
  target_type text NOT NULL,
  target_id uuid,
  verification_data jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_intents_user_campaign_idx ON share_intents(user_id, campaign_id);
CREATE INDEX share_intents_state_idx ON share_intents(state);

CREATE TABLE unlocks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  campaign_id uuid NOT NULL REFERENCES unlock_campaigns(id),
  share_intent_id uuid NOT NULL REFERENCES share_intents(id),
  reward_type text NOT NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX unlocks_user_campaign_uq ON unlocks(user_id, campaign_id);

CREATE TABLE activity_events (
  id uuid PRIMARY KEY,
  actor_type actor_type NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  source activity_source NOT NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_events_entity_idx ON activity_events(entity_type, entity_id, occurred_at);
CREATE INDEX activity_events_actor_idx ON activity_events(actor_type, actor_user_id, occurred_at);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_type actor_type NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_type, entity_id, occurred_at);

CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  operation text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  payload jsonb NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events(published_at, created_at);

CREATE TABLE ledger_balance_projections (
  account_id uuid PRIMARY KEY REFERENCES ledger_accounts(id),
  balance numeric(38,18) NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_balance_nonnegative CHECK (balance >= 0)
);
