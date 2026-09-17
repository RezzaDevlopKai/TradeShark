import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, postJournal } from "@tradeshark/database";
import { cancelLimitOrder, placeLimitOrder } from "./index.js";
import { executeLimitOrder } from "./execution.ts";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

async function user(id: string, prefix: string) {
  await client!.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [id, `${id}@execution.integration.test`, `${prefix}_${id.replaceAll("-", "")}`]);
}

async function asset(id: string, symbol: string) {
  await client!.pool.query(`INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`, [id, `${symbol}${id.slice(0, 6).toUpperCase()}`, `${symbol} Execution Asset`]);
}

async function account(id: string, userId: string | null, assetId: string, type: string, projection = true) {
  await client!.pool.query(`INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES ($1, $2, $3, $4, $5)`, [id, userId, assetId, type, `execution:${id}`]);
  if (projection) await client!.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0)`, [id]);
}

async function seed(accountId: string, treasuryId: string, amount: string, key: string) {
  await postJournal(client!.db, {
    transactionId: randomUUID(),
    idempotencyKey: key,
    referenceType: "test_seed",
    metadata: { key },
    entries: [
      { accountId: treasuryId, direction: "debit", amount },
      { accountId, direction: "credit", amount }
    ]
  });
}

async function balance(accountId: string) {
  const result = await client!.pool.query(`SELECT balance::text AS balance FROM ledger_balance_projections WHERE account_id = $1`, [accountId]);
  return result.rows[0]?.balance;
}

async function journalBalance(accountId: string) {
  const result = await client!.pool.query(`SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text AS balance FROM journal_entries WHERE account_id = $1`, [accountId]);
  return result.rows[0]?.balance;
}

async function cleanup(input: { users: string[]; assets: string[]; market: string; accounts: string[]; orders: string[]; seeds: string[] }) {
  if (input.seeds.length) {
    await client!.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE idempotency_key = ANY($1::text[]))`, [input.seeds]);
    await client!.pool.query(`DELETE FROM journal_transactions WHERE idempotency_key = ANY($1::text[])`, [input.seeds]);
  }
  if (input.orders.length) await client!.pool.query(`DELETE FROM trades WHERE buy_order_id = ANY($1::uuid[]) OR sell_order_id = ANY($1::uuid[])`, [input.orders]);
  if (input.orders.length) await client!.pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [input.orders]);
  if (input.accounts.length) {
    await client!.pool.query(`DELETE FROM journal_entries WHERE account_id = ANY($1::uuid[])`, [input.accounts]);
    await client!.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [input.accounts]);
    await client!.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [input.accounts]);
  }
  await client!.pool.query(`DELETE FROM markets WHERE id = $1`, [input.market]);
  if (input.assets.length) await client!.pool.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [input.assets]);
  if (input.users.length) await client!.pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [input.users]);
}

afterAll(async () => client?.pool.end());

describe("PostgreSQL persistent execution integration", () => {
  it("matches a buy against the best sell, settles the ledger, persists the fee, and is safe to replay", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const buyerId = randomUUID(), sellerId = randomUUID(), baseId = randomUUID(), quoteId = randomUUID(), marketId = randomUUID();
    const buyerQuoteAvailable = randomUUID(), buyerQuoteLocked = randomUUID(), buyerBaseAvailable = randomUUID(), buyerBaseLocked = randomUUID();
    const sellerQuoteAvailable = randomUUID(), sellerQuoteLocked = randomUUID(), sellerBaseAvailable = randomUUID(), sellerBaseLocked = randomUUID();
    const quoteTreasury = randomUUID(), baseTreasury = randomUUID(), feeRevenue = randomUUID();
    const quoteSeed = `execution:quote:${randomUUID()}`, baseSeed = `execution:base:${randomUUID()}`;
    const orderIds: string[] = [];

    try {
      await user(buyerId, "buyer");
      await user(sellerId, "seller");
      await asset(baseId, "EXB");
      await asset(quoteId, "EXQ");
      await client.pool.query(`INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES ($1, $2, $3, $4, true)`, [marketId, `EXB/EXQ-${marketId.slice(0, 6)}`, baseId, quoteId]);
      await account(buyerQuoteAvailable, buyerId, quoteId, "USER_AVAILABLE");
      await account(buyerQuoteLocked, buyerId, quoteId, "USER_LOCKED");
      await account(buyerBaseAvailable, buyerId, baseId, "USER_AVAILABLE");
      await account(buyerBaseLocked, buyerId, baseId, "USER_LOCKED");
      await account(sellerQuoteAvailable, sellerId, quoteId, "USER_AVAILABLE");
      await account(sellerQuoteLocked, sellerId, quoteId, "USER_LOCKED");
      await account(sellerBaseAvailable, sellerId, baseId, "USER_AVAILABLE");
      await account(sellerBaseLocked, sellerId, baseId, "USER_LOCKED");
      await account(quoteTreasury, null, quoteId, "TREASURY", false);
      await account(baseTreasury, null, baseId, "TREASURY", false);
      await account(feeRevenue, null, quoteId, "FEE_REVENUE", false);
      await seed(buyerQuoteAvailable, quoteTreasury, "100", quoteSeed);
      await seed(sellerBaseAvailable, baseTreasury, "5", baseSeed);

      const sell = await placeLimitOrder(client.db, { userId: sellerId, marketId, side: "sell", price: "10", quantity: "1", clientOrderId: `sell-${sellerId}` });
      const buy = await placeLimitOrder(client.db, { userId: buyerId, marketId, side: "buy", price: "12", quantity: "1", clientOrderId: `buy-${buyerId}` });
      orderIds.push(sell.id, buy.id);

      expect(await balance(sellerBaseLocked)).toBe("1.000000000000000000");
      expect(await balance(buyerQuoteLocked)).toBe("12.066000000000000000");

      const execution = await executeLimitOrder(client.db, { orderId: buy.id });
      expect(execution.idempotent).toBe(false);
      expect(execution.status).toBe("filled");
      expect(execution.remainingQuantity).toBe("0.000000000000000000");
      expect(execution.trades).toHaveLength(1);
      expect(execution.trades[0]?.price).toBe("10.000000000000000000");
      expect(execution.trades[0]?.quantity).toBe("1.000000000000000000");
      expect(execution.trades[0]?.feeAmount).toBe("0.055000000000000000");
      expect(execution.trades[0]?.releasedQuoteAmount).toBe("2.011000000000000000");

      const persistedTrade = await client.pool.query(`SELECT price::text AS price, quantity::text AS quantity, fee_amount::text AS fee_amount FROM trades WHERE id = $1`, [execution.trades[0]!.tradeId]);
      expect(persistedTrade.rows[0]).toEqual({ price: "10.000000000000000000", quantity: "1.000000000000000000", fee_amount: "0.055000000000000000" });
      expect(await balance(buyerQuoteLocked)).toBe("0.000000000000000000");
      expect(await balance(buyerQuoteAvailable)).toBe("89.945000000000000000");
      expect(await balance(buyerBaseAvailable)).toBe("1.000000000000000000");
      expect(await balance(sellerBaseLocked)).toBe("0.000000000000000000");
      expect(await balance(sellerQuoteAvailable)).toBe("10.000000000000000000");
      expect(await journalBalance(feeRevenue)).toBe("0.055000000000000000");

      const replay = await executeLimitOrder(client.db, { orderId: buy.id });
      expect(replay.idempotent).toBe(true);
      expect(replay.trades).toHaveLength(0);
    } finally {
      await cleanup({ users: [buyerId, sellerId], assets: [baseId, quoteId], market: marketId, accounts: [buyerQuoteAvailable, buyerQuoteLocked, buyerBaseAvailable, buyerBaseLocked, sellerQuoteAvailable, sellerQuoteLocked, sellerBaseAvailable, sellerBaseLocked, quoteTreasury, baseTreasury, feeRevenue], orders: orderIds, seeds: [quoteSeed, baseSeed] });
    }
  });

  it("partially fills and releases the remaining reservation on cancellation", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const buyerId = randomUUID(), sellerId = randomUUID(), baseId = randomUUID(), quoteId = randomUUID(), marketId = randomUUID();
    const buyerQuoteAvailable = randomUUID(), buyerQuoteLocked = randomUUID(), buyerBaseAvailable = randomUUID(), buyerBaseLocked = randomUUID();
    const sellerQuoteAvailable = randomUUID(), sellerQuoteLocked = randomUUID(), sellerBaseAvailable = randomUUID(), sellerBaseLocked = randomUUID();
    const quoteTreasury = randomUUID(), baseTreasury = randomUUID(), feeRevenue = randomUUID();
    const quoteSeed = `execution:partial:quote:${randomUUID()}`, baseSeed = `execution:partial:base:${randomUUID()}`;
    const orderIds: string[] = [];

    try {
      await user(buyerId, "partialbuyer");
      await user(sellerId, "partialseller");
      await asset(baseId, "PXB");
      await asset(quoteId, "PXQ");
      await client.pool.query(`INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES ($1, $2, $3, $4, true);`, [marketId, `PXB/PXQ-${marketId.slice(0, 6)}`, baseId, quoteId]);
      await account(buyerQuoteAvailable, buyerId, quoteId, "USER_AVAILABLE");
      await account(buyerQuoteLocked, buyerId, quoteId, "USER_LOCKED");
      await account(buyerBaseAvailable, buyerId, baseId, "USER_AVAILABLE");
      await account(buyerBaseLocked, buyerId, baseId, "USER_LOCKED");
      await account(sellerQuoteAvailable, sellerId, quoteId, "USER_AVAILABLE");
      await account(sellerQuoteLocked, sellerId, quoteId, "USER_LOCKED");
      await account(sellerBaseAvailable, sellerId, baseId, "USER_AVAILABLE");
      await account(sellerBaseLocked, sellerId, baseId, "USER_LOCKED");
      await account(quoteTreasury, null, quoteId, "TREASURY", false);
      await account(baseTreasury, null, baseId, "TREASURY", false);
      await account(feeRevenue, null, quoteId, "FEE_REVENUE", false);
      await seed(buyerQuoteAvailable, quoteTreasury, "100", quoteSeed);
      await seed(sellerBaseAvailable, baseTreasury, "5", baseSeed);

      const sell = await placeLimitOrder(client.db, { userId: sellerId, marketId, side: "sell", price: "10", quantity: "1", clientOrderId: `partial-sell-${sellerId}` });
      const buy = await placeLimitOrder(client.db, { userId: buyerId, marketId, side: "buy", price: "12", quantity: "2", clientOrderId: `partial-buy-${buyerId}` });
      orderIds.push(sell.id, buy.id);
      expect(await balance(buyerQuoteLocked)).toBe("24.132000000000000000");

      const execution = await executeLimitOrder(client.db, { orderId: buy.id });
      expect(execution.status).toBe("partially_filled");
      expect(execution.remainingQuantity).toBe("1.000000000000000000");
      expect(execution.trades).toHaveLength(1);
      expect(execution.trades[0]?.feeAmount).toBe("0.055000000000000000");

      const cancel = await cancelLimitOrder(client.db, { userId: buyerId, orderId: buy.id });
      expect(cancel.status).toBe("cancelled");
      expect(await balance(buyerQuoteLocked)).toBe("0.000000000000000000");
      expect(await balance(buyerQuoteAvailable)).toBe("89.945000000000000000");
    } finally {
      await cleanup({ users: [buyerId, sellerId], assets: [baseId, quoteId], market: marketId, accounts: [buyerQuoteAvailable, buyerQuoteLocked, buyerBaseAvailable, buyerBaseLocked, sellerQuoteAvailable, sellerQuoteLocked, sellerBaseAvailable, sellerBaseLocked, quoteTreasury, baseTreasury, feeRevenue], orders: orderIds, seeds: [quoteSeed, baseSeed] });
    }
  });
});