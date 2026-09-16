# PostgreSQL Integration Gate

## Purpose

TradeShark's financial paths must be tested against real PostgreSQL behavior before they are treated as integration-safe. Unit tests alone do not validate transaction isolation, row locks, unique constraints, rollback behavior, numeric semantics, or concurrent idempotency.

## Required integration scenarios

The PostgreSQL test gate must cover:

1. Journal posting with balanced double-entry rows.
2. Idempotent retry returning the original journal transaction ID.
3. Idempotency-key hash mismatch rejection.
4. Concurrent requests using the same idempotency key producing one journal transaction.
5. Atomic USER balance projection updates.
6. Insufficient available balance causing the complete transaction to roll back.
7. Deposit external settlement into pending balance.
8. Deposit pending-to-available credit.
9. Withdrawal available-to-locked movement.
10. Withdrawal submission into pending withdrawal.
11. Successful withdrawal external settlement.
12. Withdrawal failure releasing funds to available balance.
13. Repeated settlement calls returning the original journal transaction ID without duplicate entries.

## Environment

Integration tests run against PostgreSQL supplied by CI or a local Docker Compose service. The test database must start empty and be initialized from the repository's schema/migration process rather than from a developer-specific database dump.

Required environment variable:

```text
DATABASE_URL=postgresql://tradeshark:tradeshark@localhost:5432/tradeshark
```

## Gate criteria

A financial integration change is not considered complete until:

- schema initialization succeeds on an empty PostgreSQL database;
- the integration suite passes against PostgreSQL;
- rollback behavior is asserted for failure paths;
- idempotency is tested both sequentially and concurrently;
- journal entries remain balanced;
- user balance projections remain consistent with posted journal activity.

A green TypeScript/unit-test CI job is not a substitute for this gate.

## Production-readiness note

Passing this gate does not by itself establish production readiness. Backup/restore, reconciliation, security, observability, incident controls, fraud/risk controls, and applicable legal/regulatory review remain separate mandatory gates.
