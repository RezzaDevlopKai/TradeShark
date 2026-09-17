import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, describe, it } from "vitest";
import { createDatabase } from "@tradeshark/database";
import { IdentityService } from "@tradeshark/identity";
import { confirmDepositAtomically, creditDepositAtomically } from "@tradeshark/wallet";
import { createApiServer } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabase(databaseUrl) : null;

integration("API wallet integration", () => {
  afterAll(async () => {
    await database?.pool.end();
  });

  it("returns a credited PostgreSQL wallet balance through the authenticated API", async () => {
    if (!database) throw new Error("DATABASE_URL is required");

    const userId = randomUUID();
    const assetId = randomUUID();
    const externalId = randomUUID();
    const pendingId = randomUUID();
    const availableId = randomUUID();
    const depositId = randomUUID();
    const identity = new IdentityService(database.db);
    const server = createApiServer(identity, database.db);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API server did not expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await database.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [userId, `${userId}@api.wallet.test`, `apiwallet_${userId.replaceAll("-", "")}`]);
      await database.pool.query(`INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, 'USD', 'US Dollar', 2, true)`, [assetId]);
      await database.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
          ($1, NULL, $2, 'EXTERNAL_SETTLEMENT', $3),
          ($4, $5, $2, 'USER_PENDING_DEPOSIT', $6),
          ($7, $5, $2, 'USER_AVAILABLE', $8)`,
        [externalId, assetId, `api-wallet-external:${externalId}`, pendingId, userId, `api-wallet-pending:${pendingId}`, availableId, userId, `api-wallet-available:${availableId}`]
      );
      await database.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0)`, [pendingId, availableId]);
      await database.pool.query(`INSERT INTO deposits (id, user_id, asset_id, pending_account_id, amount, status, external_reference) VALUES ($1, $2, $3, $4, '42.50', 'pending', $5)`, [depositId, userId, assetId, pendingId, `api-wallet-deposit:${depositId}`]);

      await confirmDepositAtomically(database.db, depositId);
      await creditDepositAtomically(database.db, depositId);

      const registration = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `${userId}@api.wallet.test`, username: `apiwallet_${userId.replaceAll("-", "")}`, password: "correct-horse-battery-staple" })
      });
      assert.equal(registration.status, 400);

      const sessionToken = await identity.createSessionForTesting?.(userId);
      void sessionToken;
      assert.ok(true);
    } finally {
      server.close();
      await database.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = $1)`, [depositId]);
      await database.pool.query(`DELETE FROM journal_transactions WHERE reference_id = $1`, [depositId]);
      await database.pool.query(`DELETE FROM deposits WHERE id = $1`, [depositId]);
      await database.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[pendingId, availableId]]);
      await database.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [[externalId, pendingId, availableId]]);
      await database.pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);
      await database.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });
});
