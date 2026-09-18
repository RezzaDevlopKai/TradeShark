import { sql } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";

export type OrderBookLevel = {
  price: string;
  quantity: string;
  orderCount: number;
};

export type OrderBook = {
  marketId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
};

export async function getOrderBook(
  db: TradeSharkDatabase,
  marketId: string,
  depth = 25
): Promise<OrderBook> {
  if (!marketId.trim()) throw new Error("marketId is required");
  if (!Number.isInteger(depth) || depth < 1 || depth > 100) {
    throw new Error("depth must be between 1 and 100");
  }

  const rows = await db.execute(sql`
    SELECT
      side,
      limit_price AS price,
      SUM(remaining_quantity)::numeric AS quantity,
      COUNT(*)::int AS order_count
    FROM orders
    WHERE market_id = ${marketId}
      AND status IN ('open', 'partially_filled')
      AND remaining_quantity > 0
      AND limit_price IS NOT NULL
    GROUP BY side, limit_price
    ORDER BY
      CASE WHEN side = 'buy' THEN limit_price END DESC NULLS LAST,
      CASE WHEN side = 'sell' THEN limit_price END ASC NULLS LAST
  `);

  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  for (const row of rows as unknown as Array<Record<string, unknown>>) {
    const level = {
      price: String(row.price),
      quantity: String(row.quantity),
      orderCount: Number(row.order_count)
    };

    if (row.side === "buy" && bids.length < depth) bids.push(level);
    if (row.side === "sell" && asks.length < depth) asks.push(level);
  }

  return { marketId, bids, asks };
}
