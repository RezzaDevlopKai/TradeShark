import { desc, eq, or } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { orders, trades } from "@tradeshark/database";

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
      buyUserId: orders.userId,
    })
    .from(trades)
    .innerJoin(orders, eq(orders.id, trades.buyOrderId))
    .where(or(eq(orders.userId, userId), eq(
      orders.userId,
      userId
    )))
    .orderBy(desc(trades.executedAt), desc(trades.id))
    .limit(limit);

  const sellRows = await db
    .select({
      id: trades.id,
      marketId: trades.marketId,
      buyOrderId: trades.buyOrderId,
      sellOrderId: trades.sellOrderId,
      price: trades.price,
      quantity: trades.quantity,
      feeAmount: trades.feeAmount,
      executedAt: trades.executedAt,
      sellUserId: orders.userId,
    })
    .from(trades)
    .innerJoin(orders, eq(orders.id, trades.sellOrderId))
    .where(eq(orders.userId, userId))
    .orderBy(desc(trades.executedAt), desc(trades.id))
    .limit(limit);

  const merged = new Map<string, UserTrade>();
  for (const row of rows) {
    merged.set(row.id, {
      id: row.id,
      marketId: row.marketId,
      buyOrderId: row.buyOrderId,
      sellOrderId: row.sellOrderId,
      price: row.price,
      quantity: row.quantity,
      feeAmount: row.feeAmount,
      executedAt: row.executedAt,
      side: "buy"
    });
  }
  for (const row of sellRows) {
    merged.set(row.id, {
      id: row.id,
      marketId: row.marketId,
      buyOrderId: row.buyOrderId,
      sellOrderId: row.sellOrderId,
      price: row.price,
      quantity: row.quantity,
      feeAmount: row.feeAmount,
      executedAt: row.executedAt,
      side: "sell"
    });
  }

  return [...merged.values()]
    .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime() || b.id.localeCompare(a.id))
    .slice(0, limit);
}
