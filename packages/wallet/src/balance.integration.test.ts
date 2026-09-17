import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@tradeshark/database";
import { confirmDepositAtomically, creditDepositAtomically } from "./index.js";
import { getUserBalances } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

integration("PostgreSQL wallet balance read model integration", () => {
  afterAll(async () => {
    await client?.pool.end();
  });

  it("returns the credited deposit through the wallet balance service", async () => {
    if (!client) throw new Error("DATABASE_URL is required");

    const userId = randomUUID();
    const assetId = randomUUID();
    const externalId = randomUUID();
    const pendingId = randomUUID();
    const availableId = randomUUID();
    const depositId = randomUUID();
    const amount = "42.125";

    try {
      await client.pool.query(
        `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`,
        [userId, `${userId}@balance.integration.test`, `balance_${userId.replaceAll("-", "")}`]
      );
      await client.pool.query(
        `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`,
        [assetId, `B${assetId.slice(0, 4).toUpperCase()}`, "Balance Integration Asset"]
      );
      await client.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
          ($1, NULL, $2, 'EXTERNAL_SETTLEMENT', $3),
          ($4, $5, $2, 'USER_PENDING_DEPOSIT', $6),
          ($7, $5, $2, 'USER_AVAILABLE', $8)`,
        [
          externalId,
          assetId,
          `balance-external:${externalId}`,
          pendingId,
          userId,
          `balance-pending:${pendingId}`,
          availableId,
          userId,
          `balance-available:${availableId}`
        ]
      );
      await client.pool.query(
        `INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0)`,
        [pendingId, availableId]
      );
      await client.pool.query(
        `INSERT INTO deposits (id, user_id, asset_id, pending_account_id, amount, status, external_reference)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
        [depositId, userId, assetId, pendingId, amount, `balance-deposit:${depositId}`]
      );

      const before = await getUserBalances(client.db, userId);
      expect(before).toEqual([
        {
          accountId: availableId,
          assetId,
          symbol: expect.any(String),
          name: "Balance Integration Asset",
          decimals: 18,
          balance: "0.000000000000000000"
        }
      ]);

      await confirmDepositAtomically(client.db, depositId);
      await creditDepositAtomically(client.db, depositId);

      const balances = await getUserBalances(client.db, userId);
      expect(balances).toHaveLength(1);
      expect(balances[0]).toMatchObject({
        accountId: availableId,
        assetId,
        name: "Balance Integration Asset",
        decimals: 18,
        balance: "42.125000000000000000"
      });
      expect(balances[0]?.symbol).toBe(`B${assetId.slice(0, 4).toUpperCase()}`);

      const ledger = await client.pool.query(
        `SELECT direction, amount::text FROM journal_entries
         WHERE transaction_id IN (
           SELECT id FROM journal_transactions WHERE reference_id = $1
         )
         ORDER BY sequence`,
        [depositId]
      );
      expect(ledger.rows).toEqual([
        { direction: "debit", amount: "42.125000000000000000" },
        { direction: "credit", amount: "42.125000000000000000" },
        { direction: "debit", amount: "42.125000000000000000" },
        { direction: "credit", amount: "42.125000000000000000" }
      ]);
    } finally {
      await client.pool.query(
        `DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = $1)`,
        [depositId]
      );
      await client.pool.query(`DELETE FROM journal_transactions WHERE reference_id = $1`, [depositId]);
      await client.pool.query(`DELETE FROM deposits WHERE id = $1`, [depositId]);
      await client.pool.query(
        `DELETE FROM ledger_balance_projections WHERE account_id IN ($1, $2)`,
        [pendingId, availableId]
      );
      await client.pool.query(`DELETE FROM ledger_accounts WHERE asset_id = $1`, [assetId]);
      await client.pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);
      await client.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });
});
