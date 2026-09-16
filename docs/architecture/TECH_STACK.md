# TradeShark — Technical Stack

> **Status:** Proposed architecture baseline  
> **Scope:** Phase 0 → production foundation  
> **Related:** `FOUNDATION.md`

---

## 1. Purpose

This document defines the technical stack for TradeShark and, more importantly, the boundaries around that stack.

TradeShark is intended to grow from a serious web trading product into a larger financial/trading technology platform. The stack therefore needs to support:

- responsive trading interfaces;
- realtime market data;
- transactional financial accounting;
- trading and matching logic;
- asynchronous jobs;
- AI-assisted operations;
- analytics and experimentation;
- strong security and auditability;
- SEO-friendly public content;
- mobile-first UX;
- independent scaling of critical services;
- safe deployment and rollback;
- long-term maintainability.

The goal is **not** to use every fashionable technology. The goal is to establish a small, coherent core that can scale without forcing an early rewrite.

---

## 2. Architectural Principle

The initial system follows:

```text
                    ┌─────────────────────┐
                    │   Public Web / SEO  │
                    │   Trading UI        │
                    └──────────┬──────────┘
                               │ HTTPS / WSS
                               ▼
                    ┌─────────────────────┐
                    │      API Layer      │
                    │ Auth / REST / WS    │
                    └───────┬─────┬───────┘
                            │     │
                ┌───────────┘     └────────────┐
                ▼                              ▼
       ┌─────────────────┐            ┌─────────────────┐
       │   PostgreSQL    │            │      Redis      │
       │ source of truth │            │ cache / queues  │
       └───────┬─────────┘            └────────┬────────┘
               │                               │
               ▼                               ▼
       ┌─────────────────┐            ┌─────────────────┐
       │ Trading Engine  │            │ Background Jobs │
       │ Market Engine   │            │ Notifications   │
       └────────┬────────┘            └────────┬────────┘
                │                              │
                └──────────────┬───────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  AI Supervisor      │
                    │ observability / ops │
                    └─────────────────────┘
```

### Core rule

**PostgreSQL is the durable source of truth for business state. Redis is not the financial ledger.**

Realtime systems may be optimized for speed, but financial state must remain reconstructable from durable records.

---

# 3. Recommended Stack at a Glance

| Layer | Recommendation | Status |
|---|---|---|
| Language | TypeScript | Proposed baseline |
| Runtime | Node.js LTS | Proposed baseline |
| Package manager | pnpm | Proposed baseline |
| Monorepo | pnpm workspaces; Turborepo when needed | Proposed baseline |
| Web app | Next.js + React | Proposed baseline |
| Styling | Tailwind CSS + TradeShark design system | Proposed baseline |
| Components | Accessible custom primitives; shadcn/ui-compatible approach | Proposed baseline |
| Charts | TradingView Lightweight Charts or equivalent licensed charting library | Pending license validation |
| API | NestJS on Fastify adapter | Proposed baseline |
| API protocol | REST + WebSocket | Proposed baseline |
| API contract | OpenAPI | Proposed baseline |
| Validation | Zod at application boundaries | Proposed baseline |
| Database | PostgreSQL | **Core decision** |
| ORM/query layer | Drizzle ORM + explicit SQL where required | Proposed baseline |
| Cache | Redis | Proposed baseline |
| Queues | BullMQ on Redis | Proposed baseline |
| Durable events | PostgreSQL outbox pattern | Proposed baseline |
| Auth | Dedicated identity module with established provider/library | Vendor pending |
| Authorization | RBAC + resource/policy checks | Proposed baseline |
| IDs | UUIDv7 where supported | Proposed baseline |
| Time | UTC internally | **Core decision** |
| Money | Integer minor units or exact PostgreSQL NUMERIC by domain | **Core decision** |
| Tests | Vitest + Playwright | Proposed baseline |
| Load tests | k6 | Proposed baseline |
| Lint/format | ESLint + Prettier | Proposed baseline |
| CI/CD | GitHub Actions | Proposed baseline |
| Analytics | PostHog | Available/connected |
| Observability | OpenTelemetry + structured logs | Proposed baseline |
| Logging | Pino-compatible structured JSON | Proposed baseline |
| Security scanning | CodeQL + Dependabot + secret scanning | Proposed baseline |
| Containers | Docker | Proposed baseline |
| Object storage | S3-compatible storage | Proposed baseline |
| SEO | Next.js SSR/SSG + metadata + sitemap + structured data | Proposed baseline |
| Feature flags | PostHog for product experiments; DB/config gates for critical controls | Proposed baseline |
| Deployment provider | Not locked yet | Pending |

---

# 4. Language and Runtime

## 4.1 TypeScript

TradeShark should use TypeScript across the primary application and service layer.

### Why

- shared types between frontend and backend;
- strong refactoring support;
- good ecosystem for web applications;
- suitable for API, realtime, workers and tooling;
- easier onboarding than maintaining several languages in the first production system.

### Strictness

TypeScript should run in strict mode.

Expected principles:

```text
strict: true
noImplicitAny: true
noUncheckedIndexedAccess: true
exactOptionalPropertyTypes: true
```

The exact compiler options can be finalized in the repository configuration, but the project should prefer correctness over convenience.

### Rule

Do not use `any` to silence an architectural problem. If an external API is uncertain, validate and narrow it at the boundary.

---

# 5. Node.js Runtime

Use the current supported Node.js LTS line for production.

### Rules

- pin the major runtime version in project configuration;
- use the same major version locally and in CI;
- upgrade deliberately, not randomly;
- run dependency and runtime upgrade tests before production rollout.

The repository should contain an explicit version file such as `.nvmrc` or the equivalent supported by the chosen environment.

---

# 6. Package Management

## 6.1 pnpm

Use `pnpm` for dependency management and workspaces.

### Reasons

- efficient disk usage;
- strong workspace support;
- deterministic lockfile;
- appropriate for a monorepo;
- good separation of package dependencies.

The lockfile is committed.

### Dependency rules

1. Avoid unnecessary dependencies.
2. Prefer maintained projects with clear licensing.
3. Pin or constrain versions deliberately.
4. Review major upgrades.
5. Run security scanning continuously.
6. Do not install a package merely because it is popular.

---

# 7. Monorepo Strategy

Initial structure:

```text
TradeShark/
├── apps/
│   ├── web/
│   └── api/
├── services/
│   ├── trading-engine/
│   ├── market-engine/
│   └── ai-supervisor/
├── packages/
│   ├── database/
│   ├── ledger/
│   ├── shared/
│   ├── config/
│   └── ui/
├── docs/
├── tests/
└── infra/
```

### Workspace philosophy

A package should exist when it represents a meaningful reusable boundary, not simply because a folder can be made into a package.

Avoid creating dozens of tiny packages early.

## 7.1 Turborepo

Turborepo can be introduced once build/test orchestration becomes materially useful.

It is **not required on day one** if plain pnpm workspaces are sufficient.

This keeps Phase 0 simple while preserving a path to efficient incremental builds.

---

# 8. Frontend

## 8.1 Next.js + React

The primary web application should use Next.js with React and TypeScript.

### Responsibilities

The web application handles:

- public marketing pages;
- documentation;
- SEO content;
- authentication UX;
- dashboard;
- trading terminal;
- portfolio views;
- transaction history;
- account settings;
- responsive mobile experience;
- AI interaction surfaces;
- command interface;
- realtime presentation.

### Rendering strategy

Use the right rendering mode per page:

| Page type | Preferred approach |
|---|---|
| Marketing | Static/Server rendered |
| Documentation | Static/Server rendered |
| SEO content | Server/static rendering |
| Public market pages | Server + cached data |
| Authenticated dashboard | Server shell + client data |
| Trading terminal | Client-heavy realtime UI |
| Admin | Authenticated application |

Do not make the entire site a client-side application if server rendering materially improves SEO and initial performance.

---

# 9. Frontend Design System

TradeShark needs its own design system instead of scattered CSS decisions.

## 9.1 Tailwind CSS

Tailwind is proposed for predictable styling and rapid iteration.

## 9.2 UI primitives

Use accessible primitives and build the TradeShark visual language on top of them.

A shadcn/ui-compatible approach is acceptable because components remain project-owned rather than becoming a black-box design dependency.

### Design tokens

The design system should define:

- colors;
- typography;
- spacing;
- radii;
- shadows;
- borders;
- motion;
- z-index layers;
- surface hierarchy;
- chart colors;
- status colors;
- accessibility contrast rules.

### Visual direction

```text
TradeShark UI
├── Normal Mode
│   ├── clean
│   ├── fast
│   ├── dense but readable
│   └── professional
│
└── Future Mode
    ├── spatial panels
    ├── holographic surfaces
    ├── AI visualization
    ├── advanced overlays
    └── command interface
```

### Important constraint

Future aesthetics must never compromise:

- readability;
- performance;
- accessibility;
- trading accuracy;
- touch usability;
- information hierarchy.

---

# 10. Charting

The trading interface requires a dedicated financial charting library.

A lightweight candlestick chart library such as TradingView Lightweight Charts is a candidate, subject to current licensing and product requirements.

### Chart requirements

- candlesticks;
- volume;
- crosshair;
- zoom/pan;
- timeframes;
- price scale;
- drawing tools where legally/licensing appropriate;
- indicators;
- realtime updates;
- mobile interaction;
- high-frequency update handling;
- data-gap handling.

### Rule

Do not couple the chart directly to database queries. The UI should consume a market-data API/stream optimized for charting.

---

# 11. Backend API

## 11.1 NestJS + Fastify adapter

NestJS is proposed for the main API because TradeShark has many explicit business domains:

```text
identity
users
wallets
ledger
assets
markets
orders
trades
positions
fees
withdrawals
deposits
notifications
admin
analytics
```

A structured backend framework helps enforce boundaries as the project grows.

Fastify is preferred as the underlying HTTP adapter for efficient request handling.

### Backend principles

- modular domain boundaries;
- dependency injection where useful;
- explicit DTO/schema validation;
- centralized error handling;
- structured logging;
- request IDs;
- idempotency support;
- authorization at the service boundary;
- audit events for sensitive operations.

---

# 12. API Style

## 12.1 REST

Use REST for the primary public/application API.

Examples:

```text
GET    /api/v1/markets
GET    /api/v1/markets/:marketId
GET    /api/v1/orders
POST   /api/v1/orders
DELETE /api/v1/orders/:orderId
GET    /api/v1/portfolio
GET    /api/v1/ledger/entries
POST   /api/v1/deposits
POST   /api/v1/withdrawals
```

## 12.2 API versioning

Initial public application APIs should use a version boundary such as:

```text
/api/v1/...
```

Breaking changes require a deliberate versioning strategy.

## 12.3 OpenAPI

The API contract should be represented in OpenAPI.

Benefits:

- documentation;
- client generation;
- contract testing;
- external integration readiness;
- easier AI/tooling integration later.

---

# 13. Validation

Use Zod or equivalent schema validation at untrusted boundaries.

Validate:

- HTTP bodies;
- query parameters;
- route parameters;
- WebSocket messages;
- webhook payloads;
- external API responses;
- configuration/environment variables.

### Rule

TypeScript types alone do not validate runtime input.

---

# 14. Database

# PostgreSQL is the primary database.

This is one of the foundational architecture decisions.

## Why PostgreSQL

TradeShark requires:

- ACID transactions;
- relational integrity;
- constraints;
- precise financial data types;
- complex queries;
- strong indexing;
- transactional consistency;
- audit-friendly data structures;
- mature backup tooling;
- extensibility.

### PostgreSQL owns

- users;
- accounts;
- balances as represented by ledger state;
- ledger entries;
- orders;
- trades;
- positions;
- assets;
- markets;
- fees;
- withdrawals;
- deposits;
- entitlements;
- audit records;
- configuration requiring durability.

---

# 15. ORM / Query Layer

## Drizzle ORM

Drizzle is proposed for application-level database access.

### Why

- TypeScript-first;
- close relationship to SQL;
- explicit schema;
- easier reasoning about financial queries than highly abstract ORM patterns;
- migration support;
- good fit for a PostgreSQL-centric architecture.

### Important rule

ORM convenience must never override financial correctness.

Raw SQL is allowed where it makes a transaction, lock, aggregation, or query plan clearer and safer.

---

# 16. Financial Data Representation

This is a critical rule.

## Never use JavaScript floating-point numbers as the authoritative representation of money.

For example, do not treat:

```ts
balance = 0.1 + 0.2
```

as authoritative accounting.

### Preferred representation

Use exact representations such as:

- integer minor units for currencies where the precision is fixed;
- PostgreSQL `NUMERIC` for asset quantities requiring configurable precision;
- explicit decimal arithmetic libraries at the application boundary.

The exact precision rules for each asset class belong in the database specification and ledger specification.

---

# 17. IDs

UUIDv7 is the preferred ID format where the ecosystem supports it cleanly.

### Benefits

- globally unique;
- sortable by creation time;
- suitable for distributed services;
- less dependent on database sequence exposure.

Security-sensitive identifiers should not expose business meaning.

---

# 18. Time

## UTC internally

All server-side timestamps should be stored and processed in UTC.

The frontend converts timestamps into the user's display timezone.

Use explicit timestamp fields such as:

```text
created_at
updated_at
executed_at
settled_at
expires_at
```

Never infer timezone from an ambiguous string.

---

# 19. Redis

Redis is proposed for high-speed ephemeral infrastructure.

## Appropriate uses

- cache;
- rate-limit counters;
- short-lived session/state where appropriate;
- distributed locks with careful design;
- realtime fan-out support;
- job queues through BullMQ;
- temporary market-data state.

## Inappropriate use

Redis must not be the only durable source for:

- financial balances;
- ledger entries;
- executed trades;
- withdrawal state;
- critical audit history.

---

# 20. Background Jobs

## BullMQ + Redis

Use BullMQ for asynchronous work such as:

- notifications;
- email;
- webhook processing;
- market-data normalization;
- scheduled maintenance;
- analytics aggregation;
- SEO generation pipelines;
- non-critical AI tasks;
- reconciliation jobs;
- cleanup tasks.

### Job requirements

Every important job should have:

- unique job identity;
- retry policy;
- exponential backoff where appropriate;
- maximum retry count;
- dead-letter/failure handling;
- observability;
- idempotent behavior.

---

# 21. Durable Event Pattern

For business-critical events, use a PostgreSQL outbox pattern before introducing a heavyweight event bus.

Example:

```text
DB transaction
   │
   ├── write business state
   └── write outbox event
           │
           ▼
      dispatcher
           │
           ▼
   async consumers
```

This prevents the classic failure where the database transaction succeeds but an external event is lost.

### Future scale

If throughput and organizational complexity justify it later, the event layer can evolve toward a dedicated broker such as Kafka or NATS.

That is intentionally **not** a Phase 0 requirement.

---

# 22. Realtime Architecture

Trading interfaces require WebSockets for live updates.

## WebSocket responsibilities

- market ticker updates;
- order book updates;
- candle updates;
- order status;
- trade execution events;
- portfolio updates;
- notifications;
- AI/status events.

### REST vs WebSocket

```text
REST
→ commands
→ historical queries
→ account queries
→ configuration

WebSocket
→ realtime state changes
→ streaming market data
→ execution events
```

### Important rule

A WebSocket message is a transport event, not the financial source of truth.

---

# 23. Trading Engine

The Trading Engine is a distinct domain service.

Responsibilities include:

- order validation;
- order lifecycle;
- matching/execution logic where applicable;
- fee calculation;
- trade generation;
- position updates;
- mode-specific behavior;
- entitlement enforcement;
- idempotency;
- risk checks.

### Modes

TradeShark's planned modes include:

- Slow;
- Fast;
- Flash;
- Crack;
- Mayhem.

The engine must treat these as explicit domain modes rather than UI-only labels.

---

# 24. Market Engine

The Market Engine handles market-specific behavior and data.

Responsibilities may include:

- price generation or ingestion depending on market type;
- order-book state;
- candle construction;
- volume accounting;
- liquidity simulation where applicable;
- market status;
- realtime market broadcasts.

### Critical integrity rule

Engine-generated activity must remain distinguishable from user-generated trading activity.

Never present generated volume as organic user volume.

---

# 25. Ledger Package

The ledger is its own conceptual package.

```text
packages/ledger/
```

It should enforce double-entry accounting rules.

### Requirements

- immutable journal entries;
- balanced debits and credits;
- transaction references;
- idempotency keys;
- currency/asset precision;
- audit trail;
- reversal/correction mechanisms;
- reconciliation support.

The wallet balance displayed by the frontend should be derived from authoritative financial state, not from an arbitrary mutable UI field.

---

# 26. Authentication

Authentication should be isolated behind an identity module.

The exact external provider/library remains a Phase 0 implementation decision.

### Requirements

- secure password handling if passwords are supported;
- email verification where required;
- MFA capability;
- session management;
- device/session visibility;
- secure recovery flows;
- rate limiting;
- suspicious-login detection;
- audit logging;
- secure cookie/session configuration.

### Rule

Do not write a custom password hashing/session system when a mature security-reviewed solution is appropriate.

---

# 27. Authorization

Use layered authorization.

```text
Authentication
      ↓
Role / account permissions
      ↓
Resource ownership
      ↓
Action-specific policy
      ↓
Financial/risk constraints
```

Examples:

- user can access only their own wallet;
- user cannot withdraw another user's funds;
- admin operations require explicit privilege;
- financial configuration changes require stronger authorization;
- AI actions cannot bypass human approval gates where configured.

---

# 28. Idempotency

Idempotency is mandatory for sensitive operations.

Examples:

```text
POST /orders
POST /withdrawals
POST /deposits/webhook
POST /payments/confirm
```

A client retry must not accidentally create:

- duplicate withdrawal;
- duplicate deposit credit;
- duplicate trade;
- duplicate ledger posting.

Idempotency keys should be stored and associated with the resulting operation.

---

# 29. Security Baseline

Security is part of the architecture, not a final checklist.

## Required baseline

- HTTPS in production;
- secure headers;
- CSRF protection where applicable;
- XSS prevention;
- input validation;
- SQL injection protection;
- rate limiting;
- abuse detection;
- secure cookies;
- secrets outside source control;
- dependency scanning;
- code scanning;
- audit logging;
- least-privilege service credentials;
- database backups;
- restore testing;
- incident procedures.

## Secrets

Never commit:

- API keys;
- private keys;
- seed phrases;
- passwords;
- session tokens;
- production credentials;
- database credentials.

`.env.example` may document variable names, never real secrets.

---

# 30. Configuration

Separate configuration from code.

Categories:

```text
Environment configuration
Feature configuration
Business configuration
Risk configuration
Operational configuration
```

### Examples

```text
MIN_DEPOSIT
MIN_WITHDRAWAL
TRADING_FEE_RATE
MAYHEM_FREE_DURATION
MAX_ORDER_SIZE
RATE_LIMITS
```

Critical financial/risk values should be validated at startup and audited when changed.

---

# 31. Feature Flags

Feature flags are useful for:

- staged releases;
- experiments;
- Future Mode;
- new trading features;
- AI features;
- UI migrations.

PostHog can handle product experiments and analytics-related flags.

Critical financial controls should not depend exclusively on a marketing analytics platform. They should have an authoritative configuration source with auditability and safe defaults.

---

# 32. Analytics

PostHog is the proposed product analytics layer.

Track events such as:

```text
signup_completed
login_completed
market_viewed
chart_interacted
order_created
order_cancelled
trade_executed
deposit_started
deposit_completed
withdrawal_started
withdrawal_completed
feature_used
future_mode_enabled
ai_action_requested
```

### Analytics rule

Analytics events are not financial records.

A PostHog event must never be treated as proof that a financial transaction occurred.

The ledger/database remains authoritative.

---

# 33. Observability

TradeShark should implement three observability pillars:

```text
Logs
Metrics
Traces
```

## OpenTelemetry

Use OpenTelemetry as the instrumentation boundary where practical.

Capture:

- request latency;
- database latency;
- queue latency;
- WebSocket connection metrics;
- trading-engine processing time;
- market-engine processing time;
- error rates;
- job failure rates.

### Request correlation

Each request/event should have a trace or correlation identifier that can connect:

```text
frontend action
→ API request
→ database transaction
→ queue job
→ engine operation
→ resulting event
```

This is essential for debugging financial operations.

---

# 34. Logging

Use structured JSON logging.

Example conceptual event:

```json
{
  "level": "info",
  "event": "order.executed",
  "request_id": "...",
  "order_id": "...",
  "trade_id": "...",
  "timestamp": "..."
}
```

Never log secrets or sensitive authentication material.

Be careful with personally identifiable information.

---

# 35. Error Tracking

The application should eventually use a dedicated error tracking platform.

The integration should capture:

- stack traces;
- release version;
- environment;
- request correlation ID;
- relevant non-sensitive context.

The exact vendor can remain a deployment/operations decision rather than a core application dependency.

---

# 36. Testing Stack

## Unit tests

Use Vitest.

Test:

- fee calculations;
- precision calculations;
- order validation;
- entitlement rules;
- ledger balancing;
- risk rules;
- mode behavior;
- utility functions.

## Integration tests

Test:

- database transactions;
- API/database interactions;
- queue processing;
- ledger posting;
- webhook idempotency.

## End-to-end tests

Use Playwright.

Critical flows:

```text
signup
login
wallet view
deposit
demo/trading flow
order creation
order cancellation
trade settlement
withdrawal
settings
mobile navigation
```

## Load testing

Use k6 for API/realtime performance testing.

---

# 37. Test Pyramid

```text
             /
            /  \
           / E2E\
          /------\
         /Integr. \
        /----------\
       / Unit Tests \
      /--------------\
```

The largest number of tests should be fast unit tests.

Financial correctness must have especially strong unit and integration coverage.

---

# 38. CI/CD

Use GitHub Actions.

## Pull request pipeline

At minimum:

```text
install
→ typecheck
→ lint
→ unit tests
→ integration tests
→ build
→ security checks
```

For relevant changes:

```text
→ E2E tests
→ database migration checks
→ API contract checks
```

## Deployment pipeline

```text
commit
 ↓
CI
 ↓
artifact/image
 ↓
staging
 ↓
smoke tests
 ↓
approval gate where required
 ↓
production
 ↓
health verification
```

---

# 39. Docker

Services should be containerizable.

At minimum:

```text
web
api
trading-engine
market-engine
worker
```

Local development can use Docker Compose or an equivalent container orchestration approach for infrastructure dependencies such as PostgreSQL and Redis.

### Rule

Containers should be reproducible and configuration should be injected through environment/configuration mechanisms.

---

# 40. Deployment Provider

Do not lock TradeShark to a specific hosting provider during Phase 0.

The application should first be deployment-portable through:

- Docker;
- environment variables;
- managed PostgreSQL compatibility;
- managed Redis compatibility;
- S3-compatible object storage;
- standard HTTP/WebSocket networking.

A concrete provider can be selected after the initial repository and workload profile are known.

This avoids designing the application around a hosting provider before measuring actual requirements.

---

# 41. Storage

Use S3-compatible object storage for large/binary objects where necessary.

Potential uses:

- user-uploaded assets;
- generated documents;
- exports;
- backups where appropriate;
- media/content assets.

Do not store large files directly inside PostgreSQL unless there is a clear reason.

---

# 42. SEO Architecture

SEO is a first-class product system for public pages.

Next.js should provide:

- server rendering;
- static generation where appropriate;
- metadata;
- canonical URLs;
- sitemap generation;
- robots directives;
- structured data;
- Open Graph metadata;
- fast page delivery.

### Knowledge architecture

```text
Data
 ↓
Knowledge Base
 ↓
Product Pages
 ↓
Educational Content
 ↓
Internal Linking Graph
 ↓
Search Visibility
 ↓
Analytics
 ↓
Iteration
```

SEO content must not fabricate market statistics, users, transactions, volume, or claims.

---

# 43. AI Supervisor

The AI Supervisor is an orchestration and intelligence layer, not a replacement for deterministic financial systems.

Possible responsibilities:

- monitoring;
- anomaly detection;
- documentation assistance;
- SEO research support;
- operational recommendations;
- maintenance planning;
- incident summarization;
- product analytics interpretation;
- controlled automation.

### Hard boundary

AI must not silently mutate critical financial state.

Sensitive actions should use:

```text
AI recommendation
→ policy check
→ approval gate where required
→ deterministic service
→ audited execution
```

---

# 44. AI and Tooling Boundary

AI agents should interact with TradeShark through explicit tools/APIs.

Do not give an AI agent unrestricted direct database write access in production.

Prefer:

```text
Agent
 ↓
Tool
 ↓
Validation
 ↓
Authorization
 ↓
Business service
 ↓
Database transaction
```

This preserves auditability and limits blast radius.

---

# 45. Browser/Data Collection

Future browser-assisted research can collect public information where permitted.

It must never collect or expose:

- passwords;
- private keys;
- seed phrases;
- session tokens;
- authentication cookies;
- confidential personal data.

Research outputs should be categorized:

```text
Observed Facts
Learned Insights
TradeShark Original
```

This prevents copied competitor behavior from silently becoming product truth.

---

# 46. Performance Budget

Performance must be measurable.

Initial targets should include:

- fast first meaningful render;
- minimal JavaScript on public pages;
- responsive interactions;
- controlled WebSocket update rates;
- no unnecessary chart redraws;
- efficient database queries;
- bounded API payloads;
- mobile-friendly rendering.

Exact numerical budgets should be established during implementation after baseline measurement.

### Rule

Do not add animation, 3D, particle effects, or heavy client libraries unless the measured user value justifies the cost.

---

# 47. Mobile Architecture

Mobile is not a later adaptation.

The frontend should be responsive from the first implementation.

Priority:

```text
Touch targets
Readable prices
Fast order actions
Chart usability
Bottom navigation
Scrollable panels
Safe spacing
```

Trading actions require special attention to accidental taps and confirmation behavior.

---

# 48. Accessibility

Target WCAG-aligned accessibility practices.

Minimum expectations:

- keyboard navigation where applicable;
- visible focus states;
- semantic HTML;
- sufficient contrast;
- reduced-motion support;
- screen-reader labels;
- accessible forms;
- non-color-only status indicators.

A futuristic interface is not an excuse for inaccessible controls.

---

# 49. Database Migration Strategy

Database schema changes must use versioned migrations.

Never rely on manually editing production databases as the normal deployment method.

Migration principles:

1. backward compatibility where practical;
2. small changes;
3. tested rollback/forward strategy;
4. data migrations separated from schema changes when appropriate;
5. production backup before high-risk migrations;
6. migration observability.

---

# 50. Backup and Recovery

Backups are only useful if restores work.

Required eventually:

- automated PostgreSQL backups;
- point-in-time recovery where supported;
- encrypted backups;
- retention policy;
- restore drills;
- documented RPO/RTO targets;
- incident recovery runbook.

The exact RPO/RTO values should be decided before real-money production launch.

---

# 51. Environments

At minimum:

```text
local
staging
production
```

### Local

Safe development data.

### Staging

Production-like architecture without real financial exposure.

### Production

Real users and real financial operations only after the security/regulatory gate is passed.

---

# 52. Environment Isolation

Never let local or staging systems accidentally access production financial data.

Production credentials must be isolated.

Development datasets should use synthetic data or sanitized datasets.

---

# 53. Dependency Boundaries

Recommended dependency direction:

```text
apps/web
   ↓
API contracts / shared UI

apps/api
   ↓
domain packages
   ↓
database / ledger

services/trading-engine
   ↓
domain packages
   ↓
database / event interfaces
```

Avoid circular dependencies between business domains.

---

# 54. Domain Ownership

Suggested ownership:

| Domain | Primary owner |
|---|---|
| Identity | API / identity module |
| Accounts | API |
| Wallet | Ledger + financial domain |
| Ledger | `packages/ledger` |
| Markets | Market Engine |
| Orders | Trading Engine |
| Trades | Trading Engine |
| Pricing | Market Engine |
| Realtime | API/streaming layer |
| Analytics | PostHog + internal events |
| AI | AI Supervisor |
| SEO | Web + content system |
| Admin | API + admin UI |

Ownership must be explicit before implementation becomes large.

---

# 55. API and Event Naming

Use consistent domain-oriented naming.

Examples:

```text
order.created
order.accepted
order.rejected
order.cancelled
trade.executed
position.updated
ledger.entry.posted
withdrawal.requested
withdrawal.approved
withdrawal.completed
```

Events should represent facts that occurred, not vague commands.

---

# 56. Financial Transaction Flow

A simplified trade flow should eventually resemble:

```text
Client
 ↓
API validation
 ↓
Authentication
 ↓
Authorization
 ↓
Risk checks
 ↓
Trading Engine
 ↓
Execution
 ↓
Ledger transaction
 ↓
Outbox event
 ↓
Realtime broadcast
 ↓
Analytics event
```

The ledger transaction must succeed according to the financial rules before the system presents the operation as settled.

---

# 57. Reconciliation

The system should include automated reconciliation jobs.

Examples:

- wallet totals vs ledger totals;
- trade totals vs position state;
- order status vs execution records;
- deposits vs external payment confirmations;
- withdrawals vs provider status;
- market data consistency.

Any mismatch should become an observable operational event, not silently disappear.

---

# 58. Rate Limiting

Rate limiting should exist at multiple levels.

```text
IP
User
Account
Endpoint
Operation
```

Financially sensitive operations should have stricter controls.

Example categories:

- login;
- password recovery;
- order creation;
- withdrawal requests;
- API key operations;
- public market APIs.

---

# 59. Abuse and Fraud Controls

Architecture should support:

- velocity limits;
- duplicate behavior detection;
- withdrawal risk rules;
- device/session signals;
- suspicious activity flags;
- manual review;
- account freezes;
- audit history.

These controls must be designed before real-money launch, not after the first serious incident.

---

# 60. Product Integrity

TradeShark must not manufacture social proof.

Do not fabricate:

- users;
- trades;
- transaction counts;
- trading volume;
- testimonials;
- rankings;
- market activity.

If the platform generates simulated/engine activity, it must be clearly classified as such.

This is both a technical data-model requirement and a product-trust requirement.

---

# 61. Logging vs Audit Trail

These are different systems.

### Logs

Operational debugging.

### Audit trail

Durable record of sensitive business actions.

Financial/audit records must not depend on short-lived application logs.

---

# 62. Critical Kill Switches

The platform should support controlled emergency shutdowns for high-risk functions.

Examples:

```text
GLOBAL_TRADING_DISABLED
WITHDRAWALS_DISABLED
DEPOSITS_DISABLED
MARKET_DISABLED
MAYHEM_DISABLED
AI_AUTOMATION_DISABLED
```

Every critical switch needs:

- authorization;
- audit logging;
- clear UI status;
- safe default;
- recovery procedure.

---

# 63. Release Strategy

Use incremental releases.

Recommended sequence:

```text
internal development
→ local validation
→ staging
→ internal QA
→ controlled release
→ monitoring
→ broader release
```

Do not launch every planned feature simultaneously.

---

# 64. Observability-Driven Development

Before calling a feature production-ready, ask:

1. How do we know it works?
2. How do we know when it breaks?
3. How do we identify the affected user/operation?
4. How do we roll it back?
5. How do we reconcile its state?

If the answer is unclear, the feature is not operationally complete.

---

# 65. Initial Repository Configuration

The repository should eventually contain:

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
eslint.config.*
.prettierrc*
.nvmrc
.editorconfig
.gitignore
.env.example
```

And application-specific configuration under each workspace.

Do not create these files blindly; the exact implementation should follow the repository skeleton step.

---

# 66. Proposed Initial Workspace

```text
apps/
  web/                 # Next.js frontend
  api/                 # NestJS API

services/
  trading-engine/      # trading domain execution
  market-engine/       # market state/data
  ai-supervisor/       # AI orchestration

packages/
  database/            # PostgreSQL schema + queries
  ledger/              # accounting primitives
  shared/               # shared domain types/utilities
  config/               # validated configuration
  ui/                   # TradeShark design system

docs/
  architecture/
  product/
  security/
  seo/

tests/
  e2e/
  integration/
  load/

infra/
  docker/
  deployment/
  monitoring/
```

---

# 67. What We Are Deliberately NOT Building Yet

To prevent overengineering, Phase 0 should not automatically introduce:

- Kubernetes;
- Kafka;
- microservice-per-feature architecture;
- GraphQL everywhere;
- service mesh;
- blockchain settlement infrastructure;
- custom database engine;
- custom authentication cryptography;
- complex multi-region active/active infrastructure;
- 3D graphics engine as a requirement for basic trading;
- autonomous AI production writes.

These may become relevant later. They are not prerequisites for proving the product.

---

# 68. Scaling Path

### Stage 1 — Foundation

```text
Next.js
NestJS
PostgreSQL
Redis
BullMQ
WebSocket
Docker
```

### Stage 2 — Growth

Add:

- read replicas where useful;
- dedicated workers;
- stronger caching;
- CDN;
- dedicated market-data infrastructure;
- more granular service scaling.

### Stage 3 — Large Scale

Potential additions:

- dedicated event streaming;
- partitioned data;
- specialized time-series infrastructure;
- multi-region architecture;
- advanced market-data fan-out;
- independent engine clusters.

Scale should follow measured bottlenecks.

---

# 69. Technology Decision Rules

When evaluating a new technology, ask:

### 1. Does it solve a demonstrated problem?

### 2. Does it reduce or increase system complexity?

### 3. Can the team operate it reliably?

### 4. Does it have a clear migration/exit path?

### 5. Does it preserve financial correctness?

### 6. Does it improve measurable user experience?

### 7. Does it introduce a new security or vendor risk?

### 8. Is the license appropriate for the intended product?

If the answer is unclear, defer the dependency.

---

# 70. Mandatory Technology Gates

Before implementation of the corresponding subsystem, verify:

## Gate A — Database

- schema design complete;
- precision rules complete;
- indexes identified;
- migrations defined;
- backup strategy documented.

## Gate B — Ledger

- double-entry model complete;
- invariants defined;
- idempotency defined;
- reconciliation strategy defined;
- reversal/correction strategy defined.

## Gate C — Trading

- order lifecycle defined;
- mode semantics defined;
- fee rules defined;
- risk rules defined;
- engine-generated vs user-generated data separated.

## Gate D — Real Money

**Stop before launch.**

Confirm:

- security review;
- regulatory/legal review;
- KYC/AML requirements where applicable;
- payment provider requirements;
- withdrawal controls;
- auditability;
- incident response;
- backup/restore testing;
- kill switches;
- monitoring.

---

# 71. Pending Decisions

The following should remain explicit instead of being silently assumed:

1. Exact authentication provider/library.
2. Exact charting library and license.
3. Deployment provider.
4. Production observability vendor.
5. Payment provider(s).
6. Whether/when external blockchain infrastructure is needed.
7. Exact market-data sources.
8. Exact asset precision model.
9. RPO/RTO targets.
10. Legal/regulatory operating model.
11. Whether Turborepo is needed immediately or after the first workspace milestone.

---

# 72. Immediate Implementation Order

After this document:

```text
1. Repository skeleton
2. Root package/workspace configuration
3. Shared configuration package
4. Database package skeleton
5. Ledger package skeleton
6. API skeleton
7. Web skeleton
8. Trading Engine skeleton
9. Market Engine skeleton
10. AI Supervisor skeleton
11. CI workflow
12. Local PostgreSQL + Redis infrastructure
13. Initial health checks
14. Initial tests
```

Only after the skeleton is healthy should we implement detailed business behavior.

---

# 73. Definition of Done for the Stack Foundation

The stack foundation is complete when:

- repository workspaces install reproducibly;
- TypeScript builds cleanly;
- linting is configured;
- tests execute;
- web application boots;
- API boots;
- PostgreSQL connects;
- Redis connects;
- background worker boots;
- WebSocket layer can establish a connection;
- configuration is validated;
- CI can reproduce the build;
- no secrets are committed;
- documentation matches implementation.

---

# 74. Final Rule

TradeShark should be **boringly reliable underneath and radically futuristic on top**.

The interface can look like the year 3700.

The accounting should behave like an audited financial system.

The trading engine should behave deterministically.

The API should be observable.

The database should be recoverable.

The AI should be controlled.

The SEO system should be factual.

The user experience should remain fast.

That separation is the foundation of the TradeShark architecture.
