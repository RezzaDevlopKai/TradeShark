import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@tradeshark/database";
import { getOrderBook } from "./order-book.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabase(databaseUrl) : null;

integration("order book integration", () => {
  afterAll(async () => {
    await database?.pool.end();
  });

  it("aggregates open liquidity by price and orders bids descending / asks ascending", async () => {
    if (!database) throw new Error("DATABASE_URL is required");

    const marketId = randomUUID();
    const baseAssetId = randomUUID();
    const quoteAssetId = randomUUID();
    const userIds = [randomUUID(), randomUUID(), randomUUID()];
    const orderIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    await database.pool.query(
      `INSERT INTO users (id, email, username) VALUES
        ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
      [
        userIds[0]!, `book-${userIds[0]}@example.test`, `book_${userIds[0]!.slice(0, 8)}`,
        userIds[1]!, `book-${userIds[1]}@example.test`, `book_${userIds[1]!.slice(0, 8)}`,
        userIds[2]!, `book-${userIds[2]}@example.test`, `book_${userIds[2]!.slice(0, 8)}`
      ]
    );
    await database.pool.query(
      `INSERT INTO assets (id, symbol, name, decimals) VALUES
        ($1, 'OBT', 'Order Book Token', 18),
        ($2, 'OBQ', 'Order Book Quote', 18)`,
      [baseAssetId, quoteAssetId]
    );
    await database.pool.query(
      `INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id) VALUES ($1, 'OBT/OBQ', $2, $3)`,
      [marketId, baseAssetId, quoteAssetId]
    );
    await database.pool.query(
      `INSERT INTO orders (id, user_id, market_id, side, status, quantity, remaining_quantity, limit_price, fee_rate, client_order_id) VALUES
        ($1, $2, $3, 'buy', 'open', '5', '5', '100', '0.0055', $4),
        ($5, $6, $3, 'buy', 'open', '3', '2', '100', '0.0055', $7),
        ($8, $9, $3, 'buy', 'partially_filled', '10', '4', '99', '0.0055', $10),
        ($11, $2, $3, 'sell', 'open', '2', '2', '101', '0.0055', $12),
        ($13, $6, $3, 'sell', 'open', '7', '5', '102', '0.0055', $14)`,
      [
        orderIds[0], userIds[0], marketId, `ob-${orderIds[0]}`,
        orderIds[1], userIds[1]!, `ob-${orderIds[1]}`,
        orderIds[2], userIds[2]!, `ob-${orderIds[2]}`,
        orderIds[3], `ob-${orderIds[3]}`,
        orderIds[4], `ob-${orderIds[4]}`
      ]
    );

    try {
      const book = await getOrderBook(database.db, marketId, 25);
      expect(book).toEqual({
        marketId,
        bids: [
          { price: "100", quantity: "7", orderCount: 2 },
          { price: "99", quantity: "4", orderCount: 1 }
        ],
        asks: [
          { price: "101", quantity: "2", orderCount: 1 },
          { price: "102", quantity: "5", orderCount: 1 }
        ]
      });

      const shallow = await getOrderBook(database.db, marketId, 1);
      expect(shallow.bids).toHaveLength(1);
      expect(shallow.bids[0]?.price).toBe("100");
      expect(shallow.asks).toHaveLength(1);
      expect(shallow.asks[0]?.price).toBe("101");
    } finally {
      await database.pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      await database.pool.query(`DELETE FROM markets WHERE id = $1`, [marketId]);
      await database.pool.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [[baseAssetId, quoteAssetId]]);
      await database.pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    }
  });
});
