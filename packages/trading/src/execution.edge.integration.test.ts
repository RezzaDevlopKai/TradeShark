import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, postJournal } from "@tradeshark/database";
import { cancelLimitOrder, placeLimitOrder } from "./index.js";
import { executeLimitOrder } from "./execution.ts";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

async function createUser(id: string, prefix: string) {
  await client!.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [id, `${id}@execution.edge.test`, `${prefix}_${id.replaceAll("-", "")}`]);
}

async function createAsset(id: string, symbol: string) {
  await client!.pool.query(`INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`, [id, `${symbol}${id.slice(0, 6).toUpperCase()}`, `${symbol} Edge Asset`]);
}

async function createAccount(id: string, userId: string | null, assetId: string, type: string, projection = true) {
  await client!.pool.query(`INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES ($1, $2, $3, $4, $5)`, [id, userId, assetId, type, `execution-edge:${id}`]);
  if (projection) await client!.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0)`, [id]);
}

async function balance(id: string) {
  const result = await client!.pool.query(`SELECT balance::text AS balance FROM ledger_balance_projections WHERE account_id = $1`, [id]);
  return result.rows[0]?.balance as string;
}

async function journalBalance(id: string) {
  const result = await client!.pool.query(`SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text AS balance FROM journal_entries WHERE account_id = $1`, [id]);
  return result.rows[0]?.balance as string;
}

async function seed(accountId: string, treasuryId: string, amount: string, key: string) {
  await postJournal(client!.db, { transactionId: randomUUID(), idempotencyKey: key, referenceType: "execution_edge_seed", entries: [{ accountId: treasuryId, direction: "debit", amount }, { accountId, direction: "credit", amount }] });
}

async function cleanup(ids: { users: string[]; assets: string[]; market: string; accounts: string[]; orders: string[]; seeds: string[] }) {
  if (!client) return;
  if (ids.orders.length) {
    await client.pool.query(`DELETE FROM trades WHERE buy_order_id = ANY($1::uuid[]) OR sell_order_id = ANY($1::uuid[])`, [ids.orders]);
    await client.pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids.orders]);
    await client.pool.query(`DELETE FROM idempotency_keys WHERE key LIKE ANY($1::text[])`, [ids.orders.map((id) => `order:${id}:%`)]);
  }
  if (ids.seeds.length) await client.pool.query(`DELETE FROM idempotency_keys WHERE key = ANY($1::text[])`, [ids.seeds]);
  if (ids.accounts.length) {
    await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [ids.accounts]);
    await client.pool.query(`WITH doomed AS (DELETE FROM journal_entries WHERE account_id = ANY($1::uuid[]) RETURNING transaction_id) DELETE FROM journal_transactions WHERE id IN (SELECT transaction_id FROM doomed)`, [ids.accounts]);
    await client.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [ids.accounts]);
  }
  await client.pool.query(`DELETE FROM markets WHERE id = $1`, [ids.market]);
  if (ids.assets.length) await client.pool.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [ids.assets]);
  if (ids.users.length) await client.pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids.users]);
}

integration("PostgreSQL execution edge integration", () => {
  afterAll(async () => client?.pool.end());

  it("settles a sell taker against the best buy and charges the buyer-side fee", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const buyerId = randomUUID(), sellerId = randomUUID(), baseId = randomUUID(), quoteId = randomUUID(), marketId = randomUUID();
    const buyerQuoteAvailable = randomUUID(), buyerQuoteLocked = randomUUID(), buyerBaseAvailable = randomUUID(), buyerBaseLocked = randomUUID();
    const sellerQuoteAvailable = randomUUID(), sellerQuoteLocked = randomUUID(), sellerBaseAvailable = randomUUID(), sellerBaseLocked = randomUUID();
    const quoteTreasury = randomUUID(), baseTreasury = randomUUID(), feeRevenue = randomUUID();
    const quoteSeed = `execution:edge:sell-taker:quote:${randomUUID()}`, baseSeed = `execution:edge:sell-taker:base:${randomUUID()}`;
    const orderIds: string[] = [];
    try {
      await createUser(buyerId, "buyer"); await createUser(sellerId, "seller"); await createAsset(baseId, "STB"); await createAsset(quoteId, "STQ");
      await client.pool.query(`INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES ($1, $2, $3, $4, true)`, [marketId, `STB/STQ-${marketId.slice(0, 6)}`, baseId, quoteId]);
      await createAccount(buyerQuoteAvailable, buyerId, quoteId, "USER_AVAILABLE"); await createAccount(buyerQuoteLocked, buyerId, quoteId, "USER_LOCKED"); await createAccount(buyerBaseAvailable, buyerId, baseId, "USER_AVAILABLE"); await createAccount(buyerBaseLocked, buyerId, baseId, "USER_LOCKED");
      await createAccount(sellerQuoteAvailable, sellerId, quoteId, "USER_AVAILABLE"); await createAccount(sellerQuoteLocked, sellerId, quoteId, "USER_LOCKED"); await createAccount(sellerBaseAvailable, sellerId, baseId, "USER_AVAILABLE"); await createAccount(sellerBaseLocked, sellerId, baseId, "USER_LOCKED");
      await createAccount(quoteTreasury, null, quoteId, "TREASURY", false); await createAccount(baseTreasury, null, baseId, "TREASURY", false); await createAccount(feeRevenue, null, quoteId, "FEE_REVENUE", false);
      await seed(buyerQuoteAvailable, quoteTreasury, "50", quoteSeed); await seed(sellerBaseAvailable, baseTreasury, "2", baseSeed);
      const buy = await placeLimitOrder(client.db, { userId: buyerId, marketId, side: "buy", price: "12", quantity: "1", clientOrderId: `edge-buy-${buyerId}` });
      const sell = await placeLimitOrder(client.db, { userId: sellerId, marketId, side: "sell", price: "10", quantity: "1", clientOrderId: `edge-sell-${sellerId}` });
      orderIds.push(buy.id, sell.id);
      expect(await balance(buyerQuoteLocked)).toBe("12.066000000000000000"); expect(await balance(sellerBaseLocked)).toBe("1.000000000000000000");
      const execution = await executeLimitOrder(client.db, { orderId: sell.id });
      expect(execution.status).toBe("filled"); expect(execution.trades).toHaveLength(1);
      expect(execution.trades[0]?.price).toBe("12.000000000000000000"); expect(execution.trades[0]?.quantity).toBe("1.000000000000000000"); expect(execution.trades[0]?.feeAmount).toBe("0.066000000000000000"); expect(execution.trades[0]?.releasedQuoteAmount).toBe("0.000000000000000000");
      expect(await balance(buyerQuoteLocked)).toBe("0.000000000000000000"); expect(await balance(buyerQuoteAvailable)).toBe("37.934000000000000000"); expect(await balance(buyerBaseAvailable)).toBe("1.000000000000000000"); expect(await balance(sellerBaseLocked)).toBe("0.000000000000000000"); expect(await balance(sellerQuoteAvailable)).toBe("12.000000000000000000"); expect(await journalBalance(feeRevenue)).toBe("0.066000000000000000");
    } finally {
      await cleanup({ users: [buyerId, sellerId], assets: [baseId, quoteId], market: marketId, accounts: [buyerQuoteAvailable, buyerQuoteLocked, buyerBaseAvailable, buyerBaseLocked, sellerQuoteAvailable, sellerQuoteLocked, sellerBaseAvailable, sellerBaseLocked, quoteTreasury, baseTreasury, feeRevenue], orders: orderIds, seeds: [quoteSeed, baseSeed] });
    }
  });

  it("leaves an unmatched order open with its reservation intact", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const buyerId = randomUUID(), baseId = randomUUID(), quoteId = randomUUID(), marketId = randomUUID();
    const buyerQuoteAvailable = randomUUID(), buyerQuoteLocked = randomUUID(), buyerBaseAvailable = randomUUID(), buyerBaseLocked = randomUUID();
    const quoteTreasury = randomUUID(), baseTreasury = randomUUID();
    const quoteSeed = `execution:edge:no-liquidity:quote:${randomUUID()}`;
    const orderIds: string[] = [];
    try {
      await createUser(buyerId, "noliquidity"); await createAsset(baseId, "NLB"); await createAsset(quoteId, "NLQ");
      await client.pool.query(`INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES ($1, $2, $3, $4, true)`, [marketId, `NLB/NLQ-${marketId.slice(0, 6)}`, baseId, quoteId]);
      await createAccount(buyerQuoteAvailable, buyerId, quoteId, "USER_AVAILABLE"); await createAccount(buyerQuoteLocked, buyerId, quoteId, "USER_LOCKED"); await createAccount(buyerBaseAvailable, buyerId, baseId, "USER_AVAILABLE"); await createAccount(buyerBaseLocked, buyerId, baseId, "USER_LOCKED");
      await createAccount(quoteTreasury, null, quoteId, "TREASURY", false); await createAccount(baseTreasury, null, baseId, "TREASURY", false);
      await seed(buyerQuoteAvailable, quoteTreasury, "25", quoteSeed);
      const buy = await placeLimitOrder(client.db, { userId: buyerId, marketId, side: "buy", price: "10", quantity: "2", clientOrderId: `edge-open-${buyerId}` });
      orderIds.push(buy.id); const execution = await executeLimitOrder(client.db, { orderId: buy.id });
      expect(execution.idempotent).toBe(false); expect(execution.status).toBe("open"); expect(execution.remainingQuantity).toBe("2.000000000000000000"); expect(execution.trades).toHaveLength(0);
      expect(await balance(buyerQuoteLocked)).toBe("20.110000000000000000"); expect(await balance(buyerQuoteAvailable)).toBe("4.890000000000000000");
      const cancelled = await cancelLimitOrder(client.db, { userId: buyerId, orderId: buy.id });
      expect(cancelled.releasedAmount).toBe("20.110000000000000000"); expect(await balance(buyerQuoteLocked)).toBe("0.000000000000000000"); expect(await balance(buyerQuoteAvailable)).toBe("25.000000000000000000");
    } finally {
      await cleanup({ users: [buyerId], assets: [baseId, quoteId], market: marketId, accounts: [buyerQuoteAvailable, buyerQuoteLocked, buyerBaseAvailable, buyerBaseLocked, quoteTreasury, baseTreasury], orders: orderIds, seeds: [quoteSeed] });
    }
  });

  it("rolls back execution when the fee revenue account is missing", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const buyerId = randomUUID(), sellerId = randomUUID(), baseId = randomUUID(), quoteId = randomUUID(), marketId = randomUUID();
    const buyerQuoteAvailable = randomUUID(), buyerQuoteLocked = randomUUID(), buyerBaseAvailable = randomUUID(), buyerBaseLocked = randomUUID();
    const sellerQuoteAvailable = randomUUID(), sellerQuoteLocked = randomUUID(), sellerBaseAvailable = randomUUID(), sellerBaseLocked = randomUUID();
    const quoteTreasury = randomUUID(), baseTreasury = randomUUID(), feeRevenue = randomUUID();
    const quoteSeed = `execution:edge:rollback:quote:${randomUUID()}`, baseSeed = `execution:edge:rollback:base:${randomUUID()}`;
    const orderIds: string[] = [];
    try {
      await createUser(buyerId, "rollbackbuyer"); await createUser(sellerId, "rollbackseller"); await createAsset(baseId, "RBB"); await createAsset(quoteId, "RBQ");
      await client.pool.query(`INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES ($1, $2, $3, $4, true)` , [marketId, `RBB/RBQ-${marketId.slice(0, 6)}`, baseId, quoteId]);
      await createAccount(buyerQuoteAvailable, buyerId, quoteId, "USER_AVAILABLE"); await createAccount(buyerQuoteLocked, buyerId, quoteId, "USER_LOCKED"); await createAccount(buyerBaseAvailable, buyerId, baseId, "USER_AVAILABLE"); await createAccount(buyerBaseLocked, buyerId, baseId, "USER_LOCKED");
      await createAccount(sellerQuoteAvailable, sellerId, quoteId, "USER_AVAILABLE"); await createAccount(sellerQuoteLocked, sellerId, quoteId, "USER_LOCKED"); await createAccount(sellerBaseAvailable, sellerId, baseId, "USER_AVAILABLE"); await createAccount(sellerBaseLocked, sellerId, baseId, "USER_LOCKED");
      await createAccount(quoteTreasury, null, quoteId, "TREASURY", false); await createAccount(baseTreasury, null, baseId, "TREASURY", false); await createAccount(feeRevenue, null, quoteId, "FEE_REVENUE", false);
      await seed(buyerQuoteAvailable, quoteTreasury, "25", quoteSeed); await seed(sellerBaseAvailable, baseTreasury, "1", baseSeed);
      const sell = await placeLimitOrder(client.db, { userId: sellerId, marketId, side: "sell", price: "10", quantity: "1", clientOrderId: `edge-rollback-sell-${sellerId}` });
      const buy = await placeLimitOrder(client.db, { userId: buyerId, marketId, side: "buy", price: "10", quantity: "1", clientOrderId: `edge-rollback-buy-${buyerId}` });
      orderIds.push(sell.id, buy.id); await client.pool.query(`DELETE FROM ledger_accounts WHERE id = $1`, [feeRevenue]);
      await expect(executeLimitOrder(client.db, { orderId: buy.id })).rejects.toThrow("Quote fee revenue account does not exist");
      const persisted = await client.pool.query(`SELECT status, remaining_quantity::text AS remaining_quantity FROM orders WHERE id = $1`, [buy.id]);
      const trades = await client.pool.query(`SELECT id FROM trades WHERE buy_order_id = $1 OR sell_order_id = $1`, [buy.id]);
      expect(persisted.rows[0]).toEqual({ status: "open", remaining_quantity: "1.000000000000000000" }); expect(trades.rows).toHaveLength(0); expect(await balance(buyerQuoteLocked)).toBe("10.055000000000000000"); expect(await balance(sellerBaseLocked)).toBe("1.000000000000000000");
    } finally {
      await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = $1`, [feeRevenue]); await client.pool.query(`DELETE FROM ledger_accounts WHERE id = $1`, [feeRevenue]);
      await cleanup({ users: [buyerId, sellerId], assets: [baseId, quoteId], market: marketId, accounts: [buyerQuoteAvailable, buyerQuoteLocked, buyerBaseAvailable, buyerBaseLocked, sellerQuoteAvailable, sellerQuoteLocked, sellerBaseAvailable, sellerBaseLocked, quoteTreasury, baseTreasury], orders: orderIds, seeds: [quoteSeed, baseSeed] });
    }
  });
});