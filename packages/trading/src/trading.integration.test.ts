import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, postJournal } from "@tradeshark/database";
import { cancelLimitOrder, placeLimitOrder, settleTrade } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

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
    const orderId = randomUUID();
    const clientOrderId = `integration-${orderId}`;
    const seedKey = `trading:seed:${orderId}`;
    let placedId = "";

    try {
      await client.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [userId, `${userId}@trading.integration.test`, `trade_${userId.replaceAll("-", "")}`]);
      await client.pool.query(
        `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES
          ($1, $2, 'Trading Base Asset', 18, true),
          ($3, $4, 'Trading Quote Asset', 18, true)`,
        [baseAssetId, `B${baseAssetId.slice(0, 4).toUpperCase()}`, quoteAssetId, `Q${quoteAssetId.slice(0, 4).toUpperCase()}`]
      );
      await client.pool.query(
        `INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES ($1, $2, $3, $4, true)`,
        [marketId, `B${baseAssetId.slice(0, 4).toUpperCase()}/Q${quoteAssetId.slice(0, 4).toUpperCase()}`, baseAssetId, quoteAssetId]
      );
      await client.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
          ($1, $2, $3, 'USER_AVAILABLE', $4),
          ($5, $2, $3, 'USER_LOCKED', $6),
          ($7, NULL, $3, 'TREASURY', $8)`,
        [availableId, userId, quoteAssetId, `trading-available:${availableId}`, lockedId, `trading-locked:${lockedId}`, treasuryId, `trading-treasury:${treasuryId}`]
      );
      await client.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0)`, [availableId, lockedId]);

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
        clientOrderId
      });
      placedId = placed.id;

      expect(placed.status).toBe("open");
      expect(placed.reservationAmount).toBe("20.110000000000000000");
      expect(placed.reservationAssetId).toBe(quoteAssetId);

      const reserved = await client.pool.query(`SELECT balance::text FROM ledger_balance_projections WHERE account_id = $1`, [lockedId]);
      expect(reserved.rows[0].balance).toBe("20.110000000000000000");

      const retry = await placeLimitOrder(client.db, {
        userId,
        marketId,
        side: "buy",
        price: "10",
        quantity: "2",
        clientOrderId
      });
      expect(retry).toMatchObject({ id: placed.id, idempotent: true, reservationJournalTransactionId: placed.reservationJournalTransactionId });

      const cancelled = await cancelLimitOrder(client.db, { userId, orderId: placed.id });
      expect(cancelled.idempotent).toBe(false);
      expect(cancelled.releasedAmount).toBe("20.110000000000000000");

      const balances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[]) ORDER BY account_id`, [[availableId, lockedId]]);
      const byAccount = new Map(balances.rows.map((row) => [row.account_id, row.balance]));
      expect(byAccount.get(availableId)).toBe("100.000000000000000000");
      expect(byAccount.get(lockedId)).toBe("0.000000000000000000");
    } finally {
      if (placedId) {
        await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = $1)`, [placedId]);
        await client.pool.query(`DELETE FROM journal_transactions WHERE reference_id = $1`, [placedId]);
        await client.pool.query(`DELETE FROM idempotency_keys WHERE key LIKE $1`, [`order:${placedId}:%`]);
        await client.pool.query(`DELETE FROM orders WHERE id = $1`, [placedId]);
      }
      await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_type = 'trading_integration_seed' AND idempotency_key = $1)`, [seedKey]);
      await client.pool.query(`DELETE FROM journal_transactions WHERE idempotency_key = $1`, [seedKey]);
      await client.pool.query(`DELETE FROM idempotency_keys WHERE key = $1`, [seedKey]);
      await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[availableId, lockedId]]);
      await client.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [[availableId, lockedId, treasuryId]]);
      await client.pool.query(`DELETE FROM markets WHERE id = $1`, [marketId]);
      await client.pool.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [[baseAssetId, quoteAssetId]]);
      await client.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  it("settles at an improved execution price and returns unused buyer quote reservation", async () => {
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
    const seedQuoteKey = `trading:settlement:quote-seed:${tradeId}`;
    const seedBaseKey = `trading:settlement:base-seed:${tradeId}`;

    try {
      await client.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3), ($4, $5, $6)`, [buyerId, `${buyerId}@trading.integration.test`, `buyer_${buyerId.replaceAll("-", "")}`, sellerId, `${sellerId}@trading.integration.test`, `seller_${sellerId.replaceAll("-", "")}`]);
      await client.pool.query(
        `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES
          ($1, $2, 'Settlement Base Asset', 18, true),
          ($3, $4, 'Settlement Quote Asset', 18, true)`,
        [baseAssetId, `S${baseAssetId.slice(0, 4).toUpperCase()}`, quoteAssetId, `T${quoteAssetId.slice(0, 4).toUpperCase()}`]
      );
      await client.pool.query(`INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES ($1, $2, $3, $4, true)`, [marketId, `S${baseAssetId.slice(0, 4).toUpperCase()}/T${quoteAssetId.slice(0, 4).toUpperCase()}`, baseAssetId, quoteAssetId]);
      await client.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
          ($1, $2, $3, 'USER_LOCKED', $4),
          ($5, $2, $3, 'USER_AVAILABLE', $6),
          ($7, $2, $8, 'USER_AVAILABLE', $9),
          ($10, $11, $12, 'USER_LOCKED', $13),
          ($14, $11, $12, 'USER_AVAILABLE', $15),
          ($16, NULL, $3, 'TREASURY', $17),
          ($18, NULL, $12, 'TREASURY', $19),
          ($20, NULL, $3, 'FEE_REVENUE', $21)`,
        [buyerLockedQuoteId, buyerId, quoteAssetId, `settle-buyer-locked:${buyerLockedQuoteId}`, buyerAvailableQuoteId, buyerId, buyerAvailableBaseId, baseAssetId, `settle-buyer-base:${buyerAvailableBaseId}`, sellerLockedBaseId, sellerId, baseAssetId, `settle-seller-locked:${sellerLockedBaseId}`, sellerAvailableQuoteId, sellerId, `settle-seller-quote:${sellerAvailableQuoteId}`, quoteTreasuryId, `settle-quote-treasury:${quoteTreasuryId}`, baseTreasuryId, `settle-base-treasury:${baseTreasuryId}`, feeRevenueId, `settle-fee:${feeRevenueId}`]
      );
      await client.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0), ($3, 0, 0), ($4, 0, 0)`, [buyerLockedQuoteId, buyerAvailableQuoteId, buyerAvailableBaseId, sellerLockedBaseId]);

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
      expect(settled.idempotent).toBe(false);

      const balances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[]) ORDER BY account_id`, [[buyerLockedQuoteId, buyerAvailableQuoteId, buyerAvailableBaseId, sellerLockedBaseId, sellerAvailableQuoteId]]);
      const byAccount = new Map(balances.rows.map((row) => [row.account_id, row.balance]));
      expect(byAccount.get(buyerLockedQuoteId)).toBe("0.000000000000000000");
      expect(byAccount.get(buyerAvailableQuoteId)).toBe("1.005500000000000000");
      expect(byAccount.get(buyerAvailableBaseId)).toBe("1.000000000000000000");
      expect(byAccount.get(sellerLockedBaseId)).toBe("0.000000000000000000");
      expect(byAccount.get(sellerAvailableQuoteId)).toBe("9.000000000000000000");

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
      await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[buyerLockedQuoteId, buyerAvailableQuoteId, buyerAvailableBaseId, sellerLockedBaseId]]);
      await client.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [[buyerLockedQuoteId, buyerAvailableQuoteId, buyerAvailableBaseId, sellerLockedBaseId, sellerAvailableQuoteId, quoteTreasuryId, baseTreasuryId, feeRevenueId]]);
      await client.pool.query(`DELETE FROM markets WHERE id = $1`, [marketId]);
      await client.pool.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [[baseAssetId, quoteAssetId]]);
      await client.pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[buyerId, sellerId]]);
    }
  });
});
