import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./client.js";
import { postJournal } from "./ledger.js";
import { reconcileLedgerBalance } from "./reconciliation.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

integration("PostgreSQL ledger reconciliation integration", () => {
  afterAll(async () => {
    await client?.pool.end();
  });

  it("matches the exact projection against posted journal balance", async () => {
    if (!client) throw new Error("DATABASE_URL is required");

    const userId = randomUUID();
    const assetId = randomUUID();
    const userAccountId = randomUUID();
    const treasuryAccountId = randomUUID();
    const openingTransactionId = randomUUID();
    const openingKey = `integration:reconciliation:opening:${randomUUID()}`;
    const movementTransactionId = randomUUID();
    const movementKey = `integration:reconciliation:movement:${randomUUID()}`;

    try {
      await client.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [
        userId,
        `${userId}@integration.test`,
        `reconciliation_${userId.replaceAll("-", "")}`
      ]);
      await client.pool.query(
        `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, 'RCT', 'Reconciliation Test Asset', 18, true)`,
        [assetId]
      );
      await client.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES ($1, $2, $3, 'USER_AVAILABLE', $4), ($5, $2, $3, 'TREASURY', $6)`,
        [
          userAccountId,
          userId,
          assetId,
          `integration-reconciliation-user:${userAccountId}`,
          treasuryAccountId,
          `integration-reconciliation-treasury:${treasuryAccountId}`
        ]
      );

      await postJournal(client.db, {
        transactionId: openingTransactionId,
        idempotencyKey: openingKey,
        referenceType: "integration_reconciliation_opening",
        entries: [
          { accountId: treasuryAccountId, direction: "debit", amount: "25.125000000000000001" },
          { accountId: userAccountId, direction: "credit", amount: "25.125000000000000001" }
        ]
      });

      await postJournal(client.db, {
        transactionId: movementTransactionId,
        idempotencyKey: movementKey,
        referenceType: "integration_reconciliation_movement",
        entries: [
          { accountId: userAccountId, direction: "debit", amount: "10.125000000000000001" },
          { accountId: treasuryAccountId, direction: "credit", amount: "10.125000000000000001" }
        ]
      });

      const reconciled = await reconcileLedgerBalance(client.db, userAccountId);
      expect(reconciled).toEqual({
        accountId: userAccountId,
        projectedBalance: "15.000000000000000000",
        ledgerBalance: "15.000000000000000000",
        difference: "0",
        consistent: true
      });

      await client.pool.query(
        `UPDATE ledger_balance_projections SET balance = balance - 0.000000000000000001 WHERE account_id = $1`,
        [userAccountId]
      );

      const corrupted = await reconcileLedgerBalance(client.db, userAccountId);
      expect(corrupted.projectedBalance).toBe("14.999999999999999999");
      expect(corrupted.ledgerBalance).toBe("15.000000000000000000");
      expect(corrupted.difference).toBe("-0.000000000000000001");
      expect(corrupted.consistent).toBe(false);
    } finally {
      await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN ($1, $2)`, [openingTransactionId, movementTransactionId]);
      await client.pool.query(`DELETE FROM journal_transactions WHERE idempotency_key IN ($1, $2)`, [openingKey, movementKey]);
      await client.pool.query(`DELETE FROM idempotency_keys WHERE key IN ($1, $2)`, [openingKey, movementKey]);
      await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = $1`, [userAccountId]);
      await client.pool.query(`DELETE FROM ledger_accounts WHERE id IN ($1, $2)`, [userAccountId, treasuryAccountId]);
      await client.pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);
      await client.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });
});
