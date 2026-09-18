import { desc, eq, or } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { orders, trades } from "@tradeshark/database";
import { alias } from "drizzle-orm/pg-core";

const buyOrders = alias(orders, "buy_orders");
const sellOrders = alias(orders, "sell_orders");

export type UserTrade = {
  id: string;
  marketId: string;
  buyOrderId: string;
  sellOrderId: string;
  price: string;
  quantity: string;
  feeAmount: string;
  executedAt: Date;
  side: "buy" | "sell";
};

export async function getUserTrades(
  db: TradeSharkDatabase,
  userId: string,
  limit = 50
): Promise<UserTrade[]> {
  if (!userId) throw new Error("userId is required");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be between 1 and 100");
  }

  const rows = await db
    .select({
      id: trades.id,
      marketId: trades.marketId,
      buyOrderId: trades.buyOrderId,
      sellOrderId: trades.sellOrderId,
      price: trades.price,
      quantity: trades.quantity,
      feeAmount: trades.feeAmount,
      executedAt: trades.executedAt,
      buyUserId: buyOrders.userId,
      sellUserId: sellOrders.userId
    })
    .from(trades)
    .innerJoin(buyOrders, eq(buyOrders.id, trades.buyOrderId))
    .innerJoin(sellOrders, eq(sellOrders.id, trades.sellOrderId))
    .where(or(eq(buyOrders.userId, userId), eq(sellOrders.userId, userId)))
    .orderBy(desc(trades.executedAt), desc(trades.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    marketId: row.marketId,
    buyOrderId: row.buyOrderId,
    sellOrderId: row.sellOrderId,
    price: row.price,
    quantity: row.quantity,
    feeAmount: row.feeAmount,
    executedAt: row.executedAt,
    side: row.buyUserId === userId ? "buy" : "sell"
  }));
}
