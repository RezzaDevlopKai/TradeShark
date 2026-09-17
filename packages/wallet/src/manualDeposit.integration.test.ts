import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@tradeshark/database";
import {
  approveManualDeposit,
  createManualDepositRequest,
  rejectManualDeposit
} from "./manualDeposit.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabase(databaseUrl) : null;

async function createWalletFixture() {
  if (!client) throw new Error("DATABASE_URL is required");

  const userId = randomUUID();
  const assetId = randomUUID();
  const externalId = randomUUID();
  const pendingId = randomUUID();
  const availableId = randomUUID();
  const lockedId = randomUUID();
  const pendingWithdrawalId = randomUUID();

  await client.pool.query(
    `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`,
    [userId, `${userId}@manual-deposit.integration.test`, `manual_${userId.replaceAll("-", "")}`]
  );
  await client.pool.query(
    `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES ($1, $2, $3, 18, true)`,
    [assetId, `M${assetId.slice(0, 5).toUpperCase()}`, "Manual Deposit Integration Asset"]
  );
  await client.pool.query(
    `INSERT INTO ledger_accounts (id, user_id, asset_id, account_type, code) VALUES
      ($1, NULL, $2, 'EXTERNAL_SETTLEMENT', $3),
      ($4, $5, $2, 'USER_PENDING_DEPOSIT', $6),
      ($7, $5, $2, 'USER_AVAILABLE', $8),
      ($9, $5, $2, 'USER_LOCKED', $10),
      ($11, $5, $2, 'USER_PENDING_WITHDRAWAL', $12)`,
    [
      externalId,
      assetId,
      `manual-external:${externalId}`,
      pendingId,
      userId,
      `manual-pending:${pendingId}`,
      availableId,
      `manual-available:${availableId}`,
      lockedId,
      `manual-locked:${lockedId}`,
      pendingWithdrawalId,
      `manual-withdrawal:${pendingWithdrawalId}`
    ]
  );
  await client.pool.query(
    `INSERT INTO ledger_balance_projections (account_id, balance, version) VALUES ($1, 0, 0), ($2, 0, 0), ($3, 0, 0)`,
    [pendingId, availableId, lockedId]
  );

  return { userId, assetId, externalId, pendingId, availableId, lockedId, pendingWithdrawalId };
}

async function cleanupWalletFixture(fixture: Awaited<ReturnType<typeof createWalletFixture>>, depositIds: string[]) {
  if (!client) return;
  if (depositIds.length > 0) {
    await client.pool.query(
      `DELETE FROM journal_entries WHERE transaction_id IN (SELECT id FROM journal_transactions WHERE reference_id = ANY($1::uuid[]))`,
      [depositIds]
    );
    await client.pool.query(`DELETE FROM journal_transactions WHERE reference_id = ANY($1::uuid[])`, [depositIds]);
    await client.pool.query(
      `DELETE FROM idempotency_keys WHERE key LIKE ANY($1::text[])`,
      [depositIds.flatMap((id) => [`deposit:${id}:confirm`, `deposit:${id}:credit`])]
    );
    await client.pool.query(`DELETE FROM deposits WHERE id = ANY($1::uuid[])`, [depositIds]);
  }
  await client.pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id = ANY($1::uuid[])`,
    [depositIds.length ? depositIds : [randomUUID()]]
  );
  await client.pool.query(
    `DELETE FROM audit_events WHERE entity_id = ANY($1::uuid[])`,
    [depositIds.length ? depositIds : [randomUUID()]]
  );
  await client.pool.query(`DELETE FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [
    [fixture.pendingId, fixture.availableId, fixture.lockedId]
  ]);
  await client.pool.query(`DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`, [
    [fixture.externalId, fixture.pendingId, fixture.availableId, fixture.lockedId, fixture.pendingWithdrawalId]
  ]);
  await client.pool.query(`DELETE FROM assets WHERE id = $1`, [fixture.assetId]);
  await client.pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
}

integration("PostgreSQL manual deposit lifecycle", () => {
  afterAll(async () => {
    await client?.pool.end();
  });

  it("creates a pending request, approves it, and records the complete audit/outbox trail", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const fixture = await createWalletFixture();
    const adminUserId = fixture.userId;
    const depositIds: string[] = [];

    try {
      const created = await createManualDepositRequest(client.db, {
        userId: fixture.userId,
        assetId: fixture.assetId,
        amount: "25.500000000000000000",
        note: "manual transfer"
      });
      depositIds.push(created.depositId);

      const pending = await client.pool.query(`SELECT status, amount::text, pending_account_id FROM deposits WHERE id = $1`, [created.depositId]);
      expect(pending.rows[0]).toEqual({
        status: "pending",
        amount: "25.500000000000000000",
        pending_account_id: fixture.pendingId
      });

      const availableBefore = await client.pool.query(`SELECT balance::text FROM ledger_balance_projections WHERE account_id = $1`, [fixture.availableId]);
      expect(availableBefore.rows[0].balance).toBe("0.000000000000000000");

      const approved = await approveManualDeposit(client.db, created.depositId, adminUserId, "bank transfer checked");
      expect(approved.idempotent).toBe(false);

      const state = await client.pool.query(`SELECT status, confirmed_at IS NOT NULL AS confirmed, credited_at IS NOT NULL AS credited FROM deposits WHERE id = $1`, [created.depositId]);
      expect(state.rows[0]).toEqual({ status: "credited", confirmed: true, credited: true });

      const balances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[fixture.pendingId, fixture.availableId, fixture.lockedId]]);
      const byAccount = new Map(balances.rows.map((row) => [row.account_id, row.balance]));
      expect(byAccount.get(fixture.pendingId)).toBe("0.000000000000000000");
      expect(byAccount.get(fixture.availableId)).toBe("25.500000000000000000");
      expect(byAccount.get(fixture.lockedId)).toBe("0.000000000000000000");

      const journals = await client.pool.query(`SELECT idempotency_key, count(*)::int AS count FROM journal_transactions WHERE reference_id = $1 GROUP BY idempotency_key ORDER BY idempotency_key`, [created.depositId]);
      expect(journals.rows).toEqual([
        { idempotency_key: `deposit:${created.depositId}:confirm`, count: 1 },
        { idempotency_key: `deposit:${created.depositId}:credit`, count: 1 }
      ]);

      const audit = await client.pool.query(`SELECT action, actor_type FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at`, [created.depositId]);
      expect(audit.rows).toEqual([
        { action: "deposit.requested", actor_type: "user" },
        { action: "deposit.approved", actor_type: "admin" }
      ]);

      const outbox = await client.pool.query(`SELECT event_type FROM outbox_events WHERE aggregate_id = $1 ORDER BY created_at`, [created.depositId]);
      expect(outbox.rows).toEqual([{ event_type: "deposit.created" }, { event_type: "deposit.approved" }]);
    } finally {
      await cleanupWalletFixture(fixture, depositIds);
    }
  });

  it("keeps concurrent admin approvals idempotent and credits exactly once", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const fixture = await createWalletFixture();
    const depositIds: string[] = [];

    try {
      const created = await createManualDepositRequest(client.db, {
        userId: fixture.userId,
        assetId: fixture.assetId,
        amount: "40"
      });
      depositIds.push(created.depositId);

      const results = await Promise.all([
        approveManualDeposit(client.db, created.depositId, fixture.userId),
        approveManualDeposit(client.db, created.depositId, fixture.userId)
      ]);

      expect(results.filter((result) => !result.idempotent)).toHaveLength(1);
      expect(results.filter((result) => result.idempotent)).toHaveLength(1);
      expect(results[0].transactionId).toBe(results[1].transactionId);

      const journalCount = await client.pool.query(
        `SELECT idempotency_key, count(*)::int AS count FROM journal_transactions WHERE reference_id = $1 GROUP BY idempotency_key`,
        [created.depositId]
      );
      expect(journalCount.rows).toHaveLength(2);
      expect(journalCount.rows.every((row) => row.count === 1)).toBe(true);

      const balance = await client.pool.query(`SELECT balance::text FROM ledger_balance_projections WHERE account_id = $1`, [fixture.availableId]);
      expect(balance.rows[0].balance).toBe("40.000000000000000000");

      const approvedEvents = await client.pool.query(`SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'deposit.approved'`, [created.depositId]);
      expect(approvedEvents.rows[0].count).toBe(1);
    } finally {
      await cleanupWalletFixture(fixture, depositIds);
    }
  });

  it("serializes concurrent approval and rejection so exactly one terminal outcome is committed", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const fixture = await createWalletFixture();
    const depositIds: string[] = [];

    try {
      const created = await createManualDepositRequest(client.db, {
        userId: fixture.userId,
        assetId: fixture.assetId,
        amount: "17.25"
      });
      depositIds.push(created.depositId);

      const results = await Promise.allSettled([
        approveManualDeposit(client.db, created.depositId, fixture.userId),
        rejectManualDeposit(client.db, created.depositId, fixture.userId, "payment not received")
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

      const state = await client.pool.query(`SELECT status FROM deposits WHERE id = $1`, [created.depositId]);
      const status = state.rows[0].status;
      expect(["credited", "failed"]).toContain(status);

      const journals = await client.pool.query(`SELECT idempotency_key, count(*)::int AS count FROM journal_transactions WHERE reference_id = $1 GROUP BY idempotency_key`, [created.depositId]);
      if (status === "credited") {
        expect(journals.rows).toHaveLength(2);
        expect(journals.rows.every((row) => row.count === 1)).toBe(true);
      } else {
        expect(journals.rows).toHaveLength(0);
      }

      const balances = await client.pool.query(`SELECT account_id, balance::text FROM ledger_balance_projections WHERE account_id = ANY($1::uuid[])`, [[fixture.pendingId, fixture.availableId]]);
      const byAccount = new Map(balances.rows.map((row) => [row.account_id, row.balance]));
      if (status === "credited") {
        expect(byAccount.get(fixture.pendingId)).toBe("0.000000000000000000");
        expect(byAccount.get(fixture.availableId)).toBe("17.250000000000000000");
      } else {
        expect(byAccount.get(fixture.pendingId)).toBe("0.000000000000000000");
        expect(byAccount.get(fixture.availableId)).toBe("0.000000000000000000");
      }
    } finally {
      await cleanupWalletFixture(fixture, depositIds);
    }
  });

  it("rejects a pending request without creating any ledger journal or balance change", async () => {
    if (!client) throw new Error("DATABASE_URL is required");
    const fixture = await createWalletFixture();
    const depositIds: string[] = [];

    try {
      const created = await createManualDepositRequest(client.db, {
        userId: fixture.userId,
        assetId: fixture.assetId,
        amount: "12.75"
      });
      depositIds.push(created.depositId);

      const rejected = await rejectManualDeposit(client.db, created.depositId, fixture.userId, "payment not received");
      expect(rejected).toEqual({ depositId: created.depositId, idempotent: false });

      const state = await client.pool.query(`SELECT status, failure_reason FROM deposits WHERE id = $1`, [created.depositId]);
      expect(state.rows[0]).toEqual({ status: "failed", failure_reason: "payment not received" });

      const journals = await client.pool.query(`SELECT count(*)::int AS count FROM journal_transactions WHERE reference_id = $1`, [created.depositId]);
      expect(journals.rows[0].count).toBe(0);

      const balance = await client.pool.query(`SELECT balance::text FROM ledger_balance_projections WHERE account_id = $1`, [fixture.availableId]);
      expect(balance.rows[0].balance).toBe("0.000000000000000000");

      const outbox = await client.pool.query(`SELECT event_type FROM outbox_events WHERE aggregate_id = $1 ORDER BY created_at`, [created.depositId]);
      expect(outbox.rows).toEqual([{ event_type: "deposit.created" }, { event_type: "deposit.rejected" }]);
    } finally {
      await cleanupWalletFixture(fixture, depositIds);
    }
  });
});
