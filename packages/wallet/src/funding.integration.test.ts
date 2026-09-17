import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@tradeshark/database";
import {
  approveWithdrawalAtomically,
  confirmDepositAtomically,
  creditDepositAtomically,
  confirmWithdrawalWithSettlementAtomically,
  failWithdrawalAtomically,
  requestWithdrawalAtomically,
  submitWithdrawalAtomically
} from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

integration("PostgreSQL wallet funding integration", () => {
  afterAll(async () => {
    await client?.pool.end();
  });

  it("settles a deposit and keeps concurrent funding and approval retries idempotent", async () => {
    if (!client) throw new Error("DATABASE_URL is required");

    const userId = randomUUID();
    const assetId = randomUUID();
    const externalId = randomUUID();
    const pendingDepositId = randomUUID();
    const availableId = randomUUID();
    const lockedId = randomUUID();
    const pendingWithdrawalId = randomUUID();
    const depositId = randomUUID();
    const withdrawalId = randomUUID();
    const depositAmount = "25.00";
    const withdrawalAmount = "10.00";
    const settlementReference = `settlement:${withdrawalId}`;

    try {
      await client.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [userId, `${userId}@wallet.integration.test`, `wallet_${userId.replaceAll("-", "")}`]);
      await client.pool.query(`INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`, [assetId, `W${assetId.slice(0, 4).toUpperCase()}`, "Wallet Integration Asset"]);
      await client.pool.query(
        `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
          ($1, NULL, $2, 'EXTERNAL_SETTLEMENT', $3),
          ($4, $5, $2, 'USER_PENDING_DEPOSIT', $6),
          ($7, $5, $2, 'USER_AVAILABLE', $8),
          ($9, $5, $2, 'USER_LOCKED', $10),
          ($11, $5, $2, 'USER_PENDING_WITHDRAWAL', $12)`,
        [externalId, assetId, `wallet-external:${externalId}`, pendingDepositId, userId, `wallet-pending-deposit:${pendingDepositId}`, availableId, `wallet-available:${availableId}`, lockedId, `wallet-locked:${lockedId}`, pendingWithdrawalId, `wallet-pending-withdrawal:${pendingWithdrawalId}`]
      );
      await client.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0), ($3, 0, 0)`, [pendingDepositId, availableId, lockedId]);
      await client.pool.query(`INSERT INTO deposits (id, user_id, asset_id, pending_account_id, amount, status, external_reference) VALUES ($1, $2, $3, $4, $5, 'pending', $6)`, [depositId, userId, assetId, pendingDepositId, depositAmount, `deposit-ext:${depositId}`]);

      const confirmed = await confirmDepositAtomically(client.db, depositId);
      expect(confirmed.idempotent).toBe(false);

      const credits = await Promise.all([creditDepositAtomically(client.db, depositId), creditDepositAtomically(client.db, depositId)]);
      expect(credits.filter((result) => !result.idempotent)).toHaveLength(1);
      expect(credits.filter((result) => result.idempotent)).toHaveLength(1);
      expect(credits[0].transactionId).toBe(credits[1].transactionId);

      const journalCount = await client.pool.query(`SELECT count(*)::int AS count FROM journal_transactions WHERE idempotency_key = $1`, [`deposit:${depositId}:credit`]);
      expect(journalCount.rows[0].count).toBe(1);

      const balances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[pendingDepositId, availableId, lockedId]]);
      const balanceByAccount = new Map(balances.rows.map((row) => [row.account_id, row.balance]));
      expect(balanceByAccount.get(pendingDepositId)).toBe("0.000000000000000000");
      expect(balanceByAccount.get(availableId)).toBe("25.000000000000000000");
      expect(balanceByAccount.get(lockedId)).toBe("0.000000000000000000");

      await client.pool.query(`INSERT INTO withdrawals (id, user_id, asset_id, pending_account_id, amount, status, destination) VALUES ($1, $2, $3, $4, $5, 'requested', $6)`, [withdrawalId, userId, assetId, pendingWithdrawalId, withdrawalAmount, "integration-destination"]);
      const locked = await requestWithdrawalAtomically(client.db, withdrawalId);
      expect(locked.idempotent).toBe(false);

      const approvals = await Promise.all([
        approveWithdrawalAtomically(client.db, withdrawalId),
        approveWithdrawalAtomically(client.db, withdrawalId)
      ]);
      expect(approvals.filter((result) => !result.idempotent)).toHaveLength(1);
      expect(approvals.filter((result) => result.idempotent)).toHaveLength(1);
      expect(approvals).toEqual([
        { status: "approved", idempotent: approvals[0].idempotent },
        { status: "approved", idempotent: approvals[1].idempotent }
      ]);

      const submitted = await submitWithdrawalAtomically(client.db, withdrawalId);
      expect(submitted.idempotent).toBe(false);
      const confirmedWithdrawal = await confirmWithdrawalWithSettlementAtomically(client.db, withdrawalId, settlementReference);
      expect(confirmedWithdrawal.idempotent).toBe(false);
      const withdrawalRetry = await confirmWithdrawalWithSettlementAtomically(client.db, withdrawalId, settlementReference);
      expect(withdrawalRetry).toEqual({ transactionId: confirmedWithdrawal.transactionId, idempotent: true });
      const withdrawalStatus = await client.pool.query(`SELECT status, external_reference FROM withdrawals WHERE id = $1`, [withdrawalId]);
      expect(withdrawalStatus.rows[0]).toEqual({ status: "confirmed", external_reference: settlementReference });
      const finalBalances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[pendingDepositId, availableId, lockedId, pendingWithdrawalId]]);
      const finalByAccount = new Map(finalBalances.rows.map((row) => [row.account_id, row.balance]));
      expect(finalByAccount.get(availableId)).toBe("15.000000000000000000");
      expect(finalByAccount.get(lockedId)).toBe("0.000000000000000000");
      expect(finalByAccount.get(pendingWithdrawalId)).toBe("0.000000000000000000");
    } finally {
      await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id IN ($1, $2))`, [depositId, withdrawalId]);
      await client.pool.query(`DELETE FROM journal_transactions WHERE reference_id IN ($1, $2)`, [depositId, withdrawalId]);
      await client.pool.query(`DELETE FROM deposits WHERE id = $1`, [depositId]);
      await client.pool.query(`DELETE FROM withdrawals WHERE id = $1`, [withdrawalId]);
      await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[pendingDepositId, availableId, lockedId, pendingWithdrawalId]]);
      await client.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [[externalId, pendingDepositId, availableId, lockedId, pendingWithdrawalId]]);
      await client.pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);
      await client.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  it("releases locked funds when an approved withdrawal fails", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const userId = randomUUID(); const assetId = randomUUID(); const availableId = randomUUID(); const lockedId = randomUUID(); const pendingWithdrawalId = randomUUID(); const externalId = randomUUID(); const withdrawalId = randomUUID(); const seedTransactionId = randomUUID(); const seedKey = `wallet:seed:${randomUUID()}`;
    try {
      await client.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [userId, `${userId}@wallet.integration.test`, `fail_${userId.replaceAll("-", "")}`]);
      await client.pool.query(`INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`, [assetId, `F${assetId.slice(0, 4).toUpperCase()}`, "Wallet Failure Asset"]);
      await client.pool.query(`INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES ($1, $2, $3, 'USER_AVAILABLE', $4), ($5, $2, $3, 'USER_LOCKED', $6), ($7, $2, $3, 'USER_PENDING_WITHDRAWAL', $8), ($9, NULL, $3, 'EXTERNAL_SETTLEMENT', $10)`, [availableId, userId, assetId, `fail-available:${availableId}`, lockedId, `fail-locked:${lockedId}`, pendingWithdrawalId, `fail-pending:${pendingWithdrawalId}`, externalId, `fail-external:${assetId}`]);
      await client.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0)`, [availableId, lockedId]);
      await client.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0) ON CONFLICT (account_id) DO NOTHING`, [externalId]);
      const { postJournal } = await import("@tradeshark/database");
      await postJournal(client.db, { transactionId: seedTransactionId, idempotencyKey: seedKey, referenceType: "wallet_integration_seed", entries: [{ accountId: externalId, direction: "debit", amount: "20" }, { accountId: availableId, direction: "credit", amount: "20" }] });
      await client.pool.query(`INSERT INTO withdrawals (id, user_id, asset_id, pending_account_id, amount, status, destination) VALUES ($1, $2, $3, $4, 7, 'requested', 'integration-failure')`, [withdrawalId, userId, assetId, pendingWithdrawalId]);
      await requestWithdrawalAtomically(client.db, withdrawalId);
      const approved = await approveWithdrawalAtomically(client.db, withdrawalId);
      expect(approved).toEqual({ status: "approved", idempotent: false });
      const failed = await failWithdrawalAtomically(client.db, withdrawalId);
      expect(failed.idempotent).toBe(false);
      const retry = await failWithdrawalAtomically(client.db, withdrawalId);
      expect(retry).toEqual({ transactionId: failed.transactionId, idempotent: true });
      const state = await client.pool.query(`SELECT status, failure_reason FROM withdrawals WHERE id = $1`, [withdrawalId]);
      expect(state.rows[0]).toEqual({ status: "failed", failure_reason: "withdrawal_failed" });
      const balances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[availableId, lockedId]]);
      const byAccount = new Map(balances.rows.map((row) => [row.account_id, row.balance]));
      expect(byAccount.get(availableId)).toBe("20.000000000000000000");
      expect(byAccount.get(lockedId)).toBe("0.000000000000000000");
    } finally {
      await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = $1 OR reference_type = 'wallet_integration_seed')`, [withdrawalId]);
      await client.pool.query(`DELETE FROM journal_transactions WHERE reference_id = $1 OR idempotency_key = $2`, [withdrawalId, seedKey]);
      await client.pool.query(`DELETE FROM withdrawals WHERE id = $1`, [withdrawalId]);
      await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id IN (SELECT id FROM ledger_accounts WHERE asset_id = $1)`, [assetId]);
      await client.pool.query(`DELETE FROM ledger_accounts WHERE asset_id = $1`, [assetId]);
      await client.pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);
      await client.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });
});
