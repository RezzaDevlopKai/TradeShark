import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { createDatabase } from "@tradeshark/database";
import { IdentityService } from "@tradeshark/identity";
import { createApiServer } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabase(databaseUrl) : null;

integration("API trading execution integration", () => {
  after(async () => {
    await database?.pool.end();
  });

  it("matches a buyer and seller, settles balances, records trades, and isolates trade history", async () => {
    if (!database) throw new Error("DATABASE_URL is required");

    const baseAssetId = randomUUID();
    const quoteAssetId = randomUUID();
    const marketId = randomUUID();
    const feeAccountId = randomUUID();
    const buyerQuoteAvailableId = randomUUID();
    const buyerQuoteLockedId = randomUUID();
    const buyerBaseAvailableId = randomUUID();
    const buyerBaseLockedId = randomUUID();
    const sellerQuoteAvailableId = randomUUID();
    const sellerQuoteLockedId = randomUUID();
    const sellerBaseAvailableId = randomUUID();
    const sellerBaseLockedId = randomUUID();
    const buyerEmail = `${randomUUID()}@api.execution.test`;
    const buyerUsername = `apiexec_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const sellerEmail = `${randomUUID()}@api.execution.test`;
    const sellerUsername = `apiexec_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const identity = new IdentityService(database.db);
    const server = createApiServer(identity, database.db);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API server did not expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    let buyerUserId = "";
    let sellerUserId = "";
    let buyOrderId = "";
    let sellOrderId = "";
    let tradeId = "";

    const balance = async (accountId: string) => {
      const result = await database.pool.query(
        `SELECT balance FROM ledger_balance_projections WHERE account_id = $1`,
        [accountId]
      );
      return result.rows[0]?.balance as string | undefined;
    };

    try {
      const buyer = await identity.register({
        email: buyerEmail,
        username: buyerUsername,
        password: "correct-horse-battery-staple"
      });
      buyerUserId = buyer.user.id;

      const seller = await identity.register({
        email: sellerEmail,
        username: sellerUsername,
        password: "correct-horse-battery-staple"
      });
      sellerUserId = seller.user.id;

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
          ($7, $2, $8, 'USER_AVAILABLE', $9),
          ($10, $2, $8, 'USER_LOCKED', $11),
          ($12, $13, $8, 'USER_AVAILABLE', $14),
          ($15, $13, $8, 'USER_LOCKED', $16),
          ($17, $13, $3, 'USER_AVAILABLE', $18),
          ($19, $13, $3, 'USER_LOCKED', $20),
          ($21, NULL, $8, 'FEE_REVENUE', $22)`,
        [
          buyerQuoteAvailableId, buyerUserId, quoteAssetId, `exec-buyer-quote-available:${buyerQuoteAvailableId}`,
          buyerQuoteLockedId, `exec-buyer-quote-locked:${buyerQuoteLockedId}`,
          buyerBaseAvailableId, baseAssetId, `exec-buyer-base-available:${buyerBaseAvailableId}`,
          buyerBaseLockedId, `exec-buyer-base-locked:${buyerBaseLockedId}`,
          sellerQuoteAvailableId, sellerUserId, `exec-seller-quote-available:${sellerQuoteAvailableId}`,
          sellerQuoteLockedId, `exec-seller-quote-locked:${sellerQuoteLockedId}`,
          sellerBaseAvailableId, `exec-seller-base-available:${sellerBaseAvailableId}`,
          sellerBaseLockedId, `exec-seller-base-locked:${sellerBaseLockedId}`,
          feeAccountId, `exec-fee-revenue:${feeAccountId}`
        ]
      );
      await database.pool.query(
        `INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES
          ($1, '1000', 0), ($2, '0', 0), ($3, '0', 0), ($4, '0', 0),
          ($5, '0', 0), ($6, '0', 0), ($7, '0', 0), ($8, '2', 0),
          ($9, '0', 0)`,
        [
          buyerQuoteAvailableId, buyerQuoteLockedId, buyerBaseAvailableId, buyerBaseLockedId,
          sellerQuoteAvailableId, sellerQuoteLockedId, sellerBaseAvailableId, sellerBaseLockedId,
          feeAccountId
        ]
      );

      const buyerOrderResponse = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `tradeshark_session=${encodeURIComponent(buyer.token)}`
        },
        body: JSON.stringify({
          marketId,
          side: "buy",
          price: "100",
          quantity: "2",
          clientOrderId: `exec-buy-${randomUUID()}`
        })
      });
      assert.equal(buyerOrderResponse.status, 201);
      const buyOrder = await buyerOrderResponse.json() as { id: string; status: string; remainingQuantity: string; reservationAmount: string };
      buyOrderId = buyOrder.id;
      assert.equal(buyOrder.status, "open");
      assert.equal(buyOrder.remainingQuantity, "2.000000000000000000");
      assert.equal(buyOrder.reservationAmount, "201.100000000000000000");

      const sellerOrderResponse = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `tradeshark_session=${encodeURIComponent(seller.token)}`
        },
        body: JSON.stringify({
          marketId,
          side: "sell",
          price: "99",
          quantity: "2",
          clientOrderId: `exec-sell-${randomUUID()}`
        })
      });
      assert.equal(sellerOrderResponse.status, 201);
      const sellOrder = await sellerOrderResponse.json() as { id: string; status: string; remainingQuantity: string; reservationAmount: string };
      sellOrderId = sellOrder.id;
      assert.equal(sellOrder.status, "open");
      assert.equal(sellOrder.remainingQuantity, "2.000000000000000000");
      assert.equal(sellOrder.reservationAmount, "2.000000000000000000");

      const executionResponse = await fetch(
        `${baseUrl}/api/v1/orders/${encodeURIComponent(buyOrderId)}/execute`,
        {
          method: "POST",
          headers: { cookie: `tradeshark_session=${encodeURIComponent(buyer.token)}` }
        }
      );
      assert.equal(executionResponse.status, 200);
      const execution = await executionResponse.json() as {
        orderId: string;
        status: string;
        remainingQuantity: string;
        trades: Array<{ tradeId: string; buyOrderId: string; sellOrderId: string; price: string; quantity: string; feeAmount: string; releasedQuoteAmount: string }>;
        idempotent: boolean;
      };
      assert.equal(execution.orderId, buyOrderId);
      assert.equal(execution.status, "filled");
      assert.equal(execution.remainingQuantity, "0.000000000000000000");
      assert.equal(execution.trades.length, 1);
      assert.equal(execution.idempotent, false);
      const executed = execution.trades[0]!;
      tradeId = executed.tradeId;
      assert.equal(executed.buyOrderId, buyOrderId);
      assert.equal(executed.sellOrderId, sellOrderId);
      assert.equal(executed.price, "99.000000000000000000");
      assert.equal(executed.quantity, "2.000000000000000000");
      assert.equal(executed.feeAmount, "1.089000000000000000");
      assert.equal(executed.releasedQuoteAmount, "2.011000000000000000");

      assert.equal(await balance(buyerQuoteAvailableId), "800.911000000000000000");
      assert.equal(await balance(buyerQuoteLockedId), "0.000000000000000000");
      assert.equal(await balance(buyerBaseAvailableId), "2.000000000000000000");
      assert.equal(await balance(sellerBaseAvailableId), "0.000000000000000000");
      assert.equal(await balance(sellerBaseLockedId), "0.000000000000000000");
      assert.equal(await balance(sellerQuoteAvailableId), "198.000000000000000000");
      assert.equal(await balance(feeAccountId), "1.089000000000000000");

      const sellerOrders = await fetch(`${baseUrl}/api/v1/orders`, {
        headers: { cookie: `tradeshark_session=${encodeURIComponent(seller.token)}` }
      });
      assert.equal(sellerOrders.status, 200);
      const sellerOrderList = await sellerOrders.json() as { orders: Array<{ id: string; status: string; remainingQuantity: string }> };
      assert.equal(sellerOrderList.orders.length, 1);
      assert.equal(sellerOrderList.orders[0]?.id, sellOrderId);
      assert.equal(sellerOrderList.orders[0]?.status, "filled");
      assert.equal(sellerOrderList.orders[0]?.remainingQuantity, "0.000000000000000000");

      const buyerTrades = await fetch(`${baseUrl}/api/v1/trades?limit=10`, {
        headers: { cookie: `tradeshark_session=${encodeURIComponent(buyer.token)}` }
      });
      assert.equal(buyerTrades.status, 200);
      const buyerTradeBody = await buyerTrades.json() as { trades: Array<Record<string, unknown>> };
      assert.equal(buyerTradeBody.trades.length, 1);
      assert.equal(buyerTradeBody.trades[0]?.id, tradeId);
      assert.equal(buyerTradeBody.trades[0]?.side, "buy");

      const sellerTrades = await fetch(`${baseUrl}/api/v1/trades?limit=10`, {
        headers: { cookie: `tradeshark_session=${encodeURIComponent(seller.token)}` }
      });
      assert.equal(sellerTrades.status, 200);
      const sellerTradeBody = await sellerTrades.json() as { trades: Array<Record<string, unknown>> };
      assert.equal(sellerTradeBody.trades.length, 1);
      assert.equal(sellerTradeBody.trades[0]?.id, tradeId);
      assert.equal(sellerTradeBody.trades[0]?.side, "sell");

      const repeatedExecution = await fetch(
        `${baseUrl}/api/v1/orders/${encodeURIComponent(buyOrderId)}/execute`,
        {
          method: "POST",
          headers: { cookie: `tradeshark_session=${encodeURIComponent(buyer.token)}` }
        }
      );
      assert.equal(repeatedExecution.status, 200);
      const repeated = await repeatedExecution.json() as { status: string; trades: unknown[]; idempotent: boolean };
      assert.equal(repeated.status, "filled");
      assert.deepEqual(repeated.trades, []);
      assert.equal(repeated.idempotent, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (tradeId) {
        await database.pool.query(
          `DELETE FROM journal_entries WHERE transaction_id IN
           (SELECT id FROM journal_transactions WHERE reference_id = $1)`,
          [tradeId]
        );
        await database.pool.query(
          `DELETE FROM journal_transactions WHERE reference_id = $1`,
          [tradeId]
        );
        await database.pool.query(`DELETE FROM trades WHERE id = $1`, [tradeId]);
      }
      for (const orderId of [buyOrderId, sellOrderId]) {
        if (!orderId) continue;
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
        [[
          buyerQuoteAvailableId, buyerQuoteLockedId, buyerBaseAvailableId, buyerBaseLockedId,
          sellerQuoteAvailableId, sellerQuoteLockedId, sellerBaseAvailableId, sellerBaseLockedId,
          feeAccountId
        ]]
      );
      await database.pool.query(
        `DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`,
        [[
          buyerQuoteAvailableId, buyerQuoteLockedId, buyerBaseAvailableId, buyerBaseLockedId,
          sellerQuoteAvailableId, sellerQuoteLockedId, sellerBaseAvailableId, sellerBaseLockedId,
          feeAccountId
        ]]
      );
      await database.pool.query(
        `DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])`,
        [[buyerUserId, sellerUserId]]
      );
      await database.pool.query(
        `DELETE FROM user_credentials WHERE user_id = ANY($1::uuid[])`,
        [[buyerUserId, sellerUserId]]
      );
      await database.pool.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[])`,
        [[buyerUserId, sellerUserId]]
      );
      await database.pool.query(`DELETE FROM markets WHERE id = $1`, [marketId]);
      await database.pool.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [[baseAssetId, quoteAssetId]]);
    }
  });
});
