# TradeShark Release Gates

TradeShark moves to the next product layer only after the current layer is verified.

## Gate 1 — Infrastructure

- PostgreSQL migrations apply successfully.
- Migration replay is idempotent.
- Typecheck passes.
- Unit tests pass.
- PostgreSQL integration tests pass.
- CI is green on `main`.

## Gate 2 — Financial Core

- Double-entry journals remain balanced.
- Idempotent retries converge on the original transaction.
- Available/locked balances are atomic.
- Deposit and withdrawal lifecycle transitions are validated.
- Reconciliation detects projection drift at exact PostgreSQL `NUMERIC` precision.
- Funding settlement remains atomic with its journal transaction.

## Gate 3 — Trading Core

- Orders validate against market and account state.
- Funds are locked atomically before execution.
- Matching produces deterministic trades.
- Fees are explicit and auditable.
- Settlement posts through the ledger.
- Failed execution releases locked funds safely.
- Replay/idempotency behavior is tested.

## Gate 4 — Product Backend

- Authentication and authorization are enforced server-side.
- API contracts are versioned and validated.
- Rate limits and abuse controls exist on sensitive operations.
- Audit events cover financial and administrative actions.
- No private keys, seed phrases, or session secrets enter analytics or public activity streams.

## Gate 5 — Frontend

- Mobile-first responsive experience.
- Accessible navigation and forms.
- Trading state is never represented by client-only assumptions.
- Financial amounts preserve exact display precision.
- Error, loading, and empty states are intentional.

## Gate 6 — Growth, Mayhem & Airdrop Intelligence

- Free entitlements are one-time and server-enforced.
- Social-share unlock states are explicit and honest.
- Engine/promotional activity is separated from organic user activity.
- Public pages have canonical metadata and useful content.
- No fake users, followers, holders, views, trades, or volume.
- Public data collection respects source terms and privacy boundaries.

## Gate 7 — Production

- Production environment variables are configured outside source control.
- Database backups and restore procedures are documented.
- Error monitoring and health checks are active.
- CI/CD deploys only verified commits.
- Security review covers authentication, authorization, financial mutations, webhooks, and secrets.
- Smoke tests pass against the production deployment.

A release is considered **published** only after Gate 7 is satisfied.
