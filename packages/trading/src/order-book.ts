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
  bestBid: string | null;
  bestAsk: string | null;
  spread: string | null;
};

function normalizeDecimalString(value: unknown): string {
  const text = String(value).trim();

  if (!text.includes(".")) {
    return text === "-0" ? "0" : text;
  }

  const separatorIndex = text.indexOf(".");
  const integerPart = text.slice(0, separatorIndex);
  const fractionalPart = text.slice(separatorIndex + 1);
  const normalizedFraction = fractionalPart.replace(/0+$/, "");

  if (!normalizedFraction) {
    return integerPart === "-0" ? "0" : integerPart;
  }

  return `${integerPart}.${normalizedFraction}`;
}

function subtractDecimalStrings(left: string, right: string): string {
  const leftNormalized = normalizeDecimalString(left);
  const rightNormalized = normalizeDecimalString(right);

  const leftNegative = leftNormalized.startsWith("-");
  const rightNegative = rightNormalized.startsWith("-");
  const leftUnsigned = leftNegative ? leftNormalized.slice(1) : leftNormalized;
  const rightUnsigned = rightNegative ? rightNormalized.slice(1) : rightNormalized;

  const leftParts = leftUnsigned.split(".");
  const rightParts = rightUnsigned.split(".");
  const leftFraction = leftParts[1] ?? "";
  const rightFraction = rightParts[1] ?? "";
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const factor = 10n ** BigInt(scale);

  const leftInteger = BigInt(leftParts[0] || "0");
  const rightInteger = BigInt(rightParts[0] || "0");
  const leftValue = (leftInteger * factor + BigInt(leftFraction.padEnd(scale, "0") || "0")) * (leftNegative ? -1n : 1n);
  const rightValue = (rightInteger * factor + BigInt(rightFraction.padEnd(scale, "0") || "0")) * (rightNegative ? -1n : 1n);
  const difference = leftValue - rightValue;

  if (difference === 0n) return "0";

  const negative = difference < 0n;
  const absolute = negative ? -difference : difference;
  const integerPart = absolute / factor;
  const fractionalPart = scale === 0 ? "" : (absolute % factor).toString().padStart(scale, "0").replace(/0+$/, "");

  const result = fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart.toString();
  return negative ? `-${result}` : result;
}

export async function getOrderBook(
  db: TradeSharkDatabase,
  marketId: string,
  depth = 25
): Promise<OrderBook> {
  if (!marketId.trim()) throw new Error("marketId is required");
  if (!Number.isInteger(depth) || depth < 1 || depth > 100) {
    throw new Error("depth must be between 1 and 100");
  }

  const result = await db.execute(sql`
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

  const rows = (result as unknown as { rows: Array<Record<string, unknown>> }).rows;

  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  for (const row of rows) {
    const level = {
      price: normalizeDecimalString(row.price),
      quantity: normalizeDecimalString(row.quantity),
      orderCount: Number(row.order_count)
    };

    if (row.side === "buy" && bids.length < depth) bids.push(level);
    if (row.side === "sell" && asks.length < depth) asks.push(level);
  }

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const spread = bestBid !== null && bestAsk !== null
    ? subtractDecimalStrings(bestAsk, bestBid)
    : null;

  return { marketId, bids, asks, bestBid, bestAsk, spread };
}
