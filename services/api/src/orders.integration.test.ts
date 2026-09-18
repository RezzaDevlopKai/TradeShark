import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { createDatabase } from "@tradeshark/database";
import { IdentityService } from "@tradeshark/identity";
import { createApiServer } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabase(databaseUrl) : null;

integration("API trading order integration", () => {
  after(async () => {
    await database?.pool.end();
  });

  it("places, lists, isolates, and cancels a limit order through the authenticated API", async () => {
    if (!database) throw new Error("DATABASE_URL is required");

    const baseAssetId = randomUUID();
    const quoteAssetId = randomUUID();
    const marketId = randomUUID();
    const availableId = randomUUID();
    const lockedId = randomUUID();
    const otherAvailableId = randomUUID();
    const otherLockedId = randomUUID();
    const email = `${randomUUID()}@api.trading.test`;
    const username = `apiorder_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const otherEmail = `${randomUUID()}@api.trading.test`;
    const otherUsername = `apiorder_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const identity = new IdentityService(database.db);
    const server = createApiServer(identity, database.db);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API server did not expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    let userId = "";
    let otherUserId = "";
    let orderId = "";
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
        `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES
          ($1, 'TSH', 'TradeShark Token', 18, true),
          ($2, 'USD', 'US Dollar', 2, true)`,
        [baseAssetId, quoteAssetId]
      );
      await database.pool.query(
        `INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active)
         VALUES ($1, 'TSH/USD', $2, $3, true)`,
        [marketId, baseAssetId, quoteAssetId]
      );
      await database.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
          ($1, $2, $3, 'USER_AVAILABLE', $4),
          ($5, $2, $3, 'USER_LOCKED', $6),
          ($7, $8, $3, 'USER_AVAILABLE', $9),
          ($10, $8, $3, 'USER_LOCKED', $11)`,
        [
          availableId, userId, quoteAssetId, `api-order-available:${availableId}`,
          lockedId, `api-order-locked:${lockedId}`,
          otherAvailableId, otherUserId, `api-order-other-available:${otherAvailableId}`,
          otherLockedId, `api-order-other-locked:${otherLockedId}`
        ]
      );
      await database.pool.query(
        `INSERT INTO ledger_balance_projections (account_id, balance, version)
         VALUES ($1, '1000', 0), ($2, '0', 0), ($3, '1000', 0), ($4, '0', 0)`,
        [availableId, lockedId, otherAvailableId, otherLockedId]
      );

      const orderBody = {
        marketId,
        side: "buy",
        price: "100",
        quantity: "2",
        clientOrderId: `api-order-${randomUUID()}`
      };
      const orderResponse = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `tradeshark_session=${encodeURIComponent(registration.token)}`
        },
        body: JSON.stringify(orderBody)
      });
      assert.equal(orderResponse.status, 201);
      const order = await orderResponse.json() as {
        id: string;
        userId: string;
        marketId: string;
        side: string;
        status: string;
        quantity: string;
        remainingQuantity: string;
        limitPrice: string;
        feeRate: string;
        clientOrderId: string;
        reservationAmount: string;
        reservationAssetId: string;
        idempotent: boolean;
      };
      orderId = order.id;
      assert.equal(order.userId, userId);
      assert.equal(order.marketId, marketId);
      assert.equal(order.side, "buy");
      assert.equal(order.status, "open");
      assert.equal(order.quantity, "2");
      assert.equal(order.remainingQuantity, "2");
      assert.equal(order.limitPrice, "100");
      assert.equal(order.feeRate, "0.0055");
      assert.equal(order.clientOrderId, orderBody.clientOrderId);
      assert.equal(order.reservationAmount, "201.100000000000000000");
      assert.equal(order.reservationAssetId, quoteAssetId);
      assert.equal(order.idempotent, false);

      const balanceRows = await database.pool.query(
        `SELECT account_id, balance FROM ledger_balance_projections
         WHERE account_id = ANY($1::uuid[]) ORDER BY account_id`,
        [[availableId, lockedId]]
      );
      const balances = new Map(balanceRows.rows.map((row) => [row.account_id, row.balance]));
      assert.equal(balances.get(availableId), "798.900000000000000000");
      assert.equal(balances.get(lockedId), "201.100000000000000000");

      const listed = await fetch(`${baseUrl}/api/v1/orders?limit=10`, {
        headers: { cookie: `tradeshark_session=${encodeURIComponent(registration.token)}` }
      });
      assert.equal(listed.status, 200);
      const listedBody = await listed.json() as { orders: Array<Record<string, unknown>> };
      assert.equal(listedBody.orders.length, 1);
      assert.equal(listedBody.orders[0]?.id, orderId);
      assert.equal(listedBody.orders[0]?.status, "open");

      const otherListed = await fetch(`${baseUrl}/api/v1/orders`, {
        headers: { cookie: `tradeshark_session=${encodeURIComponent(otherRegistration.token)}` }
      });
      assert.equal(otherListed.status, 200);
      assert.deepEqual(await otherListed.json(), { orders: [] });

      const idempotent = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `tradeshark_session=${encodeURIComponent(registration.token)}`
        },
        body: JSON.stringify(orderBody)
      });
      assert.equal(idempotent.status, 200);
      const idempotentBody = await idempotent.json() as { id: string; idempotent: boolean; reservationAmount: string };
      assert.equal(idempotentBody.id, orderId);
      assert.equal(idempotentBody.idempotent, true);
      assert.equal(idempotentBody.reservationAmount, "201.100000000000000000");

      const cancel = await fetch(`${baseUrl}/api/v1/orders/${encodeURIComponent(orderId)}`, {
        method: "DELETE",
        headers: { cookie: `tradeshark_session=${encodeURIComponent(registration.token)}` }
      });
      assert.equal(cancel.status, 200);
      const cancelled = await cancel.json() as {
        id: string;
        status: string;
        remainingQuantity: string;
        releasedAmount: string;
        releasedAssetId: string;
        idempotent: boolean;
      };
      assert.equal(cancelled.id, orderId);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.remainingQuantity, "2");
      assert.equal(cancelled.releasedAmount, "201.100000000000000000");
      assert.equal(cancelled.releasedAssetId, quoteAssetId);
      assert.equal(cancelled.idempotent, false);

      const finalBalances = await database.pool.query(
        `SELECT account_id, balance FROM ledger_balance_projections
         WHERE account_id = ANY($1::uuid[]) ORDER BY account_id`,
        [[availableId, lockedId]]
      );
      const finalMap = new Map(finalBalances.rows.map((row) => [row.account_id, row.balance]));
      assert.equal(finalMap.get(availableId), "1000.000000000000000000");
      assert.equal(finalMap.get(lockedId), "0.000000000000000000");

      const otherCancel = await fetch(`${baseUrl}/api/v1/orders/${encodeURIComponent(orderId)}`, {
        method: "DELETE",
        headers: { cookie: `tradeshark_session=${encodeURIComponent(otherRegistration.token)}` }
      });
      assert.equal(otherCancel.status, 400);
      assert.deepEqual(await otherCancel.json(), { error: "Order does not exist" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (orderId) {
        await database.pool.query(
          `DELETE FROM journal_entries WHERE transaction_id IN
           (SELECT id FROM journal_transactions WHERE reference_id = $1)`,
          [orderId]
        );
        await database.pool.query(
          `DELETE FROM journal_transactions WHERE reference_id = $1`,
          [orderId]
        );
        await database.pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
      }
      await database.pool.query(
        `DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`,
        [[availableId, lockedId, otherAvailableId, otherLockedId]]
      );
      await database.pool.query(
        `DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`,
        [[availableId, lockedId, otherAvailableId, otherLockedId]]
      );
      await database.pool.query(
        `DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])`,
        [[userId, otherUserId]]
      );
      await database.pool.query(
        `DELETE FROM user_credentials WHERE user_id = ANY($1::uuid[])`,
        [[userId, otherUserId]]
      );
      await database.pool.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[])`,
        [[userId, otherUserId]]
      );
      await database.pool.query(`DELETE FROM markets WHERE id = $1`, [marketId]);
      await database.pool.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [[baseAssetId, quoteAssetId]]);
    }
  });
});
