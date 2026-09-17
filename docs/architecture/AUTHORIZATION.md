# TradeShark — Authorization Boundary

> Status: foundation contract
> Scope: authenticated identity → account authorization

## Principle

Authentication answers **who is this?** Authorization answers **what may this identity do?**

A valid session must never be treated as permission to perform every operation.

## Current account states

The user model currently supports:

- `active` — normal authenticated access;
- `suspended` — authentication/session validation must not grant normal access;
- `closed` — the account is no longer an active trading identity.

The identity service currently validates sessions only for users whose status is `active`. fileciteturn1088file0

## Authorization layers

Protected endpoints should evaluate, in order:

1. **Authentication** — resolve the session and user.
2. **Account state** — reject suspended/closed identities.
3. **Role / permission** — determine whether the action is allowed.
4. **Resource ownership** — ensure the user can access the requested resource.
5. **Risk / security policy** — apply operation-specific controls.
6. **Financial policy** — enforce server-side limits, fees, balance availability and settlement rules.

## Sensitive operations

The following operations require explicit authorization and policy checks:

- withdrawals;
- deposits and crediting;
- order creation/cancellation;
- trade settlement;
- coin creation;
- account/security changes;
- administrative actions;
- API key or external integration management.

Clients must not be trusted to declare that an operation is authorized.

## Recommended permission vocabulary

The first permission set should remain small and explicit:

```text
account:read
account:write
security:write
wallet:read
wallet:deposit
wallet:withdraw
orders:read
orders:create
orders:cancel
trades:read
coin:create
admin:read
admin:write
```

These are authorization concepts, not a promise that every permission is currently implemented.

## Resource ownership

For user-owned resources, authorization must check the authenticated user ID against the resource owner ID inside the server-side service boundary.

Example:

```text
GET /api/v1/orders/:orderId
        │
        ▼
resolve session
        │
        ▼
require active account
        │
        ▼
load order
        │
        ▼
order.user_id === session.user.id
        │
   ┌────┴────┐
   │         │
 allow     deny
```

Do not rely on UI visibility or route obscurity as an access-control mechanism.

## Financial authorization

A user being authenticated does not imply that their requested financial action is valid.

Financial services must additionally enforce:

- available balance;
- asset status;
- market status;
- operation limits;
- idempotency;
- ledger invariants;
- risk controls;
- withdrawal policy;
- reconciliation requirements.

The double-entry ledger remains the source of financial truth; application authorization must not mutate balances directly.

## Administrative access

Administrative privileges must be separate from ordinary user privileges. Admin APIs must require an explicit admin role/permission and should produce auditable activity events.

Do not implement an implicit `isAdmin` check based on email address, username, or client-controlled input.

## Future identity evolution

The current database already has a durable user identity model and authentication sessions. fileciteturn1084file0

Future additions can introduce dedicated roles, permissions, API keys, service identities, MFA factors, device/session management, and policy evaluation without changing the fundamental boundary described here.
