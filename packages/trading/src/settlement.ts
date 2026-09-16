import { randomUUID } from "node:crypto";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { postJournalInTransaction } from "@tradeshark/database";
import { calculateFee, normalizeDecimal } from "./engine.js";

export type SettleTradeInput = {
  tradeId: string;
  marketId: string;
  price: string;
  quantity: string;
  feeRate?: string;
  buyerLockedQuoteAccountId: string;
  buyerAvailableBaseAccountId: string;
  sellerLockedBaseAccountId: string;
  sellerAvailableQuoteAccountId: string;
  feeRevenueQuoteAccountId: string;
};

export type SettleTradeResult = {
  baseTransactionId: string;
  quoteTransactionId: string;
  feeAmount: string;
  idempotent: boolean;
};

/**
 * Atomically settles one trade through two asset-specific double-entry journals.
 * The trading model charges the buyer in quote currency; this keeps the fee
 * asset consistent for both buy- and sell-takers until per-side fee assets exist.
 */
export async function settleTrade(
  db: TradeSharkDatabase,
  input: SettleTradeInput
): Promise<SettleTradeResult> {
  const price = normalizeDecimal(input.price);
  const quantity = normalizeDecimal(input.quantity);
  const feeRate = normalizeDecimal(input.feeRate ?? "0.0055");
  const feeAmount = calculateFee(price, quantity, feeRate);
  const grossQuote = normalizeDecimal(
    ((BigInt(price.replace(".", "")) * BigInt(quantity.replace(".", ""))) / 10n ** 18n).toString().padStart(19, "0")
  );

  if (!input.tradeId || !input.marketId) throw new Error("tradeId and marketId are required");

  return db.transaction(async (tx) => {
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
      { accountId: input.buyerLockedQuoteAccountId, direction: "debit" as const, amount: grossQuote },
      { accountId: input.sellerAvailableQuoteAccountId, direction: "credit" as const, amount: grossQuote }
    ];

    if (feeAmount !== "0.000000000000000000") {
      quoteEntries.push({
        accountId: input.feeRevenueQuoteAccountId,
        direction: "credit" as const,
        amount: feeAmount
      });
      quoteEntries[0] = {
        accountId: input.buyerLockedQuoteAccountId,
        direction: "debit" as const,
        amount: normalizeDecimal(addDecimals(grossQuote, feeAmount))
      };
    }

    const quote = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey: `trade:${input.tradeId}:quote`,
      referenceType: "trade_settlement_quote",
      referenceId: input.tradeId,
      metadata: { marketId: input.marketId, tradeId: input.tradeId, asset: "quote", feeRate },
      entries: quoteEntries
    });

    return {
      baseTransactionId: base.transactionId,
      quoteTransactionId: quote.transactionId,
      feeAmount,
      idempotent: base.idempotent && quote.idempotent
    };
  });
}

function addDecimals(left: string, right: string): string {
  const scale = 18n;
  const factor = 10n ** scale;
  const parse = (value: string) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * factor + BigInt(fraction.padEnd(Number(scale), "0") || "0");
  };
  const total = parse(left) + parse(right);
  const whole = total / factor;
  const fraction = (total % factor).toString().padStart(Number(scale), "0");
  return `${whole}.${fraction}`;
}
