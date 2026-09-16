import { and, eq, inArray } from "drizzle-orm";
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

type CancelLimitOrderInput = {
  userId: string;
  orderId: string;
};

export type { CancelLimitOrderInput };

export type CancelledOrder = {
  id: string;
  userId: string;
  marketId: string;
  side: "buy" | "sell";
  status: "cancelled";
  remainingQuantity: string;
  releasedAmount: string;
  releasedAssetId: string;
  releaseJournalTransactionId: string;
  idempotent: boolean;
};

/**
 * Cancels an open/partially-filled order and atomically releases its remaining
 * reservation from USER_LOCKED back to USER_AVAILABLE.
 *
 * The order row is locked before the state transition so a fill/cancel race
 * cannot release the same reservation twice. The ledger journal and order
 * update share one database transaction and therefore roll back together.
 */
export async function cancelLimitOrder(
  db: TradeSharkDatabase,
  input: CancelLimitOrderInput
): Promise<CancelledOrder> {
  if (!input.userId.trim()) throw new Error("userId is required");
  if (!input.orderId.trim()) throw new Error("orderId is required");

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: orders.id,
        userId: orders.userId,
        marketId: orders.marketId,
        side: orders.side,
        status: orders.status,
        quantity: orders.quantity,
        remainingQuantity: orders.remainingQuantity,
        limitPrice: orders.limitPrice,
        feeRate: orders.feeRate
      })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.userId, input.userId)))
      .for("update")
      .limit(1);

    const order = rows[0];
    if (!order) throw new Error("Order does not exist");

    const marketRows = await tx
      .select({ baseAssetId: markets.baseAssetId, quoteAssetId: markets.quoteAssetId, isActive: markets.isActive })
      .from(markets)
      .where(eq(markets.id, order.marketId))
      .limit(1);
    const market = marketRows[0];
    if (!market) throw new Error("Trading market does not exist");

    const releasedAssetId = order.side === "buy" ? market.quoteAssetId : market.baseAssetId;
    const reservationAmount = order.side === "buy"
      ? addDecimals(
          multiplyDecimals(order.limitPrice ?? "0", order.remainingQuantity),
          calculateFee(order.limitPrice ?? "0", order.remainingQuantity, order.feeRate)
        )
      : normalizeDecimal(order.remainingQuantity);

    const existingJournalRows = await tx
      .select({ id: journalTransactions.id })
      .from(journalTransactions)
      .where(eq(journalTransactions.idempotencyKey, `order:${order.id}:cancel`))
      .limit(1);
    const existingJournal = existingJournalRows[0];

    if (order.status === "cancelled") {
      if (!existingJournal) throw new Error("Cancelled order release journal was not found");
      return {
        id: order.id,
        userId: order.userId,
        marketId: order.marketId,
        side: order.side,
        status: "cancelled",
        remainingQuantity: order.remainingQuantity,
        releasedAmount: reservationAmount,
        releasedAssetId,
        releaseJournalTransactionId: existingJournal.id,
        idempotent: true
      };
    }

    if (order.status === "filled" || order.status === "rejected") {
      throw new Error(`Order cannot be cancelled from status ${order.status}`);
    }
    if (order.status !== "open" && order.status !== "partially_filled") {
      throw new Error(`Order cannot be cancelled from status ${order.status}`);
    }
    if (order.remainingQuantity === "0") {
      throw new Error("Filled order cannot be cancelled");
    }

    const accountRows = await tx
      .select({
        id: ledgerAccounts.id,
        assetId: ledgerAccounts.assetId,
        accountType: ledgerAccounts.accountType
      })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, order.userId),
          eq(ledgerAccounts.assetId, releasedAssetId),
          inArray(ledgerAccounts.accountType, ["USER_AVAILABLE", "USER_LOCKED"])
        )
      );

    const available = accountRows.find((account) => account.accountType === "USER_AVAILABLE");
    const locked = accountRows.find((account) => account.accountType === "USER_LOCKED");
    if (!available || !locked) throw new Error("Required USER_AVAILABLE and USER_LOCKED accounts do not exist");

    const journal = await postJournalInTransaction(tx, {
      transactionId: crypto.randomUUID(),
      idempotencyKey: `order:${order.id}:cancel`,
      referenceType: "order_cancellation",
      referenceId: order.id,
      metadata: {
        orderId: order.id,
        marketId: order.marketId,
        userId: order.userId,
        releasedAssetId,
        releasedAmount: reservationAmount
      },
      entries: [
        { accountId: locked.id, direction: "debit", amount: reservationAmount },
        { accountId: available.id, direction: "credit", amount: reservationAmount }
      ]
    });

    await tx
      .update(orders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    return {
      id: order.id,
      userId: order.userId,
      marketId: order.marketId,
      side: order.side,
      status: "cancelled",
      remainingQuantity: order.remainingQuantity,
      releasedAmount: reservationAmount,
      releasedAssetId,
      releaseJournalTransactionId: journal.transactionId,
      idempotent: journal.idempotent
    };
  });
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
