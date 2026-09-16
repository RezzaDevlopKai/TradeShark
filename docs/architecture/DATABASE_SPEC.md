# TradeShark Database Specification

> Status: Architecture draft — implementation contract for Phase 0/1.

## 1. Goals

The TradeShark database is the source of truth for identity, financial state, trading state, entitlements, creator growth, airdrop intelligence, auditability, and asynchronous event delivery.

Core rules:

- PostgreSQL is authoritative for durable business state.
- Financial records use double-entry accounting and are never silently rewritten.
- Monetary values are never stored as floating-point numbers.
- Quantities use explicit asset precision and deterministic decimal handling.
- All timestamps are UTC.
- User-generated activity and engine-generated/promotional activity are distinguishable at the data layer.
- Idempotency is mandatory for money movement, order submission, entitlement grants, and externally triggered callbacks.
- Public discovery data must not imply fabricated users, volume, holders, or rewards.

## 2. Logical Schemas

Recommended PostgreSQL schemas:

- `identity` — users, sessions, identities, roles, account status.
- `catalog` — assets, chains, markets, trading configuration.
- `trading` — orders, trades, positions, execution state.
- `ledger` — accounts, journal transactions, journal entries, balances.
- `wallet` — deposit addresses, deposits, withdrawals, blockchain references.
- `creator` — coin creation, launch lifecycle, public project metadata.
- `growth` — share/unlock events, attribution, referral and campaign events.
- `airdrop` — projects, campaigns, tasks, eligibility, user progress, evidence.
- `activity` — normalized platform activity with actor/source classification.
- `audit` — immutable security/business audit events.
- `system` — idempotency keys, outbox, feature/config snapshots, jobs.

## 3. Global Conventions

### IDs

Use UUIDv7 where the application/database support is reliable. IDs must be opaque and globally unique.

### Time

Use `timestamptz`, normalized to UTC. Store event occurrence time separately from ingestion time when external data is involved.

### Money

Do not use `float`, `real`, or `double precision` for financial values. Prefer integer minor units for fiat where the currency scale is fixed; use PostgreSQL `numeric(p,s)` for assets whose precision varies by token/asset configuration.

### Quantities

Every asset has an explicit `decimals`/precision definition. API boundaries should accept validated decimal strings rather than JavaScript floating-point numbers.

### Immutability

Posted ledger transactions, settled trades, blockchain transaction references, and security audit records are append-only. Corrections happen through compensating records.

### Deletion

Financial/audit records are not hard-deleted. User-facing content can use soft deletion where required. Privacy deletion must be designed independently from accounting retention requirements.

## 4. Identity Domain

### `identity.users`

- `id`
- `status` — active, suspended, closed, pending
- `display_name`
- `created_at`
- `updated_at`

### `identity.user_identities`

External/login identities. Store provider subject identifiers, never raw credentials.

- `id`
- `user_id`
- `provider`
- `provider_subject`
- `created_at`

Unique: `(provider, provider_subject)`.

### `identity.roles` / `identity.user_roles`

RBAC foundation. Authorization must also perform resource/policy checks; role membership alone is not sufficient for sensitive operations.

## 5. Catalog Domain

### `catalog.chains`

- `id`
- `slug`
- `name`
- `chain_type`
- `native_asset_id`
- `status`

### `catalog.assets`

Represents fiat, crypto, platform-created tokens, and other supported assets.

- `id`
- `symbol`
- `name`
- `asset_type`
- `chain_id` nullable
- `contract_address` nullable
- `decimals`
- `status`
- `metadata_json`
- `created_at`
- `updated_at`

Unique constraints must prevent ambiguous `(chain_id, contract_address)` combinations.

### `catalog.markets`

- `id`
- `symbol`
- `base_asset_id`
- `quote_asset_id`
- `status`
- `price_scale`
- `quantity_scale`
- `fee_config_id`
- `created_at`

Unique: `(base_asset_id, quote_asset_id)` for one canonical spot market unless a future market-type discriminator is introduced.

## 6. Trading Domain

### `trading.orders`

- `id`
- `user_id`
- `market_id`
- `side`
- `order_type`
- `time_in_force`
- `price`
- `quantity`
- `filled_quantity`
- `status`
- `client_order_id`
- `idempotency_key`
- `source` — user, engine, admin-approved-system
- `created_at`
- `updated_at`

Unique: `(user_id, client_order_id)` where applicable.

### `trading.trades`

Execution records.

- `id`
- `market_id`
- `buy_order_id`
- `sell_order_id`
- `price`
- `quantity`
- `fee`
- `fee_asset_id`
- `execution_source`
- `executed_at`

A trade is immutable after settlement.

### `trading.positions`

Only needed for products with position semantics. Spot balances remain ledger-driven. If derivatives are introduced later, position accounting gets its own explicit specification and risk model.

## 7. Ledger Domain

TradeShark financial accounting uses double-entry bookkeeping.

### `ledger.accounts`

- `id`
- `owner_type`
- `owner_id`
- `asset_id`
- `account_type`
- `status`

Examples: user available balance, user locked balance, fee revenue, treasury, pending deposit, pending withdrawal, clearing accounts.

### `ledger.journal_transactions`

One logical accounting event.

- `id`
- `transaction_type`
- `reference_type`
- `reference_id`
- `idempotency_key`
- `status`
- `posted_at`
- `created_at`

Unique: `idempotency_key` within the required scope.

### `ledger.journal_entries`

- `id`
- `journal_transaction_id`
- `ledger_account_id`
- `direction` — debit/credit
- `amount`
- `asset_id`

Invariant: for every posted transaction and asset, total debits equal total credits.

### Balance strategy

The authoritative balance is derived from posted entries or from a carefully maintained materialized balance projection whose changes are transactionally tied to journal posting. No application feature may directly mutate a user's financial balance without a ledger transaction.

## 8. Wallet Domain

### `wallet.deposit_addresses`

- `id`
- `user_id`
- `chain_id`
- `address`
- `status`
- `created_at`

### `wallet.deposits`

- `id`
- `user_id`
- `asset_id`
- `amount`
- `chain_id`
- `tx_hash`
- `confirmations`
- `status`
- `detected_at`
- `credited_at`

Unique blockchain reference: `(chain_id, tx_hash, asset_id)` as appropriate.

### `wallet.withdrawals`

- `id`
- `user_id`
- `asset_id`
- `amount`
- `destination_address`
- `chain_id`
- `tx_hash`
- `fee_amount`
- `status`
- `idempotency_key`
- `requested_at`
- `completed_at`

Withdrawals require risk checks, ledger reservation, idempotency, and reconciliation.

## 9. Creator Domain — Free Coin / Mayhem

This is the core implementation of the growth concept discussed for TradeShark.

### `creator.coin_projects`

- `id`
- `creator_user_id`
- `asset_id`
- `slug`
- `name`
- `symbol`
- `description`
- `logo_asset_url`
- `chain_id`
- `contract_address`
- `launch_mode` — standard, mayhem
- `lifecycle_status` — draft, eligibility_pending, ready, launched, paused, retired
- `visibility` — private, public, unlisted
- `created_at`
- `updated_at`
- `launched_at`

Unique public slug and token identity constraints must be enforced.

### `creator.coin_creation_entitlements`

Represents the one-time free creation entitlement.

- `id`
- `user_id`
- `entitlement_type` — free_coin_creation
- `quantity`
- `remaining_quantity`
- `status`
- `granted_at`
- `expires_at` nullable

Unique business constraint: one active/granted initial free entitlement per account.

### `creator.coin_creation_redemptions`

- `id`
- `entitlement_id`
- `user_id`
- `coin_project_id`
- `creation_mode`
- `idempotency_key`
- `redeemed_at`

Unique on entitlement redemption so retries cannot create multiple free coins.

## 10. Growth Domain — Share-to-Unlock

The free Mayhem creation can be used as an acquisition loop without pretending that a social post occurred when it cannot be verified.

### `growth.unlock_campaigns`

- `id`
- `campaign_key`
- `name`
- `version`
- `status`
- `rules_json`
- `starts_at`
- `ends_at`

Campaign rules are versioned so historical unlock decisions remain explainable.

### `growth.share_intents`

Created when the user explicitly starts a share flow.

- `id`
- `user_id`
- `campaign_id`
- `channel` — x, telegram, discord, facebook, whatsapp, copy_link, other
- `target_type` — campaign, coin_project
- `target_id`
- `status` — started, completed, verified, rejected, expired
- `created_at`
- `completed_at`
- `verified_at`

### `growth.unlocks`

- `id`
- `user_id`
- `campaign_id`
- `entitlement_type`
- `source_share_intent_id`
- `status`
- `granted_at`

Unique constraint should prevent duplicate unlocks for the same user/campaign/entitlement.

### Verification principle

A platform may record that a user **started** a share, returned through a callback, or completed an integration-supported verification. It must not label a social post `verified` unless there is reliable evidence from the relevant integration. For unsupported channels, use an honest completion state such as `share_started` or `share_completed_by_user` rather than fabricating verification.

## 11. Creator Public Discovery

### `creator.coin_discovery_metrics`

Stores measured discovery signals, not invented popularity.

- `coin_project_id`
- `views`
- `unique_viewers`
- `shares`
- `watchlist_adds`
- `real_trades`
- `real_volume`
- `updated_at`

Engine-generated/promotional activity is tracked separately and must not silently inflate user-volume metrics.

### Discovery ranking

Public discovery can combine transparent signals such as recency, verified engagement, real trading activity, and safety status. Any ranking model must be explainable internally and must not represent a ranking as an investment recommendation or guarantee.

## 12. Activity Domain

### `activity.events`

Normalized platform activity event.

- `id`
- `actor_type` — user, engine, system, admin
- `actor_id` nullable
- `event_type`
- `source` — user_action, trading_engine, market_engine, growth_system, external_source
- `reference_type`
- `reference_id`
- `metadata_json`
- `occurred_at`
- `ingested_at`

This table is essential for distinguishing genuine user activity from platform-generated activity.

## 13. Airdrop Intelligence Domain

### `airdrop.projects`

- `id`
- `slug`
- `name`
- `website_url`
- `status`
- `risk_level`
- `summary`
- `created_at`
- `updated_at`

### `airdrop.campaigns`

- `id`
- `project_id`
- `name`
- `status`
- `start_at`
- `end_at`
- `eligibility_summary`
- `confidence`
- `last_verified_at`

### `airdrop.tasks`

- `id`
- `campaign_id`
- `task_type`
- `title`
- `description`
- `official_url`
- `chain_id` nullable
- `risk_level`
- `requirements_json`
- `status`

### `airdrop.user_progress`

- `id`
- `user_id`
- `campaign_id`
- `task_id`
- `status`
- `wallet_reference` nullable
- `completed_at`
- `evidence_id` nullable

### `airdrop.evidence`

- `id`
- `source_type`
- `source_url`
- `captured_at`
- `content_hash`
- `confidence`
- `metadata_json`

Never request or store seed phrases/private keys/session credentials.

## 14. Audit Domain

### `audit.events`

Immutable record of sensitive actions.

Fields:

- `id`
- `actor_type`
- `actor_id`
- `action`
- `resource_type`
- `resource_id`
- `request_id`
- `ip_hash` or privacy-reviewed network identifier where legally appropriate
- `metadata_json`
- `occurred_at`

High-risk actions include authentication changes, withdrawals, entitlement grants, admin overrides, risk overrides, coin launches, and configuration changes.

## 15. System Domain

### `system.idempotency_keys`

- `scope`
- `key`
- `user_id` nullable
- `request_hash`
- `response_status`
- `response_body` or response reference
- `created_at`
- `expires_at`

Unique: `(scope, key)`.

### `system.outbox_events`

Transactional outbox for reliable asynchronous processing.

- `id`
- `aggregate_type`
- `aggregate_id`
- `event_type`
- `payload_json`
- `occurred_at`
- `published_at` nullable
- `attempt_count`
- `last_error` nullable

Database transaction writes business state and outbox event atomically.

## 16. Critical Relationships

```text
User
 ├── Wallets / Deposits / Withdrawals
 ├── Ledger Accounts
 ├── Orders ── Trades
 ├── Free Coin Entitlement ── Redemption ── Coin Project
 │                                      └── Discovery Metrics
 ├── Share Intent ── Unlock ── Entitlement
 ├── Airdrop Progress ── Tasks ── Campaign ── Project
 └── Audit / Activity Events

Coin Project
 ├── Asset
 ├── Chain
 ├── Public Discovery
 └── Activity Events
```

## 17. Indexing Strategy

Initial indexes should prioritize:

- user lookup by identity provider subject
- orders by `(user_id, created_at desc)`
- open orders by `(market_id, status, price)` according to engine access patterns
- trades by `(market_id, executed_at desc)`
- ledger entries by `(ledger_account_id, id)`
- deposits/withdrawals by user and status
- coin projects by `(visibility, lifecycle_status, created_at desc)`
- coin project slug unique lookup
- discovery metrics by ranking dimensions
- airdrop campaigns by status/end time
- user airdrop progress by `(user_id, campaign_id)`
- audit events by actor/resource/time
- outbox events by unpublished status and occurrence time

Indexes must be validated with production-like query plans before adding large numbers of secondary indexes.

## 18. Constraints and Invariants

The database/application boundary must enforce at minimum:

1. A free coin entitlement cannot be redeemed twice.
2. A user cannot obtain multiple initial free-coin entitlements through retries.
3. A free Mayhem launch requires the configured unlock conditions.
4. A posted ledger transaction balances debits and credits per asset.
5. A settled trade cannot be mutated into a different trade.
6. An idempotent request cannot produce duplicate financial side effects.
7. User-generated and engine-generated activity remain distinguishable.
8. Public coin pages cannot expose secrets or private credentials.
9. External airdrop evidence records preserve source and capture time.
10. Sensitive state transitions create audit records.

## 19. Partitioning Candidates

Do not partition prematurely. Candidates once scale justifies it:

- `trading.trades`
- `activity.events`
- `audit.events`
- `system.outbox_events`

Time-based partitioning is the default candidate, with retention and archive policies defined before activation.

## 20. Privacy and Retention

User profile data, analytics identifiers, wallet addresses, and network metadata must have explicit retention/classification rules. Financial/accounting records may have longer retention obligations than ordinary product analytics. Privacy deletion must therefore use a data-classification matrix rather than blanket deletion.

## 21. Migration Rules

- Every schema change is a reviewed migration.
- Destructive migrations require a separate rollout plan.
- Production migrations must be backward-compatible across rolling application deployments where possible.
- Large backfills run as controlled jobs, not startup hooks.
- Financial schema migrations require reconciliation checks before and after deployment.

## 22. Backup and Reconciliation

Minimum production posture:

- automated PostgreSQL backups
- point-in-time recovery where supported
- tested restore procedure
- ledger-to-balance reconciliation
- wallet/on-chain-to-internal reconciliation
- trading execution reconciliation
- outbox delivery monitoring

A backup that has never been restored in a test is not considered verified.

## 23. Phase-1 Implementation Order

1. Identity + users
2. Catalog: assets/chains/markets
3. Ledger core
4. Wallet deposits/withdrawals
5. Trading orders/trades
6. Creator coin projects + one-time entitlement
7. Growth share-to-unlock + campaign versioning
8. Activity classification
9. Airdrop intelligence tables
10. Audit + outbox + idempotency
11. Migration tests + invariant tests

## 24. Definition of Done

Database architecture is ready for application implementation when:

- all core entities have migration definitions;
- financial invariants have automated tests;
- one-time entitlement redemption is race-safe;
- share-to-unlock cannot grant duplicate entitlements;
- user/engine activity classification is enforced;
- external evidence has provenance fields;
- sensitive operations are auditable;
- indexes match measured query paths;
- backup/restore and reconciliation procedures are documented;
- legal/regulatory review gates are explicitly represented in product configuration.
