# TradeShark Ledger Specification

> Status: Architecture contract — financial implementation must satisfy this document before production use.

## 1. Purpose

The TradeShark ledger is the authoritative accounting layer for user and platform financial balances. Trading, deposits, withdrawals, fees, creator operations, and other financial features must produce explicit accounting events.

The ledger is intentionally separate from UI balances and trading-engine state.

## 2. Non-Negotiable Invariants

1. Every posted journal transaction has balanced debit and credit entries for each asset.
2. No application service directly edits an authoritative balance.
3. Posted entries are immutable.
4. Corrections use compensating journal transactions.
5. Every financial command is idempotent.
6. Every posted transaction has a business reference.
7. Every money-moving operation is auditable.
8. Ledger precision is deterministic and never based on binary floating-point arithmetic.
9. Internal balances and external blockchain balances are reconciled independently.
10. A transaction cannot be considered successful merely because a client received a success response; posting state is authoritative.

## 3. Account Model

A ledger account represents ownership/context + asset + accounting purpose.

Suggested account types:

- `USER_AVAILABLE`
- `USER_LOCKED`
- `USER_PENDING_DEPOSIT`
- `USER_PENDING_WITHDRAWAL`
- `TREASURY`
- `FEE_REVENUE`
- `TRADING_CLEARING`
- `CREATOR_TREASURY`
- `SYSTEM_SUSPENSE`
- `EXTERNAL_SETTLEMENT`

Account ownership is represented explicitly using `owner_type` and `owner_id` where applicable.

## 4. Journal Transaction Lifecycle

```text
REQUESTED
   ↓
VALIDATED
   ↓
POSTED
   ↓
RECONCILED
```

Failure paths:

```text
REQUESTED → REJECTED
POSTED → COMPENSATED
```

A transaction must never jump directly from an API request to an assumed balance without passing through validated accounting logic.

## 5. Journal Entries

Each journal transaction contains one or more entries.

Conceptual structure:

```text
JournalTransaction
 ├── Entry A: account X, asset A, debit
 ├── Entry B: account Y, asset A, credit
 └── optional additional balanced entries
```

For an amount `Q` of asset `A`:

```text
Σ debits(asset=A) = Σ credits(asset=A)
```

The same invariant is evaluated independently per asset. Cross-asset conversion is represented by separate asset-balanced legs and an explicit trade/exchange reference.

## 6. Deposit Example

When a verified deposit of 100 USDC is credited to a user:

```text
DEBIT  External Settlement / USDC     100
CREDIT User Available / USDC          100
```

The exact account topology may differ by custody architecture, but the accounting event must balance.

## 7. Withdrawal Example

When 100 USDC is reserved for withdrawal:

```text
DEBIT  User Available / USDC          100
CREDIT User Pending Withdrawal / USDC 100
```

When the external withdrawal settles:

```text
DEBIT  User Pending Withdrawal / USDC 100
CREDIT External Settlement / USDC     100
```

If the withdrawal fails before external settlement, use a compensating transaction to return funds to the appropriate user account.

## 8. Spot Trade Example

For a buyer purchasing 10 units of BASE at 2 QUOTE each:

Buyer receives 10 BASE and pays 20 QUOTE plus any applicable fee.

The accounting transaction must explicitly represent:

- buyer BASE increase;
- buyer QUOTE decrease;
- seller BASE decrease;
- seller QUOTE increase;
- fee transfer when applicable.

A trade ID is the business reference linking the ledger transaction to the immutable execution record.

## 9. Trading Fee Example

If the configured fee is 0.55% and the fee base is 20 QUOTE:

```text
fee = exact_decimal(20 × 0.0055)
```

Rounding must use an explicitly documented asset/currency scale and rounding mode. The implementation must never calculate financial amounts through JavaScript `number` arithmetic.

Fee accounting can be represented as:

```text
DEBIT  User Trading Account / QUOTE   trade_value + fee
CREDIT Seller Account / QUOTE         seller_proceeds
CREDIT Fee Revenue / QUOTE            fee
```

The exact buyer/seller clearing topology is an implementation detail, but the total must balance.

## 10. Locked Funds

Open orders may reserve funds.

Example:

```text
DEBIT  User Available / QUOTE         Q
CREDIT User Locked / QUOTE            Q
```

Cancellation releases the reservation with a compensating transfer:

```text
DEBIT  User Locked / QUOTE            Q
CREDIT User Available / QUOTE         Q
```

Locked funds are not considered spendable available funds.

## 11. Free Coin / Mayhem Entitlement

The one-time free coin entitlement is primarily a product entitlement, not a cash balance.

If creation consumes a fee-free entitlement, the entitlement service records the redemption. If the platform nevertheless incurs an internal measurable cost, that cost should be accounted for separately rather than pretending that a user payment occurred.

If a future creator feature introduces actual treasury transfers, those transfers must have explicit ledger transactions.

## 12. Idempotency

Every external financial command requires an idempotency key.

Examples:

- `deposit_credit:{provider_event_id}`
- `withdrawal_request:{user_id}:{client_request_id}`
- `trade_settlement:{trade_id}`
- `fee_posting:{trade_id}`

The idempotency record stores enough information to safely return the original outcome on retry without repeating side effects.

Concurrent duplicate requests must serialize through a unique constraint and transaction-safe locking strategy.

## 13. Concurrency

Ledger operations must be safe under concurrent requests.

Preferred pattern:

1. validate request;
2. establish deterministic lock/order for affected accounts;
3. verify spendable/available state;
4. create journal transaction + entries;
5. update any balance projection in the same DB transaction;
6. create outbox event in the same transaction;
7. commit.

Never rely on application-level mutexes as the only protection for financial invariants.

## 14. Balance Projection

A materialized balance table may be used for fast reads, but it is a projection of ledger state.

Recommended fields:

- `ledger_account_id`
- `asset_id`
- `posted_balance`
- `version`
- `updated_at`

Any balance projection update must occur transactionally with the journal posting or be rebuildable deterministically from the ledger.

A reconciliation job periodically compares projections against ledger-derived balances.

## 15. Reconciliation

### Internal reconciliation

For every account:

```text
projected_balance == sum(posted_ledger_entries)
```

Any mismatch is a critical accounting incident requiring investigation.

### Blockchain reconciliation

For custody-controlled assets, compare:

```text
on_chain_observed_balance
vs
internal_customer_liabilities
+ platform_owned_balance
+ pending/suspense amounts
```

The precise equation depends on custody architecture and asset behavior. Unsupported discrepancies must not be hidden by adjusting user balances manually.

### Trading reconciliation

Compare execution records, order fills, fees, and corresponding ledger transactions.

## 16. Corrections

Never update an old posted journal entry to “fix” history.

Instead:

```text
Original transaction
       ↓
Identify error
       ↓
Create compensating transaction
       ↓
Post corrected transaction
       ↓
Audit reference to original
```

The correction must preserve the audit trail.

## 17. Precision

### Fiat

Use integer minor units where the currency scale is fixed, e.g. cents for USD when appropriate.

### Tokens

Use exact decimal/numeric representations according to asset precision. Never silently truncate user input.

### Rates

Store rates with explicit scale and source metadata. Every conversion used in accounting must be reproducible from stored inputs.

## 18. API Boundary

Financial API requests should use validated strings for decimal quantities:

```json
{
  "amount": "10.250000",
  "asset": "USDC",
  "idempotencyKey": "client-generated-opaque-key"
}
```

Responses should expose canonical decimal strings rather than binary floating-point values.

## 19. Audit Requirements

At minimum, audit:

- deposits credited;
- withdrawals requested/approved/broadcast/settled/failed;
- trade settlement;
- fee posting;
- balance holds/releases;
- administrative balance adjustments;
- entitlement grants/redemptions that have financial implications;
- reconciliation failures;
- configuration changes affecting fees or limits.

Each audit event should carry request/correlation IDs and a stable resource reference.

## 20. Kill Switches

Financial operations must support operational controls that can disable new activity without destroying accounting data.

Examples:

- disable deposits;
- disable withdrawals;
- disable trading for a market;
- disable creator launches;
- disable free Mayhem entitlement grants;
- place a market in reduce-only/close-only mode if the product later supports it.

Kill switches must be audited and access-controlled.

## 21. Testing Contract

Before production:

### Unit tests

- debit/credit balancing;
- precision/rounding;
- fee calculations;
- entitlement consumption;
- idempotency;
- compensation.

### Integration tests

- concurrent withdrawal requests;
- concurrent order settlement;
- retry after timeout;
- outbox transaction atomicity;
- reconciliation mismatch detection.

### Property/invariant tests

Generate valid journal transactions and assert balance invariants across many cases.

### Failure tests

Simulate process crash after:

- ledger insert;
- balance projection update;
- outbox insert;
- external provider callback.

The system must recover without duplicating financial effects.

## 22. Security

Ledger endpoints require authenticated, authorized service access. Administrative adjustments require stronger authorization and reason codes.

Secrets, private keys, seed phrases, authentication tokens, and raw payment credentials never belong in ledger tables.

Sensitive logs must avoid exposing full financial/account identifiers where unnecessary.

## 23. Implementation Sequence

1. Define Drizzle schema and migrations.
2. Implement account repository.
3. Implement journal transaction service.
4. Implement balanced-entry validation.
5. Implement idempotency repository.
6. Implement balance projection.
7. Implement outbox integration.
8. Add deposit/withdrawal accounting.
9. Add trading settlement accounting.
10. Add reconciliation workers.
11. Add invariant and concurrency test suites.

## 24. Release Gate

**Stop before production financial traffic** until ledger invariants, idempotency, reconciliation, backup/restore, security review, and applicable legal/regulatory review have passed.
