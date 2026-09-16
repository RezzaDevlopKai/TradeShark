# TradeShark API Contracts

> Status: Architecture draft — initial service boundary contract.

## 1. API Principles

- REST for durable command/query contracts.
- WebSocket for realtime market/activity streams.
- OpenAPI is the canonical HTTP contract.
- Zod or equivalent validation at application boundaries.
- Decimal financial values cross the API as strings.
- Every mutating request has a request/correlation ID; financial mutations also require an idempotency key.
- Authorization is enforced server-side on every protected resource.
- Errors use stable machine-readable codes plus human-readable messages.
- API responses never expose secrets, private keys, seed phrases, or internal credentials.

## 2. Base Resources

Initial API groups:

```text
/auth
/users
/assets
/markets
/orders
/trades
/balances
/deposits
/withdrawals
/coins
/creator
/growth
/airdrop
/discovery
```

The public web application can consume these APIs, but financial state is never trusted from browser state.

## 3. Authentication

### `POST /auth/session`

Creates an authenticated application session through the selected identity provider.

Response includes a safe session representation only. Tokens/credentials are handled according to the chosen identity architecture.

### `GET /users/me`

Returns the authenticated user's public/product profile and entitlement summaries.

## 4. Assets and Markets

### `GET /assets`

Returns supported assets and public metadata.

### `GET /markets`

Returns market configuration and public status.

### `GET /markets/{marketId}/ticker`

Returns current public ticker data.

### `GET /markets/{marketId}/candles`

Returns chart data with explicit interval and pagination/limit controls.

## 5. Balances

### `GET /balances`

Returns the authenticated user's spendable/locked balances as canonical decimal strings.

Example response shape:

```json
{
  "asset": "USDC",
  "available": "125.500000",
  "locked": "20.000000"
}
```

Balance responses are projections of ledger state and never become the source of truth.

## 6. Orders

### `POST /orders`

Creates an order.

Example:

```json
{
  "marketId": "uuid",
  "side": "buy",
  "type": "limit",
  "price": "2.500000",
  "quantity": "10.000000",
  "timeInForce": "GTC",
  "clientOrderId": "client-opaque-id",
  "idempotencyKey": "request-opaque-key"
}
```

Server responsibilities:

1. authenticate user;
2. authorize market access;
3. validate market status and order rules;
4. validate precision and limits;
5. reserve funds through ledger-aware accounting;
6. submit to trading engine;
7. persist durable order state;
8. emit event through outbox.

### `DELETE /orders/{orderId}`

Requests cancellation. Cancellation must release reserved funds through the ledger transaction.

### `GET /orders`

Supports user-scoped pagination and status filters.

## 7. Trading History

### `GET /trades`

Returns immutable user trade history.

### `GET /markets/{marketId}/trades`

Returns public market executions according to configured privacy/publication rules.

## 8. Deposits

### `POST /deposits/addresses`

Requests or returns a deposit address for a supported asset/chain.

### `GET /deposits`

Returns authenticated user's deposit history.

Blockchain detection and confirmation are backend responsibilities.

## 9. Withdrawals

### `POST /withdrawals`

Example:

```json
{
  "asset": "USDC",
  "amount": "25.000000",
  "chain": "example-chain",
  "destinationAddress": "validated-address",
  "idempotencyKey": "opaque-request-key"
}
```

Processing stages should be visible through stable status values, e.g. `requested`, `risk_review`, `approved`, `broadcast`, `confirmed`, `failed`, `reversed`.

## 10. Creator / Coin Creation

### `GET /creator/entitlements`

Returns the authenticated user's creator entitlements.

Example:

```json
{
  "freeCoinCreation": {
    "remaining": 1,
    "status": "available"
  }
}
```

### `POST /coins/drafts`

Creates a draft coin project.

Required inputs include validated name, symbol, description, launch mode, and relevant chain/configuration.

### `POST /coins/{coinId}/launch`

Launches an eligible coin project after server-side checks.

The backend verifies entitlement, campaign requirements, safety checks, and launch configuration before consuming the entitlement.

### `GET /coins/{slug}`

Public canonical coin page data.

## 11. Share-to-Unlock

### `POST /growth/share-intents`

Creates a share intent for an eligible creator.

Request:

```json
{
  "campaignKey": "free-mayhem-v1",
  "channel": "x",
  "targetType": "campaign",
  "targetId": "campaign-or-coin-id"
}
```

### `POST /growth/share-intents/{id}/complete`

Records user-reported completion or provider callback completion where applicable.

The API must distinguish user-reported completion from provider-verified completion.

### `GET /growth/unlocks`

Returns unlock status for the authenticated user.

### `POST /growth/unlocks/claim`

Claims an available entitlement after campaign conditions have been satisfied. This operation is idempotent and race-safe.

## 12. Discovery

### `GET /discovery/coins`

Supports discovery categories:

- new
- recently-launched
- most-viewed
- most-shared
- most-watched
- most-active
- trending

Responses must expose the meaning of metrics where useful and must not present promotional/engine-generated activity as organic user trading.

## 13. Airdrop Intelligence

### `GET /airdrop/projects`

Returns public research projects with status, confidence, and risk metadata.

### `GET /airdrop/campaigns/{campaignId}`

Returns campaign details and source provenance.

### `GET /airdrop/campaigns/{campaignId}/tasks`

Returns known tasks and official source URLs.

### `POST /airdrop/tasks/{taskId}/progress`

Records user progress without collecting private keys or seed phrases.

### `GET /airdrop/me`

Returns authenticated user's tracked progress.

## 14. WebSocket Channels

Candidate channels:

```text
market:ticker:{marketId}
market:orderbook:{marketId}
market:trades:{marketId}
user:orders:{userId}
user:balances:{userId}
creator:coin:{coinId}
discovery:activity
```

WebSocket events are projections. The client must recover from disconnects by querying authoritative REST state.

## 15. Error Contract

Example:

```json
{
  "error": {
    "code": "INSUFFICIENT_AVAILABLE_BALANCE",
    "message": "Available balance is insufficient for this operation.",
    "requestId": "request-id"
  }
}
```

Suggested error families:

- `UNAUTHENTICATED`
- `FORBIDDEN`
- `VALIDATION_ERROR`
- `RESOURCE_NOT_FOUND`
- `RATE_LIMITED`
- `IDEMPOTENCY_CONFLICT`
- `INSUFFICIENT_AVAILABLE_BALANCE`
- `MARKET_DISABLED`
- `ENTITLEMENT_UNAVAILABLE`
- `UNLOCK_REQUIREMENT_NOT_MET`
- `COIN_LAUNCH_REJECTED`
- `RISK_REVIEW_REQUIRED`
- `EXTERNAL_PROVIDER_ERROR`
- `INTERNAL_ERROR`

## 16. Pagination

Use cursor pagination for high-volume resources.

Example:

```text
GET /orders?limit=50&cursor=opaque-cursor
```

Cursors are opaque and should not expose database implementation details.

## 17. Idempotency Contract

For financial or entitlement-mutating requests:

- client sends an opaque `Idempotency-Key` HTTP header;
- server hashes the relevant request payload;
- identical key + identical request returns the original outcome;
- identical key + different request returns `IDEMPOTENCY_CONFLICT`;
- expired keys follow documented retention rules.

The database unique constraint remains the final concurrency guard.

## 18. Rate Limits

Apply separate limits for:

- authentication;
- public discovery;
- market data;
- order commands;
- creator creation/launch;
- social-share/unlock commands;
- airdrop research endpoints;
- administrative APIs.

Limits must be observable and adjustable without code deployment where safe.

## 19. API Security

- strict CORS policy;
- CSRF protection where cookie authentication requires it;
- schema validation;
- output encoding;
- authorization on every resource;
- abuse/rate-limit controls;
- request IDs;
- structured security logs;
- no sensitive credentials in logs;
- webhook signature verification for external callbacks;
- replay protection for callbacks.

## 20. Contract Testing

Every endpoint requires:

- request validation tests;
- authorization tests;
- happy-path integration test;
- failure-path tests;
- idempotency tests for mutations;
- OpenAPI schema validation;
- compatibility checks before breaking changes.

Financial endpoints additionally require ledger invariant and reconciliation tests.

## 21. Versioning

Prefer additive, backward-compatible changes. Breaking changes use an explicit API versioning strategy rather than silently changing the meaning of an existing field.

## 22. Implementation Order

1. API bootstrap + health/readiness
2. auth/user
3. assets/markets
4. ledger/balances
5. orders/trades
6. deposits/withdrawals
7. creator/entitlements
8. growth/share-to-unlock
9. discovery
10. airdrop intelligence
11. realtime WebSocket layer
12. OpenAPI + contract tests
