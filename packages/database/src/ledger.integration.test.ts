import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./client.js";
import { postJournal } from "./ledger.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

integration("PostgreSQL ledger integration", () => {
  afterAll(async () => {
    await client?.pool.end();
  });

  it("posts, retries, and rejects an idempotency hash mismatch", async () => {
    if (!client) throw new Error("DATABASE_URL is required");

    const userId = randomUUID();
    const assetId = randomUUID();
    const debitAccountId = randomUUID();
    const creditAccountId = randomUUID();
    const transactionId = randomUUID();
    const idempotencyKey = `integration:${randomUUID()}`;
    const referenceId = randomUUID();

    try {
      await client.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [
        userId,
        `${userId}@integration.test`,
        `integration_${userId.replaceAll("-", "")}`
      ]);
      await client.pool.query(
        `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, 'TST', 'Integration Test Asset', 18, true)`,
        [assetId]
      );
      await client.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES ($1, $2, $3, 'TREASURY', $4), ($5, $2, $3, 'EXTERNAL_SETTLEMENT', $6)`,
        [debitAccountId, userId, assetId, `integration-treasury:${debitAccountId}`, creditAccountId, `integration-external:${creditAccountId}`]
      );

      const first = await postJournal(client.db, {
        transactionId,
        idempotencyKey,
        referenceType: "integration_test",
        referenceId,
        metadata: { beta: 2, alpha: 1 },
        entries: [
          { accountId: debitAccountId, direction: "debit", amount: "10.25" },
          { accountId: creditAccountId, direction: "credit", amount: "10.25" }
        ]
      });

      expect(first).toEqual({ transactionId, idempotent: false });

      const retry = await postJournal(client.db, {
        transactionId: randomUUID(),
        idempotencyKey,
        referenceType: "integration_test",
        referenceId,
        metadata: { alpha: 1, beta: 2 },
        entries: [
          { accountId: debitAccountId, direction: "debit", amount: "10.25" },
          { accountId: creditAccountId, direction: "credit", amount: "10.25" }
        ]
      });

      expect(retry).toEqual({ transactionId, idempotent: true });

      await expect(
        postJournal(client.db, {
          transactionId: randomUUID(),
          idempotencyKey,
          referenceType: "integration_test",
          referenceId,
          metadata: { alpha: 1, beta: 999 },
          entries: [
            { accountId: debitAccountId, direction: "debit", amount: "10.25" },
            { accountId: creditAccountId, direction: "credit", amount: "10.25" }
          ]
        })
      ).rejects.toThrow(/Idempotency key was already used/);

      const journalCount = await client.pool.query(
        `SELECT count(*)::int AS count FROM journal_transactions WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      const entryCount = await client.pool.query(
        `SELECT count(*)::int AS count FROM journal_entries WHERE transaction_id = $1`,
        [transactionId]
      );

      expect(journalCount.rows[0].count).toBe(1);
      expect(entryCount.rows[0].count).toBe(2);
    } finally {
      await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id = $1`, [transactionId]);
      await client.pool.query(`DELETE FROM journal_transactions WHERE idempotency_key = $1`, [idempotencyKey]);
      await client.pool.query(`DELETE FROM idempotency_keys WHERE key = $1`, [idempotencyKey]);
      await client.pool.query(`DELETE FROM ledger_accounts WHERE id IN ($1, $2)`, [debitAccountId, creditAccountId]);
      await client.pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);
      await client.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  it("allows concurrent retries to resolve to one journal transaction", async () => {
    if (!client) throw new Error("DATABASE_URL is required");

    const userId = randomUUID();
    const assetId = randomUUID();
    const debitAccountId = randomUUID();
    const creditAccountId = randomUUID();
    const transactionId = randomUUID();
    const idempotencyKey = `integration:concurrent:${randomUUID()}`;

    const input = {
      referenceType: "integration_concurrency_test",
      metadata: { source: "vitest" },
      entries: [
        { accountId: debitAccountId, direction: "debit" as const, amount: "3.50" },
        { accountId: creditAccountId, direction: "credit" as const, amount: "3.50" }
      ]
    };

    try {
      await client.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [
        userId,
        `${userId}@integration.test`,
        `integration_${userId.replaceAll("-", "")}`
      ]);
      await client.pool.query(
        `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`,
        [assetId, `T${assetId.slice(0, 3).toUpperCase()}`, "Concurrency Test Asset"]
      );
      await client.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES ($1, $2, $3, 'TREASURY', $4), ($5, $2, $3, 'EXTERNAL_SETTLEMENT', $6)`,
        [debitAccountId, userId, assetId, `integration-treasury:${debitAccountId}`, creditAccountId, `integration-external:${creditAccountId}`]
      );

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          postJournal(client.db, {
            transactionId,
            idempotencyKey,
            ...input
          })
        )
      );

      expect(results.every((result) => result.transactionId === transactionId)).toBe(true);
      expect(results.filter((result) => !result.idempotent)).toHaveLength(1);
      expect(results.filter((result) => result.idempotent)).toHaveLength(7);

      const count = await client.pool.query(
        `SELECT count(*)::int AS count FROM journal_transactions WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(count.rows[0].count).toBe(1);
    } finally {
      await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id = $1`, [transactionId]);
      await client.pool.query(`DELETE FROM journal_transactions WHERE idempotency_key = $1`, [idempotencyKey]);
      await client.pool.query(`DELETE FROM idempotency_keys WHERE key = $1`, [idempotencyKey]);
      await client.pool.query(`DELETE FROM ledger_accounts WHERE id IN ($1, $2)`, [debitAccountId, creditAccountId]);
      await client.pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);
      await client.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });
});
