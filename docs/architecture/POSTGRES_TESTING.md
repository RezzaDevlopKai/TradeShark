# PostgreSQL Testing

TradeShark uses PostgreSQL as the source of truth for financial state. Local development and future integration tests must run against a real PostgreSQL instance rather than an in-memory substitute.

## Local database

Start the reproducible PostgreSQL service:

```bash
docker compose -f infra/docker-compose.postgres.yml up -d
```

The default connection string is:

```text
postgresql://tradeshark:tradeshark@localhost:5432/tradeshark
```

Set `DATABASE_URL` explicitly when using another host or database.

## Testing policy

Database integration tests should verify the behavior that cannot be proven by pure unit tests, including:

- double-entry persistence and rollback;
- customer balance projection updates;
- insufficient-balance atomicity;
- idempotent retries returning the original journal transaction;
- concurrent reuse of the same idempotency key;
- deposit confirmation and credit settlement;
- withdrawal locking, submission, confirmation, and failure release;
- lifecycle state changes occurring in the same transaction as their journal movement.

Do not describe the financial subsystem as production-ready until these tests run against a reproducible PostgreSQL schema in CI.

## CI gate

The existing unit-test workflow remains separate from database integration tests. A dedicated integration workflow should provision PostgreSQL, apply the complete migration history, run the database suite, and tear the database down after the job.
