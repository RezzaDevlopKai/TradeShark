import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { ledgerAccounts, markets, postJournalInTransaction } from "@tradeshark/database";
import { calculateFee, normalizeDecimal } from "./engine.js";

const SCALE = 18n;
const FACTOR = 10n ** SCALE;

type SettleTradeInput = {
  tradeId: string;
  marketId: string;
  price: string;
  quantity: string;
  feeRate?: string;
  buyerLimitPrice?: string;
  buyerLockedQuoteAccountId: string;
  buyerAvailableBaseAccountId: string;
  buyerAvailableQuoteAccountId?: string;
  sellerLockedBaseAccountId: string;
  sellerAvailableQuoteAccountId: string;
  feeRevenueQuoteAccountId: string;
};

export type { SettleTradeInput };

export type SettleTradeResult = {
  baseTransactionId: string;
  quoteTransactionId: string;
  feeAmount: string;
  releasedQuoteAmount: string;
  idempotent: boolean;
};

/**
 * Atomically settles one trade through two asset-specific double-entry journals.
 * The buyer pays the quote-currency trading fee. If execution occurs below the
 * buyer's limit price, the unused quote reservation (including its unused fee
 * reserve) is returned to USER_AVAILABLE in the same quote journal.
 */
export async function settleTrade(
  db: TradeSharkDatabase,
  input: SettleTradeInput
): Promise<SettleTradeResult> {
  if (!input.tradeId || !input.marketId) throw new Error("tradeId and marketId are required");

  const price = normalizeDecimal(input.price);
  const quantity = normalizeDecimal(input.quantity);
  const feeRate = normalizeDecimal(input.feeRate ?? "0.0055");
  const buyerLimitPrice = normalizeDecimal(input.buyerLimitPrice ?? price);
  if (parseScaled(buyerLimitPrice) < parseScaled(price)) {
    throw new Error("buyerLimitPrice cannot be below execution price");
  }

  const grossQuote = multiplyDecimals(price, quantity);
  const feeAmount = calculateFee(price, quantity, feeRate);
  const reservedGrossQuote = multiplyDecimals(buyerLimitPrice, quantity);
  const reservedFeeAmount = calculateFee(buyerLimitPrice, quantity, feeRate);
  const buyerDebit = addDecimals(grossQuote, feeAmount);
  const reservedBuyerDebit = addDecimals(reservedGrossQuote, reservedFeeAmount);
  const releasedQuoteAmount = subtractDecimals(reservedBuyerDebit, buyerDebit);

  return db.transaction(async (tx) => {
    const marketRows = await tx
      .select({ baseAssetId: markets.baseAssetId, quoteAssetId: markets.quoteAssetId, isActive: markets.isActive })
      .from(markets)
      .where(eq(markets.id, input.marketId))
      .limit(1);
    const market = marketRows[0];
    if (!market || !market.isActive) throw new Error("Trading market does not exist or is inactive");

    const accountIds = [
      input.buyerLockedQuoteAccountId,
      input.buyerAvailableBaseAccountId,
      input.sellerLockedBaseAccountId,
      input.sellerAvailableQuoteAccountId,
      input.feeRevenueQuoteAccountId,
      ...(input.buyerAvailableQuoteAccountId ? [input.buyerAvailableQuoteAccountId] : [])
    ];
    const accounts = await tx
      .select({ id: ledgerAccounts.id, assetId: ledgerAccounts.assetId, accountType: ledgerAccounts.accountType })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, accountIds));

    if (accounts.length !== new Set(accountIds).size) {
      throw new Error("All trade settlement ledger accounts must exist");
    }

    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const requireAccount = (id: string, assetId: string, accountType: "USER_AVAILABLE" | "USER_LOCKED" | "FEE_REVENUE") => {
      const account = accountById.get(id);
      if (!account || account.assetId !== assetId || account.accountType !== accountType) {
        throw new Error(`Invalid settlement ledger account ${id}`);
      }
    };

    requireAccount(input.buyerLockedQuoteAccountId, market.quoteAssetId, "USER_LOCKED");
    requireAccount(input.sellerAvailableQuoteAccountId, market.quoteAssetId, "USER_AVAILABLE");
    requireAccount(input.sellerLockedBaseAccountId, market.baseAssetId, "USER_LOCKED");
    requireAccount(input.buyerAvailableBaseAccountId, market.baseAssetId, "USER_AVAILABLE");
    requireAccount(input.feeRevenueQuoteAccountId, market.quoteAssetId, "FEE_REVENUE");
    if (releasedQuoteAmount !== "0.000000000000000000") {
      if (!input.buyerAvailableQuoteAccountId) {
        throw new Error("buyerAvailableQuoteAccountId is required when a quote reservation must be released");
      }
      requireAccount(input.buyerAvailableQuoteAccountId, market.quoteAssetId, "USER_AVAILABLE");
    }

    const base = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey: `trade:${input.tradeId}:base`,
      referenceType: "trade_settlement_base",
      referenceId: input.tradeId,
      metadata: { marketId: input.marketId, tradeId: input.tradeId, asset: "base" },
      entries: [
        { accountId: input.sellerLockedBaseAccountId, direction: "debit", amount: quantity },
        { accountId: input.buyerAvailableBaseAccountId, direction: "credit", amount: quantity }
      ]
    });

    const quoteEntries = [
      { accountId: input.buyerLockedQuoteAccountId, direction: "debit" as const, amount: reservedBuyerDebit },
      { accountId: input.sellerAvailableQuoteAccountId, direction: "credit" as const, amount: grossQuote },
      ...(feeAmount !== "0.000000000000000000"
        ? [{ accountId: input.feeRevenueQuoteAccountId, direction: "credit" as const, amount: feeAmount }]
        : []),
      ...(releasedQuoteAmount !== "0.000000000000000000"
        ? [{ accountId: input.buyerAvailableQuoteAccountId!, direction: "credit" as const, amount: releasedQuoteAmount }]
        : [])
    ];

    const quote = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey: `trade:${input.tradeId}:quote`,
      referenceType: "trade_settlement_quote",
      referenceId: input.tradeId,
      metadata: {
        marketId: input.marketId,
        tradeId: input.tradeId,
        asset: "quote",
        feeRate,
        buyerLimitPrice,
        releasedQuoteAmount
      },
      entries: quoteEntries
    });

    return {
      baseTransactionId: base.transactionId,
      quoteTransactionId: quote.transactionId,
      feeAmount,
      releasedQuoteAmount,
      idempotent: base.idempotent && quote.idempotent
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

function subtractDecimals(left: string, right: string): string {
  const result = parseScaled(left) - parseScaled(right);
  if (result < 0n) throw new Error("decimal subtraction would become negative");
  return formatScaled(result);
}
