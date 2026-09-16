import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, postJournal } from "@tradeshark/database";
import { cancelLimitOrder, placeLimitOrder, settleTrade } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

async function insertUser(userId: string, prefix: string) {
  await client!.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [
    userId,
    `${userId}@trading.integration.test`,
    `${prefix}_${userId.replaceAll("-", "")}`
  ]);
}

async function insertAsset(assetId: string, symbolPrefix: string, name: string) {
  await client!.pool.query(
    `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`,
    [assetId, `${symbolPrefix}${assetId.slice(0, 6).toUpperCase()}`, name]
  );
}

async function insertAccount(id: string, userId: string | null, assetId: string, type: string, code: string, projection = true) {
  await client!.pool.query(
    `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, assetId, type, code]
  );
  if (projection) {
    await client!.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0)`, [id]);
  }
}

async function balance(accountId: string): Promise<string> {
  const result = await client!.pool.query(`SELECT balance::text FROM ledger_balance_projections WHERE account_id = $1`, [accountId]);
  return result.rows[0]?.balance;
}

integration("PostgreSQL trading integration", () => {
  afterAll(async () => {
    await client?.pool.end();
  });

  it("places a buy order, reserves funds atomically, and releases them on cancel", async () => {
    if (!client) throw new Error("DATABASE_URL is required");

    const userId = randomUUID();
    const baseAssetId = randomUUID();
    const quoteAssetId = randomUUID();
    const marketId = randomUUID();
    const availableId = randomUUID();
    const lockedId = randomUUID();
    const treasuryId = randomUUID();
    const seedKey = `trading:seed:${randomUUID()}`;
    let orderId: string | null = null;

    try {
      await insertUser(userId, "order");
      await insertAsset(baseAssetId, "B", "Trading Base Asset");
      await insertAsset(quoteAssetId, "Q", "Trading Quote Asset");
      await client.pool.query(`INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES ($1, $2, $3, $4, true)`, [marketId, `B/Q-${marketId.slice(0, 6)}`, baseAssetId, quoteAssetId]);
      await insertAccount(availableId, userId, quoteAssetId, "USER_AVAILABLE", `order-available:${availableId}`);
      await insertAccount(lockedId, userId, quoteAssetId, "USER_LOCKED", `order-locked:${lockedId}`);
      await insertAccount(treasuryId, null, quoteAssetId, "TREASURY", `order-treasury:${treasuryId}`, false);

      await postJournal(client.db, {
        transactionId: randomUUID(),
        idempotencyKey: seedKey,
        referenceType: "trading_integration_seed",
        entries: [
          { accountId: treasuryId, direction: "debit", amount: "100" },
          { accountId: availableId, direction: "credit", amount: "100" }
        ]
      });

      const placed = await placeLimitOrder(client.db, {
        userId,
        marketId,
        side: "buy",
        price: "10",
        quantity: "2",
        clientOrderId: `integration-${userId}`
      });
      orderId = placed.id;

      expect(placed.reservationAmount).toBe("20.110000000000000000");
      expect(await balance(availableId)).toBe("79.890000000000000000");
      expect(await balance(lockedId)).toBe("20.110000000000000000");

      const retry = await placeLimitOrder(client.db, {
        userId,
        marketId,
        side: "buy",
        price: "10",
        quantity: "2",
        clientOrderId: `integration-${userId}`
      });
      expect(retry.id).toBe(placed.id);
      expect(retry.idempotent).toBe(true);

      const cancelled = await cancelLimitOrder(client.db, { userId, orderId: placed.id });
      expect(cancelled.releasedAmount).toBe("20.110000000000000000");
      expect(await balance(availableId)).toBe("100.000000000000000000");
      expect(await balance(lockedId)).toBe("0.000000000000000000");
    } finally {
      if (orderId) {
        await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = $1)`, [orderId]);
        await client.pool.query(`DELETE FROM journal_transactions WHERE reference_id = $1`, [orderId]);
        await client.pool.query(`DELETE FROM idempotency_keys WHERE key LIKE $1`, [`order:${orderId}:%`]);
        await client.pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
      }
      await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE idempotency_key = $1)`, [seedKey]);
      await client.pool.query(`DELETE FROM journal_transactions WHERE idempotency_key = $1`, [seedKey]);
      await client.pool.query(`DELETE FROM idempotency_keys WHERE key = $1`, [seedKey]);
      await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[availableId, lockedId]]);
      await client.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [[availableId, lockedId, treasuryId]]);
      await client.pool.query(`DELETE FROM markets WHERE id = $1`, [marketId]);
      await client.pool.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [[baseAssetId, quoteAssetId]]);
      await client.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  it("settles a price-improved buy and returns the unused quote reservation", async () => {
    if (!client) throw new Error("DATABASE_URL is required");

    const buyerId = randomUUID();
    const sellerId = randomUUID();
    const baseAssetId = randomUUID();
    const quoteAssetId = randomUUID();
    const marketId = randomUUID();
    const buyerLockedQuoteId = randomUUID();
    const buyerAvailableQuoteId = randomUUID();
    const buyerAvailableBaseId = randomUUID();
    const sellerLockedBaseId = randomUUID();
    const sellerAvailableQuoteId = randomUUID();
    const quoteTreasuryId = randomUUID();
    const baseTreasuryId = randomUUID();
    const feeRevenueId = randomUUID();
    const tradeId = randomUUID();
    const seedQuoteKey = `trading:settlement:quote:${tradeId}`;
    const seedBaseKey = `trading:settlement:base:${tradeId}`;

    try {
      await insertUser(buyerId, "buyer");
      await insertUser(sellerId, "seller");
      await insertAsset(baseAssetId, "S", "Settlement Base Asset");
      await insertAsset(quoteAssetId, "T", "Settlement Quote Asset");
      await client.pool.query(`INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES ($1, $2, $3, $4, true)`, [marketId, `S/T-${marketId.slice(0, 6)}`, baseAssetId, quoteAssetId]);

      await insertAccount(buyerLockedQuoteId, buyerId, quoteAssetId, "USER_LOCKED", `settle-buyer-locked:${buyerLockedQuoteId}`);
      await insertAccount(buyerAvailableQuoteId, buyerId, quoteAssetId, "USER_AVAILABLE", `settle-buyer-available:${buyerAvailableQuoteId}`);
      await insertAccount(buyerAvailableBaseId, buyerId, baseAssetId, "USER_AVAILABLE", `settle-buyer-base:${buyerAvailableBaseId}`);
      await insertAccount(sellerLockedBaseId, sellerId, baseAssetId, "USER_LOCKED", `settle-seller-locked:${sellerLockedBaseId}`);
      await insertAccount(sellerAvailableQuoteId, sellerId, quoteAssetId, "USER_AVAILABLE", `settle-seller-quote:${sellerAvailableQuoteId}`);
      await insertAccount(quoteTreasuryId, null, quoteAssetId, "TREASURY", `settle-quote-treasury:${quoteTreasuryId}`, false);
      await insertAccount(baseTreasuryId, null, baseAssetId, "TREASURY", `settle-base-treasury:${baseTreasuryId}`, false);
      await insertAccount(feeRevenueId, null, quoteAssetId, "FEE_REVENUE", `settle-fee:${feeRevenueId}`, false);

      await postJournal(client.db, {
        transactionId: randomUUID(),
        idempotencyKey: seedQuoteKey,
        referenceType: "trading_settlement_seed",
        entries: [
          { accountId: quoteTreasuryId, direction: "debit", amount: "10.055" },
          { accountId: buyerLockedQuoteId, direction: "credit", amount: "10.055" }
        ]
      });
      await postJournal(client.db, {
        transactionId: randomUUID(),
        idempotencyKey: seedBaseKey,
        referenceType: "trading_settlement_seed",
        entries: [
          { accountId: baseTreasuryId, direction: "debit", amount: "1" },
          { accountId: sellerLockedBaseId, direction: "credit", amount: "1" }
        ]
      });

      const settled = await settleTrade(client.db, {
        tradeId,
        marketId,
        price: "9",
        quantity: "1",
        buyerLimitPrice: "10",
        buyerLockedQuoteAccountId: buyerLockedQuoteId,
        buyerAvailableQuoteAccountId: buyerAvailableQuoteId,
        buyerAvailableBaseAccountId: buyerAvailableBaseId,
        sellerLockedBaseAccountId: sellerLockedBaseId,
        sellerAvailableQuoteAccountId: sellerAvailableQuoteId,
        feeRevenueQuoteAccountId: feeRevenueId
      });

      expect(settled.feeAmount).toBe("0.049500000000000000");
      expect(settled.releasedQuoteAmount).toBe("1.005500000000000000");
      expect(await balance(buyerLockedQuoteId)).toBe("0.000000000000000000");
      expect(await balance(buyerAvailableQuoteId)).toBe("1.005500000000000000");
      expect(await balance(buyerAvailableBaseId)).toBe("1.000000000000000000");
      expect(await balance(sellerLockedBaseId)).toBe("0.000000000000000000");
      expect(await balance(sellerAvailableQuoteId)).toBe("9.000000000000000000");

      const retry = await settleTrade(client.db, {
        tradeId,
        marketId,
        price: "9",
        quantity: "1",
        buyerLimitPrice: "10",
        buyerLockedQuoteAccountId: buyerLockedQuoteId,
        buyerAvailableQuoteAccountId: buyerAvailableQuoteId,
        buyerAvailableBaseAccountId: buyerAvailableBaseId,
        sellerLockedBaseAccountId: sellerLockedBaseId,
        sellerAvailableQuoteAccountId: sellerAvailableQuoteId,
        feeRevenueQuoteAccountId: feeRevenueId
      });
      expect(retry).toEqual(settled);
      expect(retry.idempotent).toBe(true);
    } finally {
      await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = $1 OR idempotency_key IN ($2, $3))`, [tradeId, seedQuoteKey, seedBaseKey]);
      await client.pool.query(`DELETE FROM journal_transactions WHERE reference_id = $1 OR idempotency_key IN ($2, $3)`, [tradeId, seedQuoteKey, seedBaseKey]);
      await client.pool.query(`DELETE FROM idempotency_keys WHERE key LIKE $1 OR key IN ($2, $3)`, [`trade:${tradeId}:%`, seedQuoteKey, seedBaseKey]);
      await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[buyerLockedQuoteId, buyerAvailableQuoteId, buyerAvailableBaseId, sellerLockedBaseId, sellerAvailableQuoteId]]);
      await client.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [[buyerLockedQuoteId, buyerAvailableQuoteId, buyerAvailableBaseId, sellerLockedBaseId, sellerAvailableQuoteId, quoteTreasuryId, baseTreasuryId, feeRevenueId]]);
      await client.pool.query(`DELETE FROM markets WHERE id = $1`, [marketId]);
      await client.pool.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [[baseAssetId, quoteAssetId]]);
      await client.pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[buyerId, sellerId]]);
    }
  });
});
