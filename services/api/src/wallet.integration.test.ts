import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { createDatabase } from "@tradeshark/database";
import { IdentityService } from "@tradeshark/identity";
import { confirmDepositAtomically, creditDepositAtomically } from "@tradeshark/wallet";
import { createApiServer } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabase(databaseUrl) : null;

integration("API wallet integration", () => {
  after(async () => {
    await database?.pool.end();
  });

  it("returns a credited PostgreSQL wallet balance through the authenticated API", async () => {
    if (!database) throw new Error("DATABASE_URL is required");

    const assetId = randomUUID();
    const externalId = randomUUID();
    const pendingId = randomUUID();
    const availableId = randomUUID();
    const depositId = randomUUID();
    const email = `${randomUUID()}@api.wallet.test`;
    const username = `apiwallet_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const identity = new IdentityService(database.db);
    const server = createApiServer(identity, database.db);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API server did not expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    let userId = "";
    try {
      const registration = await identity.register({
        email,
        username,
        password: "correct-horse-battery-staple"
      });
      userId = registration.user.id;

      await database.pool.query(`INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, 'USD', 'US Dollar', 2, true)`, [assetId]);
      await database.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
          ($1, NULL, $2, 'EXTERNAL_SETTLEMENT', $3),
          ($4, $5, $2, 'USER_PENDING_DEPOSIT', $6),
          ($7, $8, $2, 'USER_AVAILABLE', $9)`,
        [externalId, assetId, `api-wallet-external:${externalId}`, pendingId, userId, `api-wallet-pending:${pendingId}`, availableId, userId, `api-wallet-available:${availableId}`]
      );
      await database.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0)`, [pendingId, availableId]);
      await database.pool.query(`INSERT INTO deposits (id, user_id, asset_id, pending_account_id, amount, status, external_reference) VALUES ($1, $2, $3, $4, '42.50', 'pending', $5)`, [depositId, userId, assetId, pendingId, `api-wallet-deposit:${depositId}`]);

      await confirmDepositAtomically(database.db, depositId);
      await creditDepositAtomically(database.db, depositId);

      const response = await fetch(`${baseUrl}/api/v1/wallet/balances`, {
        headers: { cookie: `tradeshark_session=${encodeURIComponent(registration.token)}` }
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        balances: [{
          accountId: availableId,
          assetId,
          symbol: "USD",
          name: "US Dollar",
          decimals: 2,
          balance: "42.500000000000000000"
        }]
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = $1)`, [depositId]);
      await database.pool.query(`DELETE FROM journal_transactions WHERE reference_id = $1`, [depositId]);
      await database.pool.query(`DELETE FROM deposits WHERE id = $1`, [depositId]);
      await database.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[pendingId, availableId]]);
      await database.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [[externalId, pendingId, availableId]]);
      await database.pool.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
      await database.pool.query(`DELETE FROM user_credentials WHERE user_id = $1`, [userId]);
      await database.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await database.pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);
    }
  });

  it("returns authenticated deposit history without exposing another user's deposits", async () => {
    if (!database) throw new Error("DATABASE_URL is required");

    const assetId = randomUUID();
    const pendingId = randomUUID();
    const otherPendingId = randomUUID();
    const depositId = randomUUID();
    const email = `${randomUUID()}@api.wallet.test`;
    const username = `apiwallet_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const otherEmail = `${randomUUID()}@api.wallet.test`;
    const otherUsername = `apiwallet_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const identity = new IdentityService(database.db);
    const server = createApiServer(identity, database.db);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API server did not expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    let userId = "";
    let otherUserId = "";
    try {
      const registration = await identity.register({
        email,
        username,
        password: "correct-horse-battery-staple"
      });
      userId = registration.user.id;

      const otherRegistration = await identity.register({
        email: otherEmail,
        username: otherUsername,
        password: "correct-horse-battery-staple"
      });
      otherUserId = otherRegistration.user.id;

      await database.pool.query(
        `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, 'USD', 'US Dollar', 2, true)`,
        [assetId]
      );
      await database.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
          ($1, $2, $3, 'USER_PENDING_DEPOSIT', $4),
          ($5, $6, $3, 'USER_PENDING_DEPOSIT', $7)`,
        [pendingId, userId, assetId, `api-wallet-pending:${pendingId}`, otherPendingId, otherUserId, `api-wallet-pending:${otherPendingId}`]
      );
      await database.pool.query(
        `INSERT INTO deposits (id, user_id, asset_id, pending_account_id, amount, status, external_reference, confirmation_count)
         VALUES ($1, $2, $3, $4, '12.34', 'pending', $5, 2)`,
        [depositId, userId, assetId, pendingId, `api-wallet-history:${depositId}`]
      );

      const response = await fetch(`${baseUrl}/api/v1/wallet/deposits?limit=10`, {
        headers: { cookie: `tradeshark_session=${encodeURIComponent(registration.token)}` }
      });
      assert.equal(response.status, 200);
      const body = await response.json() as { deposits: Array<Record<string, unknown>> };
      assert.equal(body.deposits.length, 1);
      assert.equal(body.deposits[0]?.id, depositId);
      assert.equal(body.deposits[0]?.assetId, assetId);
      assert.equal(body.deposits[0]?.amount, "12.340000000000000000");
      assert.equal(body.deposits[0]?.status, "pending");
      assert.equal(body.deposits[0]?.confirmationCount, 2);
      assert.equal(body.deposits[0]?.externalReference, `api-wallet-history:${depositId}`);

      const otherResponse = await fetch(`${baseUrl}/api/v1/wallet/deposits`, {
        headers: { cookie: `tradeshark_session=${encodeURIComponent(otherRegistration.token)}` }
      });
      assert.equal(otherResponse.status, 200);
      assert.deepEqual(await otherResponse.json(), { deposits: [] });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.pool.query(`DELETE FROM deposits WHERE id = $1`, [depositId]);
      await database.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [[pendingId, otherPendingId]]);
      await database.pool.query(`DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])`, [[userId, otherUserId]]);
      await database.pool.query(`DELETE FROM user_credentials WHERE user_id = ANY($1::uuid[])`, [[userId, otherUserId]]);
      await database.pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[userId, otherUserId]]);
      await database.pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);
    }
  });
});
