import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { createDatabase } from "@tradeshark/database";
import { IdentityService } from "@tradeshark/identity";
import { createApiServer } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabase(databaseUrl) : null;

integration("API market data integration", () => {
  after(async () => {
    await database?.pool.end();
  });

  it("serves recent trades and order book data with stable decimal payloads", async () => {
    if (!database) throw new Error("DATABASE_URL is required");

    const marketId = randomUUID();
    const baseAssetId = randomUUID();
    const quoteAssetId = randomUUID();
    const userIds = [randomUUID(), randomUUID()];
    const orderIds = [randomUUID(), randomUUID()];
    const tradeIds = [randomUUID(), randomUUID()];

    await database.pool.query(
      "INSERT INTO users (id,email,username) VALUES ($1,$2,$3),($4,$5,$6)",
      [
        userIds[0], `market-data-${userIds[0]}@example.test`, `market_data_${userIds[0]!.slice(0, 8)}`,
        userIds[1], `market-data-${userIds[1]}@example.test`, `market_data_${userIds[1]!.slice(0, 8)}`
      ]
    );
    await database.pool.query(
      "INSERT INTO assets (id,symbol,name,decimals) VALUES ($1,'MDB','Market Data Base',18),($2,'MDQ','Market Data Quote',18)",
      [baseAssetId, quoteAssetId]
    );
    await database.pool.query(
      "INSERT INTO markets (id,symbol,base_asset_id,quote_asset_id) VALUES ($1,'MDB/MDQ',$2,$3)",
      [marketId, baseAssetId, quoteAssetId]
    );
    await database.pool.query(
      "INSERT INTO orders (id,user_id,market_id,side,status,quantity,remaining_quantity,limit_price,fee_rate,client_order_id) VALUES
       ($1,$2,$3,'buy','open','10','1.500000000000000000','101.000000000000000000','0.0055',$4),
       ($5,$6,$3,'sell','open','10','2.250000000000000000','103.000000000000000000','0.0055',$7)",
      [
        orderIds[0], userIds[0], marketId, `market-data-${orderIds[0]}`,
        orderIds[1], userIds[1], `market-data-${orderIds[1]}`
      ]
    );

    try {
      await database.pool.query(
        "INSERT INTO trades (id,market_id,buy_order_id,sell_order_id,price,quantity,fee_amount,executed_at) VALUES ($1,$2,$3,$4,'102.500000000000000000','0.750000000000000000','0.00421875',NOW()-INTERVAL '2 seconds'),($5,$2,$3,$4,'103.000000000000000000','1.250000000000000000','0.00708125',NOW()-INTERVAL '1 second')",
        [tradeIds[0], marketId, orderIds[0], orderIds[1], tradeIds[1]]
      );

      const identity = new IdentityService(database.db);
      const server = createApiServer(identity, database.db);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("API server did not expose a port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const tradesResponse = await fetch(`${baseUrl}/api/v1/markets/${marketId}/trades?limit=2`);
        assert.equal(tradesResponse.status, 200);
        assert.deepEqual(await tradesResponse.json(), {
          trades: [
            { id: tradeIds[1], marketId, price: "103", quantity: "1.25", executedAt: (await database.pool.query("SELECT executed_at FROM trades WHERE id = $1", [tradeIds[1]])).rows[0].executed_at.toISOString() },
            { id: tradeIds[0], marketId, price: "102.5", quantity: "0.75", executedAt: (await database.pool.query("SELECT executed_at FROM trades WHERE id = $1", [tradeIds[0]])).rows[0].executed_at.toISOString() }
          ]
        });

        const invalidTradeLimit = await fetch(`${baseUrl}/api/v1/markets/${marketId}/trades?limit=101`);
        assert.equal(invalidTradeLimit.status, 400);
        assert.deepEqual(await invalidTradeLimit.json(), { error: "INVALID_LIMIT" });

        const orderBookResponse = await fetch(`${baseUrl}/api/v1/markets/${marketId}/order-book?depth=10`);
        assert.equal(orderBookResponse.status, 200);
        assert.deepEqual(await orderBookResponse.json(), {
          marketId,
          bids: [{ price: "101", quantity: "1.5", orderCount: 1 }],
          asks: [{ price: "103", quantity: "2.25", orderCount: 1 }],
          bestBid: "101",
          bestAsk: "103",
          spread: "2"
        });

        const invalidDepth = await fetch(`${baseUrl}/api/v1/markets/${marketId}/order-book?depth=101`);
        assert.equal(invalidDepth.status, 400);
        assert.deepEqual(await invalidDepth.json(), { error: "INVALID_DEPTH" });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      await database.pool.query("DELETE FROM trades WHERE id = ANY($1::uuid[])", [tradeIds]);
      await database.pool.query("DELETE FROM orders WHERE id = ANY($1::uuid[])", [orderIds]);
      await database.pool.query("DELETE FROM markets WHERE id = $1", [marketId]);
      await database.pool.query("DELETE FROM assets WHERE id = ANY($1::uuid[])", [[baseAssetId, quoteAssetId]]);
      await database.pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    }
  });

  it("returns service unavailable for market data when the database is not configured", async () => {
    const server = createApiServer(null, null);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API server did not expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      for (const path of [
        "/api/v1/markets/market/trades",
        "/api/v1/markets/market/order-book"
      ]) {
        const response = await fetch(`${baseUrl}${path}`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: "DATABASE_UNAVAILABLE" });
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
