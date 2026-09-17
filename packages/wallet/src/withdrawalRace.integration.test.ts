import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, postJournal } from "@tradeshark/database";
import {
  approveWithdrawalAtomically,
  confirmWithdrawalAtomically,
  failWithdrawalAtomically,
  requestWithdrawalAtomically,
  submitWithdrawalAtomically
} from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

async function seedWithdrawal(amount: string) {
  if (!client) throw new Error("DATABASE_URL is required");
  const userId = randomUUID();
  const assetId = randomUUID();
  const availableId = randomUUID();
  const lockedId = randomUUID();
  const pendingId = randomUUID();
  const externalId = randomUUID();
  const withdrawalId = randomUUID();
  const seedKey = `wallet:withdrawal-race:${randomUUID()}`;

  await client.pool.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [
    userId,
    `${userId}@wallet.race.test`,
    `race_${userId.replaceAll("-", "")}`
  ]);
  await client.pool.query(
    `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`,
    [assetId, `R${assetId.slice(0, 4).toUpperCase()}`, "Withdrawal Race Asset"]
  );
  await client.pool.query(
    `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
      ($1, $2, $3, 'USER_AVAILABLE', $4),
      ($5, $2, $3, 'USER_LOCKED', $6),
      ($7, $2, $3, 'USER_PENDING_WITHDRAWAL', $8),
      ($9, NULL, $3, 'EXTERNAL_SETTLEMENT', $10)`,
    [
      availableId, userId, assetId, `race-available:${availableId}`,
      lockedId, `race-locked:${lockedId}`,
      pendingId, `race-pending:${pendingId}`,
      externalId, `race-external:${externalId}`
    ]
  );
  await client.pool.query(
    `INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0), ($3, 0, 0), ($4, 0, 0)`,
    [availableId, lockedId, pendingId, externalId]
  );
  await postJournal(client.db, {
    transactionId: randomUUID(),
    idempotencyKey: seedKey,
    referenceType: "wallet_withdrawal_race_seed",
    referenceId: withdrawalId,
    entries: [
      { accountId: externalId, direction: "debit", amount: "100" },
      { accountId: availableId, direction: "credit", amount: "100" }
    ]
  });
  await client.pool.query(
    `INSERT INTO withdrawals (id, user_id, asset_id, pending_account_id, amount, status, destination) VALUES ($1, $2, $3, $4, $5, 'requested', 'race-destination')`,
    [withdrawalId, userId, assetId, pendingId, amount]
  );
  await requestWithdrawalAtomically(client.db, withdrawalId);
  return { userId, assetId, availableId, lockedId, pendingId, externalId, withdrawalId, seedKey };
}

async function cleanup(seed: Awaited<ReturnType<typeof seedWithdrawal>>) {
  if (!client) return;
  await client.pool.query(`DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = $1 OR reference_type = 'wallet_withdrawal_race_seed')`, [seed.withdrawalId]);
  await client.pool.query(`DELETE FROM journal_transactions WHERE reference_id = $1 OR idempotency_key = $2`, [seed.withdrawalId, seed.seedKey]);
  await client.pool.query(`DELETE FROM withdrawals WHERE id = $1`, [seed.withdrawalId]);
  await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[seed.availableId, seed.lockedId, seed.pendingId, seed.externalId]]);
  await client.pool.query(`DELETE FROM ledger_accounts WHERE asset_id = $1`, [seed.assetId]);
  await client.pool.query(`DELETE FROM assets WHERE id = $1`, [seed.assetId]);
  await client.pool.query(`DELETE FROM users WHERE id = $1`, [seed.userId]);
}

integration("PostgreSQL withdrawal lifecycle race integration", () => {
  afterAll(async () => { await client?.pool.end(); });

  it("allows approval and failure to serialize without double-moving funds", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const seed = await seedWithdrawal("7");
    try {
      const results = await Promise.allSettled([
        approveWithdrawalAtomically(client.db, seed.withdrawalId),
        failWithdrawalAtomically(client.db, seed.withdrawalId)
      ]);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
      const state = await client.pool.query(`SELECT status FROM withdrawals WHERE id = $1`, [seed.withdrawalId]);
      const status = state.rows[0].status;
      expect(["approved", "failed"]).toContain(status);
      const balances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[seed.availableId, seed.lockedId, seed.pendingId]]);
      const byAccount = new Map(balances.rows.map((row) => [row.account_id, row.balance]));
      if (status === "approved") {
        expect(byAccount.get(seed.availableId)).toBe("93.000000000000000000");
        expect(byAccount.get(seed.lockedId)).toBe("7.000000000000000000");
      } else {
        expect(byAccount.get(seed.availableId)).toBe("100.000000000000000000");
        expect(byAccount.get(seed.lockedId)).toBe("0.000000000000000000");
      }
      expect(byAccount.get(seed.pendingId)).toBe("0.000000000000000000");
    } finally { await cleanup(seed); }
  });

  it("serializes submission and failure without inconsistent locked or pending balances", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const seed = await seedWithdrawal("9");
    try {
      await approveWithdrawalAtomically(client.db, seed.withdrawalId);
      const results = await Promise.allSettled([
        submitWithdrawalAtomically(client.db, seed.withdrawalId),
        failWithdrawalAtomically(client.db, seed.withdrawalId)
      ]);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const state = await client.pool.query(`SELECT status FROM withdrawals WHERE id = $1`, [seed.withdrawalId]);
      const status = state.rows[0].status;
      expect(["submitted", "failed"]).toContain(status);
      const balances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[seed.availableId, seed.lockedId, seed.pendingId]]);
      const byAccount = new Map(balances.rows.map((row) => [row.account_id, row.balance]));
      if (status === "submitted") {
        expect(byAccount.get(seed.availableId)).toBe("91.000000000000000000");
        expect(byAccount.get(seed.lockedId)).toBe("0.000000000000000000");
        expect(byAccount.get(seed.pendingId)).toBe("9.000000000000000000");
      } else {
        expect(byAccount.get(seed.availableId)).toBe("100.000000000000000000");
        expect(byAccount.get(seed.lockedId)).toBe("0.000000000000000000");
        expect(byAccount.get(seed.pendingId)).toBe("0.000000000000000000");
      }
    } finally { await cleanup(seed); }
  });

  it("serializes concurrent failure and confirmation from submitted without double settlement", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const seed = await seedWithdrawal("11");
    try {
      await approveWithdrawalAtomically(client.db, seed.withdrawalId);
      await submitWithdrawalAtomically(client.db, seed.withdrawalId);
      const results = await Promise.allSettled([
        failWithdrawalAtomically(client.db, seed.withdrawalId),
        confirmWithdrawalAtomically(client.db, seed.withdrawalId)
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const state = await client.pool.query(`SELECT status FROM withdrawals WHERE id = $1`, [seed.withdrawalId]);
      const status = state.rows[0].status;
      expect(["failed", "confirmed"]).toContain(status);
      const balances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[seed.availableId, seed.lockedId, seed.pendingId]]);
      const byAccount = new Map(balances.rows.map((row) => [row.account_id, row.balance]));
      if (status === "failed") {
        expect(byAccount.get(seed.availableId)).toBe("100.000000000000000000");
        expect(byAccount.get(seed.lockedId)).toBe("0.000000000000000000");
        expect(byAccount.get(seed.pendingId)).toBe("0.000000000000000000");
      } else {
        expect(byAccount.get(seed.availableId)).toBe("89.000000000000000000");
        expect(byAccount.get(seed.lockedId)).toBe("0.000000000000000000");
        expect(byAccount.get(seed.pendingId)).toBe("0.000000000000000000");
      }
    } finally { await cleanup(seed); }
  });
});
