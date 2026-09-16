import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
  buyerLockedQuoteAccountId: string;
  buyerAvailableBaseAccountId: string;
  sellerLockedBaseAccountId: string;
  sellerAvailableQuoteAccountId: string;
  feeRevenueQuoteAccountId: string;
};

export type { SettleTradeInput };

export type SettleTradeResult = {
  baseTransactionId: string;
  quoteTransactionId: string;
  feeAmount: string;
  idempotent: boolean;
};

/**
 * Atomically settles one trade through two asset-specific double-entry journals.
 * The buyer pays the quote-currency trading fee; both asset movements remain
 * separately balanced and account roles/assets are validated before posting.
 */
export async function settleTrade(
  db: TradeSharkDatabase,
  input: SettleTradeInput
): Promise<SettleTradeResult> {
  if (!input.tradeId || !input.marketId) throw new Error("tradeId and marketId are required");

  const price = normalizeDecimal(input.price);
  const quantity = normalizeDecimal(input.quantity);
  const feeRate = normalizeDecimal(input.feeRate ?? "0.0055");
  const grossQuote = formatScaled((parseScaled(price) * parseScaled(quantity)) / FACTOR);
  const feeAmount = calculateFee(price, quantity, feeRate);

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
      input.feeRevenueQuoteAccountId
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

    const buyerDebit = addDecimals(grossQuote, feeAmount);
    const quoteEntries = feeAmount === "0.000000000000000000"
      ? [
          { accountId: input.buyerLockedQuoteAccountId, direction: "debit" as const, amount: grossQuote },
          { accountId: input.sellerAvailableQuoteAccountId, direction: "credit" as const, amount: grossQuote }
        ]
      : [
          { accountId: input.buyerLockedQuoteAccountId, direction: "debit" as const, amount: buyerDebit },
          { accountId: input.sellerAvailableQuoteAccountId, direction: "credit" as const, amount: grossQuote },
          { accountId: input.feeRevenueQuoteAccountId, direction: "credit" as const, amount: feeAmount }
        ];

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

function addDecimals(left: string, right: string): string {
  return formatScaled(parseScaled(left) + parseScaled(right));
}
