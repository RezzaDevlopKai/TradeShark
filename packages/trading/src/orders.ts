import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import {
  assets,
  journalTransactions,
  ledgerAccounts,
  markets,
  orders,
  postJournalInTransaction
} from "@tradeshark/database";
import { calculateFee, normalizeDecimal } from "./engine.js";

const SCALE = 18n;
const FACTOR = 10n ** SCALE;

type PlaceLimitOrderInput = {
  userId: string;
  marketId: string;
  side: "buy" | "sell";
  price: string;
  quantity: string;
  feeRate?: string;
  clientOrderId: string;
};

export type { PlaceLimitOrderInput };

export type PlacedOrder = {
  id: string;
  userId: string;
  marketId: string;
  side: "buy" | "sell";
  status: "pending" | "open" | "partially_filled" | "filled" | "cancelled" | "rejected";
  quantity: string;
  remainingQuantity: string;
  limitPrice: string;
  feeRate: string;
  clientOrderId: string;
  sequence: number;
  reservationAmount: string;
  reservationAssetId: string;
  reservationJournalTransactionId: string;
  idempotent: boolean;
};

/**
 * Places a limit order and reserves its maximum liability atomically.
 *
 * Buy orders reserve limit-price quote notional plus the configured buyer fee.
 * Sell orders reserve the full base quantity. The reservation is a normal
 * ledger movement from USER_AVAILABLE to USER_LOCKED, so insufficient funds
 * roll back the order insert automatically.
 */
export async function placeLimitOrder(
  db: TradeSharkDatabase,
  input: PlaceLimitOrderInput
): Promise<PlacedOrder> {
  if (!input.userId.trim()) throw new Error("userId is required");
  if (!input.marketId.trim()) throw new Error("marketId is required");
  if (!input.clientOrderId.trim()) throw new Error("clientOrderId is required");
  if (input.side !== "buy" && input.side !== "sell") throw new Error("invalid order side");

  const price = normalizeDecimal(input.price);
  const quantity = normalizeDecimal(input.quantity);
  const feeRate = normalizeFeeRate(input.feeRate ?? "0.0055");

  return db.transaction(async (tx) => {
    // Serialize the same user's clientOrderId so concurrent retries converge
    // to one order instead of racing through the unique constraint.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.clientOrderId}`}))`);

    const existingRows = await tx
      .select({
        id: orders.id,
        userId: orders.userId,
        marketId: orders.marketId,
        side: orders.side,
        status: orders.status,
        quantity: orders.quantity,
        remainingQuantity: orders.remainingQuantity,
        limitPrice: orders.limitPrice,
        feeRate: orders.feeRate,
        clientOrderId: orders.clientOrderId,
        sequence: orders.sequence
      })
      .from(orders)
      .where(and(eq(orders.userId, input.userId), eq(orders.clientOrderId, input.clientOrderId)))
      .limit(1);

    const existing = existingRows[0];
    if (existing) {
      const existingFeeRate = normalizeFeeRate(existing.feeRate);
      if (
        existing.marketId !== input.marketId ||
        existing.side !== input.side ||
        existing.quantity !== quantity ||
        existing.limitPrice !== price ||
        existingFeeRate !== feeRate
      ) {
        throw new Error("clientOrderId was already used with a different order");
      }

      const marketRows = await tx
        .select({ baseAssetId: markets.baseAssetId, quoteAssetId: markets.quoteAssetId })
        .from(markets)
        .where(eq(markets.id, existing.marketId))
        .limit(1);
      const market = marketRows[0];
      if (!market) throw new Error("Trading market does not exist");

      const reservationAssetId = existing.side === "buy" ? market.quoteAssetId : market.baseAssetId;
      const reservationAmount = existing.side === "buy"
        ? addDecimals(
            multiplyDecimals(existing.limitPrice ?? price, existing.quantity),
            calculateFee(existing.limitPrice ?? price, existing.quantity, existingFeeRate)
          )
        : existing.quantity;

      const journalRows = await tx
        .select({ id: journalTransactions.id })
        .from(journalTransactions)
        .where(eq(journalTransactions.idempotencyKey, `order:${existing.id}:reserve`))
        .limit(1);
      const journal = journalRows[0];
      if (!journal) throw new Error("Existing order reservation journal was not found");

      return {
        id: existing.id,
        userId: existing.userId,
        marketId: existing.marketId,
        side: existing.side,
        status: existing.status,
        quantity: existing.quantity,
        remainingQuantity: existing.remainingQuantity,
        limitPrice: existing.limitPrice ?? price,
        feeRate: existingFeeRate,
        clientOrderId: existing.clientOrderId,
        sequence: existing.sequence,
        reservationAmount,
        reservationAssetId,
        reservationJournalTransactionId: journal.id,
        idempotent: true
      };
    }

    const marketRows = await tx
      .select({
        baseAssetId: markets.baseAssetId,
        quoteAssetId: markets.quoteAssetId,
        isActive: markets.isActive
      })
      .from(markets)
      .where(eq(markets.id, input.marketId))
      .limit(1);
    const market = marketRows[0];
    if (!market || !market.isActive) throw new Error("Trading market does not exist or is inactive");

    const assetRows = await tx
      .select({ id: assets.id, isActive: assets.isActive })
      .from(assets)
      .where(inArray(assets.id, [market.baseAssetId, market.quoteAssetId]));
    if (assetRows.length !== 2 || assetRows.some((asset) => !asset.isActive)) {
      throw new Error("Trading market assets must be active");
    }

    const reservationAssetId = input.side === "buy" ? market.quoteAssetId : market.baseAssetId;
    const reservationAmount = input.side === "buy"
      ? addDecimals(multiplyDecimals(price, quantity), calculateFee(price, quantity, feeRate))
      : quantity;

    const accountRows = await tx
      .select({
        id: ledgerAccounts.id,
        userId: ledgerAccounts.userId,
        assetId: ledgerAccounts.assetId,
        accountType: ledgerAccounts.accountType
      })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, input.userId),
          eq(ledgerAccounts.assetId, reservationAssetId),
          inArray(ledgerAccounts.accountType, ["USER_AVAILABLE", "USER_LOCKED"])
        )
      );

    const available = accountRows.find((account) => account.accountType === "USER_AVAILABLE");
    const locked = accountRows.find((account) => account.accountType === "USER_LOCKED");
    if (!available || !locked) throw new Error("Required USER_AVAILABLE and USER_LOCKED accounts do not exist");

    const orderId = randomUUID();
    const journal = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey: `order:${orderId}:reserve`,
      referenceType: "order_reservation",
      referenceId: orderId,
      metadata: {
        orderId,
        marketId: input.marketId,
        userId: input.userId,
        side: input.side,
        reservationAssetId,
        reservationAmount
      },
      entries: [
        { accountId: available.id, direction: "debit", amount: reservationAmount },
        { accountId: locked.id, direction: "credit", amount: reservationAmount }
      ]
    });

    const inserted = await tx
      .insert(orders)
      .values({
        id: orderId,
        userId: input.userId,
        marketId: input.marketId,
        side: input.side,
        status: "open",
        quantity,
        remainingQuantity: quantity,
        limitPrice: price,
        feeRate,
        clientOrderId: input.clientOrderId
      })
      .returning({ id: orders.id, sequence: orders.sequence });

    const order = inserted[0];
    if (!order) throw new Error("Order could not be created");

    return {
      id: orderId,
      userId: input.userId,
      marketId: input.marketId,
      side: input.side,
      status: "open",
      quantity,
      remainingQuantity: quantity,
      limitPrice: price,
      feeRate,
      clientOrderId: input.clientOrderId,
      sequence: order.sequence,
      reservationAmount,
      reservationAssetId,
      reservationJournalTransactionId: journal.transactionId,
      idempotent: false
    };
  });
}

function normalizeFeeRate(value: string): string {
  const normalized = normalizeDecimal(value);
  const fraction = normalized.split(".")[1] ?? "";
  if (fraction.replace(/0+$/, "").length > 10) {
    throw new Error("feeRate must have at most 10 decimal places");
  }
  return normalized;
}

function parseScaled(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * FACTOR + BigInt(fraction.padEnd(Number(SCALE), "0") || "0");
}

function formatScaled(value: bigint): string {
  if (value < 0n) throw new Error("scaled decimal cannot be negative");
  const whole = value / FACTOR;
  const fraction = (value % FACTOR).toString().padStart(Number(SCALE), "0");
  return `${whole}.${fraction}`;
}

function multiplyDecimals(left: string, right: string): string {
  return formatScaled((parseScaled(left) * parseScaled(right)) / FACTOR);
}

function addDecimals(left: string, right: string): string {
  return formatScaled(parseScaled(left) + parseScaled(right));
}
