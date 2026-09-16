# TradeShark — Foundation & Technical Constitution

> **Status:** Draft v0.1 — foundational specification  
> **Repository:** `RezzaDevlopKai/TradeShark`  
> **Default branch:** `main`  
> **Purpose:** Establish the engineering, product, security, financial, data, AI, SEO, and UX principles that every future TradeShark implementation must respect.

---

## 0. Document Purpose

This document is the technical constitution of TradeShark. It exists to prevent the project from becoming a collection of disconnected features and to give every future contributor, agent, service, and automation a common set of rules.

TradeShark is intended to become a professional trading-oriented web platform with a distinctive futuristic interface, real-time market/trading experiences, strong reliability, auditable financial accounting, AI-assisted operations, and a long-lived technical architecture.

This document is intentionally more detailed than a normal README. The README explains what TradeShark is. This document explains **how TradeShark must be built**.

### Core rule

> **Do not optimize for visual excitement before correctness, security, accounting integrity, observability, and maintainability.**

A feature is not considered production-ready merely because it works in the happy path.

---

# 1. Product Vision

## 1.1 Vision

TradeShark aims to build a modern trading platform that feels like a financial interface from the future while remaining understandable and practical for real users.

The intended product characteristics are:

- fast;
- transparent;
- auditable;
- secure;
- responsive;
- data-driven;
- AI-assisted;
- extensible;
- visually distinctive;
- SEO-aware from the architecture level;
- maintainable for many years.

The futuristic concept is a **design direction**, not permission to sacrifice usability.

## 1.2 Long-term design target

TradeShark should be capable of evolving from a single web application into an ecosystem containing:

- trading interfaces;
- market/asset discovery;
- educational and knowledge content;
- analytics;
- community features;
- creator/token tooling where legally and technically appropriate;
- AI-assisted workflows;
- public market information;
- APIs and integrations;
- operational intelligence;
- automated monitoring;
- search-engine-visible knowledge architecture.

The architecture must therefore avoid unnecessary coupling between presentation, business rules, accounting, market simulation/processing, and operational automation.

---

# 2. Product Principles

Every major decision should be evaluated against these principles.

## P1 — Correctness before cosmetics

Financial state, order state, permissions, and security must be correct before visual polish is considered complete.

## P2 — Explicit state

Important state transitions must be represented explicitly. Avoid hidden mutations and ambiguous flags.

## P3 — Auditability

Critical actions must leave an immutable or append-only audit trail appropriate to the data class.

## P4 — Separation of concerns

Frontend, API, trading logic, market data, ledger, AI, analytics, and infrastructure should communicate through explicit contracts.

## P5 — Fail safely

When a dependency fails, TradeShark should prefer a safe degraded state over silently corrupting or fabricating state.

## P6 — Observability by default

Important systems should expose logs, metrics, traces, health state, and meaningful error identifiers.

## P7 — Human control for high-risk actions

AI may assist with analysis, recommendations, diagnostics, and low-risk automation, but high-impact financial, security, account, or production actions require explicit authorization and appropriate safeguards.

## P8 — Data minimization

Collect only data required for a legitimate product or security purpose. Never design around collecting credentials, seed phrases, private keys, session tokens, or unrelated private information.

## P9 — Original product

Competitor research may inform patterns and gaps, but TradeShark must not copy proprietary assets, source code, branding, protected content, or distinctive implementations merely because they are observed elsewhere.

## P10 — Build for evolution

Prefer modular interfaces and versioned contracts over shortcuts that make future changes dangerous.

---

# 3. High-Level Architecture

The target logical architecture is:

```text
                         ┌─────────────────────┐
                         │      Users          │
                         │ Web / Mobile Web    │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │    Frontend/Web     │
                         │ UI / UX / SSR / PWA │
                         └──────────┬──────────┘
                                    │
                         HTTPS / WS  │
                                    ▼
                         ┌─────────────────────┐
                         │       API           │
                         │ Auth / Business API │
                         └──────┬───────┬──────┘
                                │       │
                    ┌───────────┘       └────────────┐
                    ▼                                ▼
          ┌─────────────────┐              ┌─────────────────┐
          │ PostgreSQL      │              │ Redis / Queue   │
          │ Source of truth │              │ Cache / jobs    │
          └────────┬────────┘              └────────┬────────┘
                   │                                │
        ┌──────────┼───────────┐          ┌─────────┼─────────┐
        ▼          ▼           ▼          ▼         ▼         ▼
   ┌─────────┐ ┌─────────┐ ┌────────┐ ┌───────┐ ┌───────┐ ┌────────┐
   │ Ledger  │ │ Trading │ │ Users  │ │Market │ │Worker │ │ AI     │
   │ Service │ │ Engine  │ │Wallets │ │Engine │ │Jobs   │ │Supervisor│
   └─────────┘ └─────────┘ └────────┘ └───────┘ └───────┘ └────────┘
```

This is a logical architecture, not a requirement that every box become an independent microservice immediately.

## 3.1 Modular-monolith-first principle

At early stages, several components may live in one deployable application if that reduces complexity. Their **boundaries must still be explicit in code** so they can be separated later if scale or operational requirements justify it.

Do not create microservices merely for appearance.

---

# 4. Proposed Repository Structure

Target structure:

```text
TradeShark/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── security.yml
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── lib/
│   │   └── tests/
│   │
│   └── api/
│       ├── src/
│       └── tests/
│
├── services/
│   ├── trading-engine/
│   ├── market-engine/
│   └── ai-supervisor/
│
├── packages/
│   ├── database/
│   ├── ledger/
│   ├── shared/
│   ├── types/
│   ├── validation/
│   └── config/
│
├── docs/
│   ├── architecture/
│   ├── product/
│   ├── security/
│   ├── operations/
│   ├── seo/
│   └── research/
│
├── tests/
│   ├── integration/
│   ├── e2e/
│   ├── security/
│   └── load/
│
├── infra/
│   ├── docker/
│   ├── database/
│   ├── monitoring/
│   └── deployment/
│
├── scripts/
├── .env.example
├── .gitignore
├── README.md
├── FOUNDATION.md
└── LICENSE
```

The exact framework choices can be finalized in the implementation phase. The architectural boundaries should remain.

---

# 5. Environment Model

TradeShark must distinguish environments from the beginning.

## 5.1 Local / Development

Purpose:

- active coding;
- rapid iteration;
- test data;
- local services;
- debugging.

Rules:

- never use production secrets;
- never connect accidentally to production financial data;
- seed data must be clearly synthetic;
- destructive scripts must require an explicit development environment check.

## 5.2 Staging

Purpose:

- production-like integration testing;
- release candidate testing;
- security testing;
- load/performance validation;
- migration rehearsal.

Staging must use isolated credentials, databases, queues, wallets, and external integrations.

## 5.3 Production

Purpose:

- real users and approved production services.

Production changes require controlled deployment, monitoring, rollback planning, and appropriate approval.

---

# 6. Identity, Authentication & Authorization

Authentication and authorization are separate concerns.

## 6.1 Identity

The system must have a canonical user/account identity.

Minimum concepts should eventually include:

- user;
- account/profile;
- authentication identity/provider;
- session/device;
- roles;
- permissions;
- account status;
- risk/security state.

## 6.2 Authorization

Never rely solely on frontend visibility for authorization.

Every protected API operation must independently verify:

1. authenticated identity;
2. account status;
3. permission/role;
4. resource ownership or access scope;
5. operation-specific constraints.

## 6.3 Security requirements

Future implementation must address:

- secure password handling if passwords are used;
- MFA support;
- session expiration and revocation;
- device/session visibility;
- rate limiting;
- brute-force protection;
- CSRF protection where applicable;
- secure cookies;
- input validation;
- output encoding;
- authorization checks;
- security headers;
- dependency security;
- secret management;
- suspicious activity detection.

---

# 7. Financial Architecture

Financial state is a first-class subsystem and must not be implemented as a simple mutable `balance` field with no accounting history.

## 7.1 Double-entry ledger

The target accounting model is double-entry bookkeeping.

Every financial transaction must balance:

```text
Total Debits = Total Credits
```

A transaction should have a unique identifier and one or more ledger entries.

Conceptual model:

```text
LedgerTransaction
├── id
├── type
├── reference
├── status
├── created_at
├── metadata
└── entries[]
    ├── account_id
    ├── asset
    ├── direction
    └── amount
```

The actual schema will be designed during the database phase.

## 7.2 Immutable accounting history

Past ledger entries should never be silently overwritten.

Corrections should be represented through compensating/reversal transactions.

## 7.3 Balance views

A user-facing balance is a derived view of ledger state and/or controlled balance snapshots. It must never become an independent source of truth that can diverge silently from accounting records.

## 7.4 Currency

Initial product assumptions discussed for TradeShark:

- supported display/account currency: IDR and USD;
- minimum deposit: USD 2.50 equivalent/denominated according to the finalized deposit policy;
- minimum withdrawal: USD 10 equivalent/denominated according to the finalized withdrawal policy;
- transaction fee assumption: 0.55%.

These values are **product requirements under discussion**, not final legal, banking, payment-provider, or regulatory specifications. Before production, supported currencies, settlement rules, fees, disclosures, tax treatment, and applicable regulatory obligations must be validated for the jurisdictions in which TradeShark operates.

## 7.5 Money representation

Do not use binary floating-point arithmetic for authoritative financial amounts.

Use a deterministic representation such as:

- integer minor units where appropriate; or
- fixed-precision decimal/database numeric types with explicit scale.

Rounding rules must be explicit, tested, and version-controlled.

---

# 8. Wallet & Transaction Lifecycle

A transaction must have explicit states.

Example:

```text
CREATED
   ↓
PENDING
   ↓
PROCESSING
   ├──→ COMPLETED
   ├──→ FAILED
   └──→ CANCELLED
```

The exact states will differ by transaction type.

Every state transition should have:

- actor/source;
- timestamp;
- reason or event type;
- unique event/transaction ID;
- relevant metadata;
- idempotency protection.

## 8.1 Idempotency

Any operation that can create a financial side effect must support idempotent processing.

Retrying the same request must not accidentally duplicate funds movement.

## 8.2 Reconciliation

A reconciliation process must eventually compare internal accounting state against external payment/settlement records where external providers are used.

Discrepancies must become explicit incidents rather than being silently patched.

---

# 9. Trading Modes

TradeShark's initial concept includes five trading modes:

1. **Slow**
2. **Fast**
3. **Flash**
4. **Crack**
5. **Mayhem**

These names are product concepts and must eventually receive formal specifications.

Each mode needs a documented contract covering:

- duration;
- market/price behavior;
- entry conditions;
- exit/settlement conditions;
- payout/return calculation;
- fee treatment;
- maximum exposure;
- user limits;
- engine limits;
- failure behavior;
- cancellation behavior;
- audit events;
- UI states;
- abuse/risk controls.

## 9.1 Mayhem initial product assumption

Each account is initially planned to receive **one free Mayhem use for one minute**.

This must be implemented as an explicit entitlement, not as a frontend-only counter.

The entitlement needs:

- account ID;
- entitlement type;
- grant reason;
- granted timestamp;
- consumption timestamp;
- status;
- immutable usage reference.

A race-condition-safe database constraint or transactional operation must prevent two simultaneous requests from consuming the same one-time entitlement.

---

# 10. Engine-Generated Activity vs User Activity

This is a critical architectural requirement.

TradeShark must never falsely attribute engine-generated activity to users.

## 10.1 Activity origin

Every relevant market/trading event must include an explicit origin/source classification, for example:

```text
USER
SYSTEM
ENGINE
SIMULATION
ADMIN
MIGRATION
TEST
```

The exact enum will be finalized later.

## 10.2 Volume separation

Metrics should distinguish at minimum:

```text
user_trading_volume
engine_generated_volume
system_volume
simulation_volume
```

Business dashboards must never combine these silently.

## 10.3 Auditability

An auditor/operator should be able to answer:

- Who initiated this event?
- Was it user-generated or system-generated?
- Which service produced it?
- Which rule/version produced it?
- When did it happen?
- Which ledger transaction did it affect?
- What was the previous state?
- What was the resulting state?

---

# 11. Trading Engine

The trading engine is responsible for deterministic business logic around trading actions and settlement.

It should not directly manipulate arbitrary database rows without passing through controlled domain operations.

## 11.1 Engine requirements

The engine should be designed for:

- deterministic calculations;
- explicit state transitions;
- concurrency control;
- idempotency;
- transaction boundaries;
- event generation;
- replay/debugging where feasible;
- controlled configuration;
- versioned business rules.

## 11.2 No hidden randomness

If a mode uses randomness or probabilistic behavior, the mechanism, seed/source, distribution, limits, and audit requirements must be documented.

Never make a financial outcome depend on undocumented or untestable randomness.

---

# 12. Market Engine

The market engine manages market state, price feeds, simulated market behavior, or other market-data processing depending on the finalized product design.

It must be clearly separated from the accounting system.

Market price data should never be allowed to silently rewrite financial ledger history.

## 12.1 Market data provenance

Where external market data is used, retain enough metadata to identify:

- provider/source;
- instrument/pair;
- timestamp;
- sequence where available;
- source event ID where available;
- transformation/version;
- ingestion status.

## 12.2 Stale data

The UI and trading logic must detect stale market data.

A stale feed must not be presented as live data.

---

# 13. Event-Driven Design

Important domain events should be represented explicitly.

Examples:

```text
UserCreated
SessionCreated
DepositRequested
DepositConfirmed
WithdrawalRequested
WithdrawalCompleted
OrderCreated
OrderAccepted
OrderRejected
TradeExecuted
PositionOpened
PositionClosed
FeeCharged
EntitlementGranted
EntitlementConsumed
MarketTickReceived
RiskLimitTriggered
SecurityIncidentDetected
```

Events must not be treated as permission to bypass transactional integrity.

For critical operations, database transaction boundaries and event publication must be designed to avoid lost or duplicated events.

---

# 14. API Principles

The API is the controlled boundary between clients and domain services.

## Requirements

- strict request validation;
- typed responses;
- consistent error structure;
- authentication middleware;
- authorization middleware;
- rate limiting;
- idempotency for side-effecting operations;
- request correlation IDs;
- API versioning strategy;
- pagination for collections;
- safe filtering/sorting;
- no leakage of internal secrets or implementation details.

## Error model

Errors should provide users/developers with enough information to act without exposing sensitive internals.

Conceptual format:

```json
{
  "error": {
    "code": "TRADE_LIMIT_EXCEEDED",
    "message": "The trading limit for this operation has been reached.",
    "request_id": "..."
  }
}
```

Internal logs may contain more diagnostic context than public API responses.

---

# 15. Database Principles

PostgreSQL is the initial target relational database unless implementation research identifies a strong reason to change it.

## Requirements

- migrations must be version-controlled;
- foreign-key relationships must be explicit;
- important uniqueness constraints belong in the database;
- financial invariants should be enforced as close to the database as practical;
- timestamps should be stored consistently;
- soft deletion must be deliberate rather than universal;
- indexes must be justified by query patterns;
- sensitive fields require appropriate protection;
- destructive migrations require special review.

## Transaction boundaries

Operations involving multiple related financial records must use appropriate database transactions and isolation/concurrency controls.

---

# 16. Redis / Queues / Background Jobs

Redis or another appropriate queue/cache technology may be used for:

- caching;
- rate limits;
- ephemeral state;
- job queues;
- realtime fan-out;
- distributed coordination where appropriate.

Redis must not silently become the authoritative financial ledger.

Jobs must support:

- retries;
- backoff;
- idempotency;
- dead-letter/error handling;
- observability;
- safe shutdown;
- replay/recovery where appropriate.

---

# 17. Realtime Architecture

Trading interfaces require low-latency updates, but realtime delivery must not compromise authoritative state.

Potential transport:

- WebSocket;
- Server-Sent Events where appropriate;
- polling fallback for selected use cases.

Realtime messages should include enough information for the client to detect:

- stale messages;
- sequence gaps;
- reconnects;
- duplicated events;
- state resets.

The frontend must be able to recover authoritative state after reconnecting.

---

# 18. Frontend / UX Architecture

TradeShark should eventually provide a distinctive futuristic interface inspired by advanced spatial/holographic interfaces while retaining professional trading usability.

## 18.1 Design target

```text
Futuristic + Fast + Clean + Intelligent + Usable
```

## 18.2 Two interface layers

### Normal Mode

- clean;
- professional;
- highly readable;
- low distraction;
- optimized for frequent trading actions.

### Future Mode

May include:

- spatial/floating panels;
- holographic visual language;
- advanced overlays;
- richer market visualization;
- AI visualization;
- command interface;
- dynamic workspace layouts;
- deeper realtime effects.

Future Mode must never make critical actions ambiguous.

## 18.3 UI reference direction

Existing user-provided visual references establish a baseline direction including:

- dark trading environment;
- chart/candlestick visualization;
- token/pair information;
- transaction/position information;
- prominent trading actions;
- mobile navigation;
- settings/navigation tabs;
- black + turquoise/neon-inspired visual language.

These references are **UX inspiration only**. TradeShark must develop its own visual system and interaction patterns.

## 18.4 Performance

Visual effects must degrade gracefully.

Never ship animation that materially damages:

- input latency;
- chart responsiveness;
- mobile performance;
- battery usage;
- accessibility;
- page load performance.

---

# 19. Accessibility

Accessibility is part of product quality, not an optional later task.

The frontend should target recognized accessibility best practices, including:

- keyboard navigation;
- visible focus states;
- semantic HTML;
- sufficient contrast;
- reduced-motion support;
- screen-reader-compatible labels;
- clear error messages;
- touch-friendly controls;
- non-color-only status indicators.

---

# 20. AI Supervisor

AI is a core strategic capability, but it must operate inside explicit boundaries.

## 20.1 Intended responsibilities

The AI Supervisor may eventually help with:

- monitoring system health;
- detecting anomalies;
- summarizing logs;
- suggesting fixes;
- analyzing product analytics;
- identifying SEO opportunities;
- monitoring documentation drift;
- proposing upgrades;
- assisting support workflows;
- generating research summaries;
- identifying potential security issues for human review;
- helping operators understand incidents.

## 20.2 High-risk restrictions

AI must not independently execute unrestricted high-impact actions involving:

- movement of user funds;
- withdrawal approval;
- changing financial accounting records;
- changing critical security controls;
- granting privileged access;
- deleting audit history;
- deploying unreviewed production code;
- changing risk limits without authorization.

The system should use an approval model for high-risk actions.

Conceptually:

```text
AI observes
    ↓
AI analyzes
    ↓
AI proposes action
    ↓
Policy / risk gate
    ↓
Human approval when required
    ↓
Controlled execution
    ↓
Audit event
```

## 20.3 AI auditability

AI-originated actions/recommendations should record:

- model/agent identity;
- prompt/task class where appropriate;
- input references;
- proposed action;
- policy decision;
- human approval if applicable;
- execution result;
- timestamp;
- correlation ID.

---

# 21. Security Architecture

Security must be treated as a continuous engineering discipline.

## 21.1 Threat model categories

The project should explicitly consider:

- account takeover;
- credential stuffing;
- session theft;
- authorization bypass;
- injection attacks;
- XSS;
- CSRF where applicable;
- SSRF;
- insecure file handling;
- dependency vulnerabilities;
- API abuse;
- bot abuse;
- fraud;
- replay attacks;
- race conditions;
- double-spending-like accounting failures;
- privilege escalation;
- insider misuse;
- data leakage;
- supply-chain compromise;
- malicious automation/agent behavior.

## 21.2 Secrets

Never commit:

- passwords;
- API keys;
- database credentials;
- payment secrets;
- private keys;
- seed phrases;
- session tokens;
- production certificates/private material.

`.env.example` may contain variable names and safe placeholders only.

## 21.3 Dependency security

Future CI should include dependency and vulnerability checks appropriate to the selected stack.

---

# 22. Fraud, Abuse & Risk Controls

A public trading platform must assume that some users, bots, or external actors will attempt to exploit edge cases.

Controls should eventually cover:

- rate limits;
- velocity limits;
- duplicate-request detection;
- suspicious transaction patterns;
- account/device risk signals;
- promotional abuse;
- one-time entitlement abuse;
- multi-account abuse where relevant;
- market manipulation risks where relevant to the product;
- operational kill switches.

Risk systems must be explainable enough for operators to investigate why a control triggered.

---

# 23. Observability

Every production service should eventually have:

## Logs

Structured logs with:

- timestamp;
- severity;
- service;
- environment;
- request/correlation ID;
- event name;
- safe contextual metadata.

Never log secrets or unnecessary sensitive data.

## Metrics

Potential metrics include:

- API latency;
- error rate;
- request throughput;
- websocket connections;
- queue depth;
- job failures;
- market feed latency;
- trade processing latency;
- ledger transaction failures;
- reconciliation discrepancies;
- database performance;
- authentication failures.

## Tracing

Distributed tracing should be introduced where multiple services/workers make request diagnosis difficult.

---

# 24. Analytics

Product analytics should answer questions such as:

- Where do users enter the product?
- Which features are used?
- Where do users abandon a flow?
- Which trading screens have performance issues?
- Which errors affect real users?
- Which onboarding steps cause friction?

Analytics data must be separated conceptually from authoritative financial records.

A product analytics event is **not** a financial ledger event.

---

# 25. SEO & Knowledge Architecture

SEO must be designed into the information architecture rather than added after the application is finished.

## 25.1 Long-term objective

Build durable topical authority around relevant trading/market concepts through:

- technically strong pages;
- useful original content;
- structured information architecture;
- strong internal linking;
- entity/topic coverage;
- high-quality metadata;
- fast rendering;
- indexable public content;
- trustworthy documentation;
- continuous content improvement.

## 25.2 Research pipeline

A conceptual research pipeline is:

```text
External Research
      ↓
Observed Facts
      ↓
Learned Insights
      ↓
TradeShark Original
      ↓
Product / Documentation / Content
      ↓
Internal Linking Graph
      ↓
Measurement
      ↓
Iteration
```

## 25.3 Research data categories

Competitor/platform research should distinguish:

### Observed Facts

What a public source actually shows.

### Learned Insights

Patterns inferred from multiple observations.

### TradeShark Original

Our own implementation, hypothesis, design, or innovation.

This prevents research notes from being mistaken for proprietary facts or copied implementation requirements.

## 25.4 SEO data areas

Where appropriate, research may cover:

- keywords;
- search intent;
- SERP patterns;
- topic clusters;
- entities;
- internal linking;
- technical SEO;
- content gaps;
- public backlink patterns;
- structured data;
- page performance;
- public social signals.

Do not collect private credentials, private account data, session tokens, or restricted information as part of research.

---

# 26. Data & Research Intelligence

TradeShark may eventually maintain a research/knowledge system covering:

- trading platforms;
- Web3 platforms;
- UX/UI patterns;
- public technical documentation;
- public APIs and WebSockets;
- public security documentation;
- scalability patterns;
- SEO structures;
- content ecosystems;
- public community/social signals.

The objective is to learn patterns and identify opportunities—not to clone another product.

## Data provenance

Research records should eventually capture:

- source;
- collection date;
- scope;
- observation;
- interpretation;
- confidence;
- relevant category;
- whether information is public;
- whether reuse is permitted;
- reviewer/agent where applicable.

---

# 27. Browser / External Data Collection

Browser-based research may eventually be supported through approved tooling.

However, TradeShark research automation must follow strict boundaries:

- public information only unless the user explicitly authorizes access to their own account/data;
- no credential harvesting;
- no private-key or seed-phrase collection;
- no session-token extraction;
- no bypassing access controls;
- no evasion of security mechanisms;
- respect applicable website terms and technical restrictions;
- minimize collection and storage.

---

# 28. Testing Strategy

Testing must be layered.

## Unit tests

Test pure business rules and calculations.

Examples:

- fee calculation;
- rounding;
- entitlement consumption;
- trading-mode calculations;
- state transitions;
- ledger balancing.

## Integration tests

Test interactions among:

- API + database;
- ledger + database;
- workers + queue;
- market engine + trading engine;
- authentication + authorization.

## End-to-end tests

Test complete user journeys:

```text
Register/Login
   ↓
Account setup
   ↓
Deposit
   ↓
Select market/mode
   ↓
Trade
   ↓
Settlement
   ↓
Balance/history
```

## Security tests

Include appropriate automated checks for common web/API vulnerabilities and authorization boundaries.

## Load tests

Before production, test realistic workloads including concurrent users, websocket traffic, order/trade throughput, database load, and background jobs.

---

# 29. CI/CD

Every meaningful change should pass automated checks before being merged into the production path.

Initial CI goals:

1. install dependencies;
2. validate formatting;
3. lint;
4. type-check;
5. run unit tests;
6. run integration tests where practical;
7. build applications;
8. security/dependency checks;
9. produce useful artifacts/logs.

Production deployment should be separated from ordinary development commits.

---

# 30. Database Migrations & Releases

Every schema change must have a migration.

Migration requirements:

- deterministic;
- reviewable;
- reversible where realistically possible;
- safe for existing data;
- tested in staging;
- monitored in production.

For large tables, migrations must account for locking, downtime, and backfill strategy.

---

# 31. Backup & Disaster Recovery

Before production, TradeShark must define:

- database backup frequency;
- retention policy;
- encrypted backup storage;
- restoration procedure;
- restore testing schedule;
- recovery point objective (RPO);
- recovery time objective (RTO);
- critical service dependency map.

A backup that has never been restored successfully should not be treated as proven disaster recovery.

---

# 32. Incident Response

Production must have an operational incident process.

At minimum:

```text
Detect
  ↓
Triage
  ↓
Contain
  ↓
Investigate
  ↓
Recover
  ↓
Verify
  ↓
Document
  ↓
Prevent recurrence
```

Critical incidents should produce a post-incident record describing:

- impact;
- timeline;
- root cause or contributing causes;
- mitigation;
- permanent corrective actions;
- monitoring improvements.

---

# 33. Kill Switches & Safe Degradation

The system should eventually support controlled operational switches such as:

- pause new trading;
- pause withdrawals;
- disable a specific trading mode;
- disable a promotional entitlement;
- disable an external integration;
- place the market engine into maintenance mode;
- restrict risky operations while preserving read-only access.

Kill switches must be:

- access-controlled;
- audited;
- observable;
- documented;
- tested before production dependence.

---

# 34. Configuration Management

Business configuration should not be scattered across source code.

Examples:

- fees;
- minimum amounts;
- mode durations;
- limits;
- entitlement rules;
- feature flags;
- maintenance states.

Configuration changes must have:

- version/history where appropriate;
- auditability;
- validation;
- authorization;
- safe defaults.

---

# 35. Feature Flags

Feature flags may be used for controlled rollout.

Flags should have:

- owner;
- purpose;
- creation date;
- expected removal date where temporary;
- safe default;
- rollout strategy.

Permanent flags should be reviewed periodically to prevent configuration debt.

---

# 36. Documentation Standards

Important behavior must be documented near the implementation and in appropriate `/docs` sections.

Documentation should explain:

- what the system does;
- why it exists;
- invariants;
- failure modes;
- security implications;
- operational procedures;
- examples.

Do not document only the happy path.

---

# 37. Coding Standards

General requirements:

- small focused modules;
- explicit types;
- descriptive names;
- no unexplained magic numbers;
- validation at boundaries;
- domain logic isolated from transport/UI;
- errors handled deliberately;
- comments explain why, not merely what;
- avoid premature abstraction;
- avoid hidden global state.

Financial calculations should have especially clear tests and documentation.

---

# 38. Dependency Policy

Before introducing a dependency, consider:

- maintenance activity;
- security history;
- license;
- bundle/runtime cost;
- transitive dependencies;
- community/adoption;
- whether the dependency is genuinely necessary.

Do not add packages merely because they are fashionable.

---

# 39. Legal & Regulatory Gate

TradeShark's eventual production model may involve financial activities and potentially digital assets. Therefore, technical implementation cannot by itself establish legal authorization.

Before launch in any jurisdiction, the project must obtain appropriate professional review covering, as applicable:

- financial regulations;
- money transmission/payment obligations;
- digital-asset rules;
- KYC/AML requirements;
- consumer protection;
- privacy/data protection;
- tax considerations;
- marketing/advertising restrictions;
- age restrictions;
- geographic availability;
- terms of service;
- risk disclosures.

This is a **production gate**, not something to postpone indefinitely after launch.

---

# 40. Product Integrity

TradeShark must not fabricate:

- trading volume;
- user activity;
- market demand;
- performance results;
- testimonials;
- liquidity;
- transaction history;
- social proof.

If system-generated activity exists for simulation, testing, market-making, or another legitimate product function, it must be explicitly classified and distinguishable from genuine user activity.

---

# 41. Security and Privacy of Research Data

Research systems must maintain separation between:

- public observations;
- user-provided private data;
- internal product data;
- operational secrets.

Do not place sensitive operational data into public research documents.

---

# 42. Frontend State Integrity

The frontend is never the financial source of truth.

For example:

```text
User clicks Trade
       ↓
Frontend validates UX constraints
       ↓
API validates authorization + business rules
       ↓
Domain service validates state
       ↓
Database transaction / engine operation
       ↓
Ledger/event creation
       ↓
Authoritative response/event
       ↓
Frontend updates display
```

Never allow the browser to decide that a trade succeeded merely because a button was clicked.

---

# 43. Realtime UX Safety

Trading UI must clearly communicate:

- connection status;
- market-data freshness;
- order/trade state;
- pending state;
- successful settlement;
- failure;
- rejected action;
- maintenance state.

The UI must not show stale success states after a reconnect or failed request.

---

# 44. Mobile-First Considerations

The user-provided reference recordings show a mobile-oriented trading/navigation experience. TradeShark should therefore treat mobile as a first-class environment rather than a compressed desktop layout.

Mobile requirements should eventually cover:

- thumb-friendly controls;
- safe spacing around destructive/financial actions;
- chart interaction;
- responsive tables;
- bottom navigation where useful;
- accessible modal behavior;
- connection recovery;
- low-bandwidth behavior;
- performance on mid-range devices.

---

# 45. Design System

Before building many screens, TradeShark should establish reusable design tokens/components for:

- typography;
- spacing;
- colors;
- borders;
- radii;
- shadows/glows;
- elevation;
- motion;
- icons;
- buttons;
- inputs;
- cards/panels;
- tables;
- charts;
- alerts;
- modals;
- navigation;
- loading states;
- empty states;
- error states.

The futuristic identity should come from a coherent system rather than random effects.

---

# 46. SEO-Friendly Application Architecture

Public content must be designed so search engines can discover and understand it without requiring authenticated application state.

Potential public areas:

```text
/
/markets
/assets
/learn
/guides
/glossary
/docs
/news or research where appropriate
```

Private trading screens should remain protected and should not expose sensitive user information to search engines.

SEO implementation should eventually cover:

- canonical URLs;
- metadata;
- sitemap strategy;
- robots rules;
- structured data where appropriate;
- internal links;
- pagination strategy;
- indexation controls;
- page speed;
- accessibility;
- content freshness;
- duplicate-content prevention.

---

# 47. AI + SEO + Product Feedback Loop

A long-term TradeShark intelligence loop may look like:

```text
Product Usage ─────┐
                   │
Search Data ───────┤
                   ▼
             Knowledge Layer
                   │
Research ──────────┤
                   ▼
              AI Analysis
                   │
          ┌────────┴────────┐
          ▼                 ▼
      Product           Content
      Improvements      Improvements
          │                 │
          └────────┬────────┘
                   ▼
                Measure
                   │
                   └──────→ Iterate
```

Automation must remain governed by permissions, quality checks, and human approval where appropriate.

---

# 48. Competitive Research Rules

TradeShark may study public competitors and adjacent products for:

- UX patterns;
- onboarding patterns;
- pricing structures;
- public feature sets;
- information architecture;
- performance characteristics;
- documentation;
- public APIs;
- SEO structures;
- public community behavior.

Research output must answer:

1. What did we observe?
2. What pattern may this indicate?
3. What problem does the pattern solve?
4. What are its weaknesses?
5. What could TradeShark do differently?
6. Is the proposed implementation original and legally appropriate?

---

# 49. Definition of Done

A feature is not “done” simply because it renders.

A meaningful production feature should have, as applicable:

- product specification;
- domain rules;
- validation;
- authorization;
- error handling;
- database integrity;
- idempotency;
- audit events;
- tests;
- observability;
- documentation;
- accessibility;
- responsive behavior;
- security review;
- performance consideration;
- rollback/disable strategy;
- staging verification.

---

# 50. Development Roadmap

## Phase 0 — Foundation

Current phase.

Deliverables:

- `FOUNDATION.md`;
- repository structure;
- README;
- contribution/development rules;
- environment model;
- initial CI plan.

## Phase 1 — Database + Ledger

Deliverables:

- database schema;
- migrations;
- users/accounts;
- wallets;
- ledger accounts;
- ledger transactions;
- ledger entries;
- transaction history;
- audit model;
- seed/test data.

## Phase 2 — Backend/API

Deliverables:

- authentication;
- authorization;
- API contracts;
- validation;
- idempotency;
- rate limiting;
- error model;
- observability.

## Phase 3 — Market + Trading Engine

Deliverables:

- market data model;
- trading modes;
- deterministic calculations;
- state machines;
- settlement;
- event architecture;
- engine/user activity separation.

## Phase 4 — Wallet & Account

Deliverables:

- deposits;
- withdrawals;
- balances;
- transaction history;
- fee handling;
- reconciliation;
- risk controls.

## Phase 5 — Futuristic Frontend

Deliverables:

- design system;
- dashboard;
- markets;
- trading screen;
- wallet;
- profile/settings;
- responsive mobile experience;
- Normal Mode;
- Future Mode foundation.

## Phase 6 — AI Supervisor

Deliverables:

- monitoring agents;
- anomaly analysis;
- operational assistant;
- controlled actions;
- approval gates;
- AI audit trail.

## Phase 7 — SEO + Knowledge Engine

Deliverables:

- public information architecture;
- content model;
- knowledge graph/topic model;
- technical SEO;
- internal linking;
- research pipeline;
- analytics feedback loop.

## Phase 8 — Security + Testing Hardening

Deliverables:

- threat-model review;
- security tests;
- load tests;
- abuse tests;
- dependency audit;
- backup/restore test;
- incident procedures.

## Phase 9 — Staging

Deliverables:

- production-like infrastructure;
- release candidate;
- migration rehearsal;
- observability;
- external integration testing;
- operational runbooks.

## Phase 10 — Production Gate

Production is allowed only after the relevant technical, security, operational, legal, financial-accounting, and product requirements have been reviewed.

---

# 51. Mandatory Mid-Project Gates

The project owner explicitly wants important requirements to be surfaced again during development rather than forgotten after the initial planning stage.

Therefore, before major transitions, the team/assistant must stop and check the following.

## Gate A — Before real financial integration

Mandatory review:

- ledger integrity;
- idempotency;
- reconciliation;
- authorization;
- withdrawal controls;
- fraud controls;
- auditability;
- backup/restore;
- legal/regulatory review.

## Gate B — Before public beta

Mandatory review:

- security testing;
- rate limiting;
- abuse controls;
- performance;
- error handling;
- monitoring;
- privacy;
- terms/disclosures;
- mobile UX;
- accessibility.

## Gate C — Before production

Mandatory review:

- production secrets;
- infrastructure isolation;
- database backup;
- disaster recovery;
- incident response;
- kill switches;
- observability;
- deployment rollback;
- accounting reconciliation;
- compliance/legal sign-off as applicable.

## Gate D — Before autonomous AI operations

Mandatory review:

- permissions;
- tool boundaries;
- approval gates;
- audit logs;
- rollback;
- failure containment;
- prompt/input trust boundaries;
- data access minimization.

> **Rule:** If a mandatory gate fails, development pauses on the dependent feature until the issue is resolved or formally accepted by the responsible human decision-maker.

---

# 52. Current Product Assumptions Register

These are assumptions, not immutable truths.

| Area | Current assumption | Status |
|---|---|---|
| Product name | TradeShark | Working name / active project |
| Primary platform | Web | Initial target |
| Visual direction | Futuristic / year-3700-inspired | Design direction |
| Trading modes | Slow, Fast, Flash, Crack, Mayhem | Product concept |
| Currency | IDR / USD | Requires detailed financial specification |
| Minimum deposit | $2.50 | Product assumption; requires validation |
| Minimum withdrawal | $10 | Product assumption; requires validation |
| Fee | 0.55% | Product assumption; requires detailed fee rules |
| Mayhem free entitlement | 1 per account, 1 minute | Product assumption |
| Free coin creation | 1 per account | Product assumption; requires legal/technical specification |
| Ledger | Double-entry | Architectural requirement |
| Engine/user volume separation | Required | Architectural requirement |
| AI Supervisor | Planned | Controlled/permissioned |
| SEO knowledge engine | Planned | Long-term architecture |

---

# 53. Open Questions Before Implementation

The following must be formally answered before their dependent systems are finalized:

1. What exactly constitutes a “trade” in each mode?
2. Are outcomes simulated, market-derived, peer-matched, or another model?
3. What assets/instruments are supported at launch?
4. How are prices sourced and validated?
5. What exactly does the 0.55% fee apply to?
6. How are IDR and USD balances represented and converted?
7. Which payment/settlement providers will be used?
8. What jurisdictions will be supported?
9. What account verification/KYC model is required?
10. What is the precise free-coin-creation mechanism?
11. What happens when an account is closed or restricted?
12. What are the maximum trading/withdrawal limits?
13. What risk controls are mandatory for each mode?
14. What user-facing disclosures are required?
15. What exact AI actions are permitted without approval?
16. What external data sources are authoritative for each market?
17. What uptime/latency targets are required?
18. What are the RPO/RTO targets?
19. What is the launch geography?
20. What is the exact monetization model beyond the current fee assumption?

These questions should be resolved through explicit product decisions and appropriate professional review, not hidden inside implementation details.

---

# 54. Immediate Next Steps

The repository is currently intentionally lightweight. The next implementation sequence is:

### Step 1 — Foundation

- keep this document version-controlled;
- review assumptions;
- identify contradictions;
- record decisions rather than relying on chat history.

### Step 2 — Repository skeleton

Create the agreed directories and baseline project files without prematurely implementing business logic.

### Step 3 — Technology Decision Record

Create a technical decision document covering the initial frontend, backend, database, cache/queue, testing, deployment, observability, and package-management choices.

### Step 4 — Database specification

Define the first schema before building financial endpoints.

### Step 5 — Ledger specification

Define accounting invariants, transaction types, entry rules, rounding, reversal behavior, and reconciliation.

### Step 6 — API/domain contracts

Define the stable boundaries between frontend and backend and between backend domains.

### Step 7 — Trading engine specification

Turn every trading mode into a testable state machine and calculation specification.

### Step 8 — Implement incrementally

Only after the above are coherent should the project begin substantial feature implementation.

---

# 55. Final Engineering Rule

TradeShark is allowed to become ambitious.

It is **not** allowed to become careless.

When choosing between:

- a quick hack and a traceable implementation;
- flashy UI and reliable interaction;
- hidden automation and controlled automation;
- mutable financial state and auditable accounting;
- copied patterns and original design;
- premature complexity and deliberate architecture;

choose the approach that preserves correctness, security, user trust, and the ability to evolve.

**Build the foundation so well that the futuristic interface becomes the visible layer of a system that is already serious underneath.**

---

**Document owner:** TradeShark project owner  
**Review cadence:** Update whenever a foundational architectural/product decision changes  
**Next document:** `docs/architecture/TECH_STACK.md`
