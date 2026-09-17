import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { ledgerAccounts, markets, orders, trades } from "@tradeshark/database";
import { matchLimitOrder, normalizeDecimal } from "./engine.js";
import { settleTradeInTransaction } from "./settlement.js";

const ZERO = "0.000000000000000000";

type ExecuteLimitOrderInput = { orderId: string };
export type { ExecuteLimitOrderInput };

export type ExecutedTrade = {
  tradeId: string;
  buyOrderId: string;
  sellOrderId: string;
  price: string;
  quantity: string;
  feeAmount: string;
  releasedQuoteAmount: string;
};

export type ExecuteLimitOrderResult = {
  orderId: string;
  status: "open" | "partially_filled" | "filled" | "cancelled" | "rejected";
  remainingQuantity: string;
  trades: ExecutedTrade[];
  idempotent: boolean;
};

type TradeTransaction = Parameters<TradeSharkDatabase["transaction"]>[0] extends (tx: infer Tx) => unknown ? Tx : never;

export async function executeLimitOrder(db: TradeSharkDatabase, input: ExecuteLimitOrderInput): Promise<ExecuteLimitOrderResult> {
  if (!input.orderId.trim()) throw new Error("orderId is required");

  return db.transaction(async (tx) => {
    const initial = await tx.select({ marketId: orders.marketId }).from(orders).where(eq(orders.id, input.orderId)).limit(1);
    const initialOrder = initial[0];
    if (!initialOrder) throw new Error("Order does not exist");

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tradeshark:match:${initialOrder.marketId}`}, 0))`);

    const takerRows = await tx
      .select({ id: orders.id, userId: orders.userId, marketId: orders.marketId, side: orders.side, status: orders.status, quantity: orders.quantity, remainingQuantity: orders.remainingQuantity, limitPrice: orders.limitPrice, feeRate: orders.feeRate, sequence: orders.sequence })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update")
      .limit(1);
    const taker = takerRows[0];
    if (!taker) throw new Error("Order does not exist");

    if (taker.status === "cancelled" || taker.status === "rejected") return { orderId: taker.id, status: taker.status, remainingQuantity: taker.remainingQuantity, trades: [], idempotent: true };
    if (taker.status === "filled" || taker.remainingQuantity === ZERO || taker.remainingQuantity === "0") return { orderId: taker.id, status: "filled", remainingQuantity: ZERO, trades: [], idempotent: true };
    if (taker.status !== "open" && taker.status !== "partially_filled") throw new Error(`Order cannot be executed from status ${taker.status}`);
    if (!taker.limitPrice) throw new Error("Limit order price is required for execution");

    const marketRows = await tx.select({ id: markets.id, baseAssetId: markets.baseAssetId, quoteAssetId: markets.quoteAssetId, isActive: markets.isActive }).from(markets).where(eq(markets.id, taker.marketId)).limit(1);
    const market = marketRows[0];
    if (!market || !market.isActive) throw new Error("Trading market does not exist or is inactive");

    const makerSide = taker.side === "buy" ? "sell" : "buy";
    const makerPriceCondition = taker.side === "buy" ? lte(orders.limitPrice, taker.limitPrice) : gte(orders.limitPrice, taker.limitPrice);
    const makerOrderRows = await tx
      .select({ id: orders.id, userId: orders.userId, side: orders.side, status: orders.status, quantity: orders.quantity, remainingQuantity: orders.remainingQuantity, limitPrice: orders.limitPrice, feeRate: orders.feeRate, sequence: orders.sequence })
      .from(orders)
      .where(and(eq(orders.marketId, taker.marketId), eq(orders.side, makerSide), inArray(orders.status, ["open", "partially_filled"]), gt(orders.remainingQuantity, "0"), isNotNull(orders.limitPrice), makerPriceCondition, ne(orders.userId, taker.userId)))
      .orderBy(taker.side === "buy" ? asc(orders.limitPrice) : desc(orders.limitPrice), asc(orders.sequence), asc(orders.id))
      .for("update");

    const takerForMatcher = {
      id: taker.id, userId: taker.userId, side: taker.side,
      price: normalizeDecimal(taker.limitPrice), quantity: normalizeDecimal(taker.quantity), remainingQuantity: normalizeDecimal(taker.remainingQuantity), sequence: taker.sequence,
      status: taker.status === "partially_filled" ? "partially_filled" as const : "open" as const,
      feeRate: normalizeDecimal(taker.feeRate)
    };
    const makersForMatcher = makerOrderRows.map((maker) => ({
      id: maker.id, userId: maker.userId, side: maker.side,
      price: normalizeDecimal(maker.limitPrice!), quantity: normalizeDecimal(maker.quantity), remainingQuantity: normalizeDecimal(maker.remainingQuantity), sequence: maker.sequence,
      status: maker.status === "partially_filled" ? "partially_filled" as const : "open" as const,
      feeRate: normalizeDecimal(maker.feeRate)
    }));

    const match = matchLimitOrder(
      takerForMatcher,
      makersForMatcher,
      normalizeDecimal(taker.feeRate),
      (index, maker, quantity) => deterministicTradeId(taker.id, maker.id, maker.sequence, maker.remainingQuantity ?? maker.quantity, quantity, index)
    );

    const executedTrades: ExecutedTrade[] = [];
    for (const matched of match.trades) {
      const buyerOrder = matched.buyOrderId === taker.id ? takerForMatcher : makersForMatcher.find((row) => row.id === matched.buyOrderId);
      const sellerOrder = matched.sellOrderId === taker.id ? takerForMatcher : makersForMatcher.find((row) => row.id === matched.sellOrderId);
      if (!buyerOrder || !sellerOrder) throw new Error("Matched order was not loaded for settlement");

      const buyerAccounts = await getUserAccounts(tx, buyerOrder.userId, market.baseAssetId, market.quoteAssetId);
      const sellerAccounts = await getUserAccounts(tx, sellerOrder.userId, market.baseAssetId, market.quoteAssetId);
      const feeRows = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(and(eq(ledgerAccounts.assetId, market.quoteAssetId), eq(ledgerAccounts.accountType, "FEE_REVENUE"), isNull(ledgerAccounts.userId))).limit(1);
      const feeAccount = feeRows[0];
      if (!feeAccount) throw new Error("Quote fee revenue account does not exist");

      const settlement = await settleTradeInTransaction(tx, {
        tradeId: matched.id, marketId: market.id, price: matched.price, quantity: matched.quantity, feeRate: matched.feeRate, buyerLimitPrice: buyerOrder.price,
        buyerLockedQuoteAccountId: buyerAccounts.lockedQuote.id, buyerAvailableBaseAccountId: buyerAccounts.availableBase.id, buyerAvailableQuoteAccountId: buyerAccounts.availableQuote.id,
        sellerLockedBaseAccountId: sellerAccounts.lockedBase.id, sellerAvailableQuoteAccountId: sellerAccounts.availableQuote.id, feeRevenueQuoteAccountId: feeAccount.id
      });

      // Settlement is the canonical source of the fee actually posted to the ledger.
      const feeAmount = settlement.feeAmount;
      if (!feeAmount) throw new Error(`Trade ${matched.id} returned an empty settlement fee`);

      await tx.insert(trades).values({ id: matched.id, marketId: market.id, buyOrderId: matched.buyOrderId, sellOrderId: matched.sellOrderId, price: matched.price, quantity: matched.quantity, feeAmount });
      const executedTrade: ExecutedTrade = {
        tradeId: matched.id,
        buyOrderId: matched.buyOrderId,
        sellOrderId: matched.sellOrderId,
        price: matched.price,
        quantity: matched.quantity,
        feeAmount: feeAmount,
        releasedQuoteAmount: settlement.releasedQuoteAmount
      };
      executedTrades.push(executedTrade);
    }

    for (const maker of match.makerOrders) {
      await tx.update(orders).set({ remainingQuantity: maker.remainingQuantity, status: maker.status, updatedAt: new Date() }).where(eq(orders.id, maker.id));
    }

    const nextStatus = match.trades.length === 0 ? taker.status : match.takerRemaining === ZERO ? "filled" : "partially_filled";
    await tx.update(orders).set({ remainingQuantity: match.takerRemaining, status: nextStatus, updatedAt: new Date() }).where(eq(orders.id, taker.id));

    return { orderId: taker.id, status: nextStatus, remainingQuantity: match.takerRemaining, trades: executedTrades, idempotent: false };
  });
}

async function getUserAccounts(tx: TradeTransaction, userId: string, baseAssetId: string, quoteAssetId: string) {
  const rows = await tx.select({ id: ledgerAccounts.id, assetId: ledgerAccounts.assetId, accountType: ledgerAccounts.accountType }).from(ledgerAccounts).where(and(eq(ledgerAccounts.userId, userId), inArray(ledgerAccounts.assetId, [baseAssetId, quoteAssetId]), inArray(ledgerAccounts.accountType, ["USER_AVAILABLE", "USER_LOCKED"])));
  const find = (assetId: string, accountType: "USER_AVAILABLE" | "USER_LOCKED") => {
    const account = rows.find((row) => row.assetId === assetId && row.accountType === accountType);
    if (!account) throw new Error(`Missing ${accountType} account for user ${userId} and asset ${assetId}`);
    return account;
  };
  return { availableBase: find(baseAssetId, "USER_AVAILABLE"), lockedBase: find(baseAssetId, "USER_LOCKED"), availableQuote: find(quoteAssetId, "USER_AVAILABLE"), lockedQuote: find(quoteAssetId, "USER_LOCKED") };
}

function deterministicTradeId(takerOrderId: string, makerOrderId: string, makerSequence: number, makerRemainingQuantity: string, quantity: string, index: number): string {
  const payload = `trade:${takerOrderId}:${makerOrderId}:${makerSequence}:${makerRemainingQuantity}:${quantity}:${index}`;
  const bytes = Buffer.from(createHash("sha256").update(payload).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
