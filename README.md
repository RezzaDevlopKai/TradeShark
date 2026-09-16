# TradeShark 🦈

TradeShark is a trading-platform project designed around a fast, professional trading experience with a futuristic interface and a strong engineering foundation.

## Architecture

- **Web:** Next.js + React + TypeScript
- **API:** NestJS + Fastify
- **Database:** PostgreSQL
- **Cache/queues:** Redis + BullMQ
- **Realtime:** WebSocket
- **Accounting:** double-entry ledger
- **Analytics:** PostHog
- **Observability:** OpenTelemetry + structured logging
- **Testing:** Vitest + Playwright + k6
- **Infrastructure:** Docker + GitHub Actions

## Repository layout

```text
apps/       user-facing applications
services/   independent domain services
packages/   shared domain/infrastructure packages
docs/       architecture, product, security and SEO documentation
tests/      cross-application tests
infra/      local/deployment infrastructure
```

## Documentation

Start with:

1. `FOUNDATION.md` — product and engineering constitution
2. `docs/architecture/TECH_STACK.md` — technical stack and architecture rules

## Development status

TradeShark is currently in the foundation/skeleton phase. Financial functionality must not be treated as production-ready until the database, ledger, security, risk, reconciliation, and legal/regulatory gates are completed.
