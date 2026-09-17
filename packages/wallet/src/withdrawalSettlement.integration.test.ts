import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, postJournal } from "@tradeshark/database";
import { approveWithdrawalAtomically, confirmWithdrawalWithSettlementAtomically, requestWithdrawalAtomically, submitWithdrawalAtomically } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

async function seedSubmittedWithdrawal() {
  if (!client) throw new Error("DATABASE_URL is required");
  const userId = randomUUID();
  const assetId = randomUUID();
  const availableId = randomUUID();
  const lockedId = randomUUID();
  const pendingId = randomUUID();
  const externalId = randomUUID();
  const withdrawalId = randomUUID();
  const seedKey = `wallet:withdrawal-settlement:${randomUUID()}`;

  await client.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [userId, `${userId}@wallet.settlement.test`, `settlement_${userId.replaceAll("-", "")}`]);
  await client.pool.query(`INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`, [assetId, `S${assetId.slice(0, 4).toUpperCase()}`, "Withdrawal Settlement Asset"]);
  await client.pool.query(`INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES ($1, $2, $3, 'USER_AVAILABLE', $4), ($5, $2, $3, 'USER_LOCKED', $6), ($7, $2, $3, 'USER_PENDING_WITHDRAWAL', $8), ($9, NULL, $3, 'EXTERNAL_SETTLEMENT', $10)`, [availableId, userId, assetId, `settlement-available:${availableId}`, lockedId, `settlement-locked:${lockedId}`, pendingId, `settlement-pending:${pendingId}`, externalId, `settlement-external:${externalId}`]);
  await client.pool.query(`INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0), ($3, 0, 0), ($4, 0, 0)`, [availableId, lockedId, pendingId, externalId]);
  await postJournal(client.db, { transactionId: randomUUID(), idempotencyKey: seedKey, referenceType: "wallet_withdrawal_settlement_seed", referenceId: withdrawalId, entries: [{ accountId: externalId, direction: "debit", amount: "50" }, { accountId: availableId, direction: "credit", amount: "50" }] });
  await client.pool.query(`INSERT INTO withdrawals (id, user_id, asset_id, pending_account_id, amount, status, destination) VALUES ($1, $2, $3, $4, 12, 'requested', 'settlement-destination')`, [withdrawalId, userId, assetId, pendingId]);
  await requestWithdrawalAtomically(client.db, withdrawalId);
  await approveWithdrawalAtomically(client.db, withdrawalId);
  await submitWithdrawalAtomically(client.db, withdrawalId);

  return { userId, assetId, availableId, lockedId, pendingId, externalId, withdrawalId, seedKey };
}

async function cleanup(seed: Awaited<ReturnType<typeof seedSubmittedWithdrawal>>) {
  if (!client) return;
  await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = $1 OR reference_type = 'wallet_withdrawal_settlement_seed')`, [seed.withdrawalId]);
  await client.pool.query(`DELETE FROM journal_transactions WHERE reference_id = $1 OR idempotency_key = $2`, [seed.withdrawalId, seed.seedKey]);
  await client.pool.query(`DELETE FROM withdrawals WHERE id = $1`, [seed.withdrawalId]);
  await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[seed.availableId, seed.lockedId, seed.pendingId, seed.externalId]]);
  await client.pool.query(`DELETE FROM ledger_accounts WHERE asset_id = $1`, [seed.assetId]);
  await client.pool.query(`DELETE FROM assets WHERE id = $1`, [seed.assetId]);
  await client.pool.query(`DELETE FROM users WHERE id = $1`, [seed.userId]);
}

integration("PostgreSQL withdrawal settlement evidence", () => {
  afterAll(async () => { await client?.pool.end(); });

  it("rejects direct confirmation without an external settlement reference at the database boundary", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const seed = await seedSubmittedWithdrawal();
    try {
      await expect(client.pool.query(`UPDATE withdrawals SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [seed.withdrawalId])).rejects.toThrow();
      const row = await client.pool.query(`SELECT status, external_reference, confirmed_at FROM withdrawals WHERE id = $1`, [seed.withdrawalId]);
      expect(row.rows[0]).toEqual({ status: "submitted", external_reference: null, confirmed_at: null });
    } finally { await cleanup(seed); }
  });

  it("records and reuses the settlement reference idempotently", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const seed = await seedSubmittedWithdrawal();
    const reference = `tx:${seed.withdrawalId}`;
    try {
      const confirmed = await confirmWithdrawalWithSettlementAtomically(client.db, seed.withdrawalId, reference);
      expect(confirmed.idempotent).toBe(false);
      const retry = await confirmWithdrawalWithSettlementAtomically(client.db, seed.withdrawalId, reference);
      expect(retry).toEqual({ transactionId: confirmed.transactionId, idempotent: true });
      await expect(confirmWithdrawalWithSettlementAtomically(client.db, seed.withdrawalId, "tx:different")).rejects.toThrow("does not match the retry");
      const row = await client.pool.query(`SELECT status, external_reference FROM withdrawals WHERE id = $1`, [seed.withdrawalId]);
      expect(row.rows[0]).toEqual({ status: "confirmed", external_reference: reference });
    } finally { await cleanup(seed); }
  });

  it("serializes concurrent confirmations so only one settlement reference can win", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const seed = await seedSubmittedWithdrawal();
    const firstReference = `tx:first:${seed.withdrawalId}`;
    const secondReference = `tx:second:${seed.withdrawalId}`;
    try {
      const results = await Promise.allSettled([
        confirmWithdrawalWithSettlementAtomically(client.db, seed.withdrawalId, firstReference),
        confirmWithdrawalWithSettlementAtomically(client.db, seed.withdrawalId, secondReference)
      ]);

      const fulfilled = results.filter((result): result is PromiseFulfilledResult<{ transactionId: string; idempotent: boolean }> => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(fulfilled[0]?.value.idempotent).toBe(false);

      const row = await client.pool.query(`SELECT status, external_reference FROM withdrawals WHERE id = $1`, [seed.withdrawalId]);
      expect(row.rows[0]?.status).toBe("confirmed");
      expect([firstReference, secondReference]).toContain(row.rows[0]?.external_reference);
    } finally { await cleanup(seed); }
  });

  it("treats concurrent confirmations with the same settlement reference as one idempotent operation", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const seed = await seedSubmittedWithdrawal();
    const reference = `tx:same:${seed.withdrawalId}`;
    try {
      const results = await Promise.all([
        confirmWithdrawalWithSettlementAtomically(client.db, seed.withdrawalId, reference),
        confirmWithdrawalWithSettlementAtomically(client.db, seed.withdrawalId, reference)
      ]);

      expect(results.map((result) => result.transactionId)).toEqual([results[0].transactionId, results[0].transactionId]);
      expect(results.filter((result) => !result.idempotent)).toHaveLength(1);
      expect(results.filter((result) => result.idempotent)).toHaveLength(1);

      const journalRows = await client.pool.query(`SELECT id, metadata->>'externalReference' AS external_reference FROM journal_transactions WHERE idempotency_key = $1`, [`withdrawal:${seed.withdrawalId}:confirm`]);
      expect(journalRows.rows).toHaveLength(1);
      expect(journalRows.rows[0]?.external_reference).toBe(reference);

      const row = await client.pool.query(`SELECT status, external_reference, confirmed_at FROM withdrawals WHERE id = $1`, [seed.withdrawalId]);
      expect(row.rows[0]?.status).toBe("confirmed");
      expect(row.rows[0]?.external_reference).toBe(reference);
      expect(row.rows[0]?.confirmed_at).not.toBeNull();
    } finally { await cleanup(seed); }
  });
});
