import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import {
  deposits,
  ledgerAccounts,
  postJournalInTransaction,
  withdrawals
} from "@tradeshark/database";

/**
 * Atomically settles a confirmed deposit into USER_AVAILABLE.
 *
 * The deterministic idempotency key makes retries safe. The lifecycle row and
 * ledger posting share one database transaction, so neither can commit alone.
 */
export async function creditDepositAtomically(
  db: TradeSharkDatabase,
  depositId: string
): Promise<{ transactionId: string; idempotent: boolean }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: deposits.id,
        userId: deposits.userId,
        assetId: deposits.assetId,
        pendingAccountId: deposits.pendingAccountId,
        amount: deposits.amount,
        status: deposits.status
      })
      .from(deposits)
      .where(eq(deposits.id, depositId))
      .limit(1);

    const deposit = rows[0];
    if (!deposit) throw new Error(`Deposit ${depositId} was not found`);
    if (deposit.status === "credited") {
      return { transactionId: deposit.id, idempotent: true };
    }
    if (deposit.status !== "confirmed") {
      throw new Error(`Deposit ${depositId} must be confirmed before crediting`);
    }

    const availableRows = await tx
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, deposit.userId),
          eq(ledgerAccounts.assetId, deposit.assetId),
          eq(ledgerAccounts.accountType, "USER_AVAILABLE")
        )
      )
      .limit(1);

    const available = availableRows[0];
    if (!available) throw new Error("Required USER_AVAILABLE ledger account does not exist");

    const result = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey: `deposit:${deposit.id}:credit`,
      referenceType: "deposit_credit",
      referenceId: deposit.id,
      entries: [
        { accountId: deposit.pendingAccountId, direction: "debit", amount: deposit.amount },
        { accountId: available.id, direction: "credit", amount: deposit.amount }
      ]
    });

    const updated = await tx
      .update(deposits)
      .set({ status: "credited", creditedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(deposits.id, deposit.id), eq(deposits.status, "confirmed")))
      .returning({ id: deposits.id });

    if (updated.length !== 1) {
      throw new Error("Deposit lifecycle changed while ledger settlement was being applied");
    }

    return result;
  });
}

/**
 * Atomically submits an approved withdrawal by moving locked funds into the
 * customer's pending-withdrawal account and advancing the lifecycle to
 * submitted. External settlement remains outside this function.
 */
export async function submitWithdrawalAtomically(
  db: TradeSharkDatabase,
  withdrawalId: string
): Promise<{ transactionId: string; idempotent: boolean }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: withdrawals.id,
        userId: withdrawals.userId,
        assetId: withdrawals.assetId,
        pendingAccountId: withdrawals.pendingAccountId,
        amount: withdrawals.amount,
        status: withdrawals.status
      })
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1);

    const withdrawal = rows[0];
    if (!withdrawal) throw new Error(`Withdrawal ${withdrawalId} was not found`);
    if (withdrawal.status === "submitted") {
      return { transactionId: withdrawal.id, idempotent: true };
    }
    if (withdrawal.status !== "approved") {
      throw new Error(`Withdrawal ${withdrawalId} must be approved before submission`);
    }

    const accounts = await tx
      .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, withdrawal.userId),
          eq(ledgerAccounts.assetId, withdrawal.assetId),
          inArray(ledgerAccounts.accountType, ["USER_LOCKED", "USER_PENDING_WITHDRAWAL"])
        )
      );

    const locked = accounts.find((account) => account.accountType === "USER_LOCKED");
    const pending = accounts.find((account) => account.id === withdrawal.pendingAccountId);
    if (!locked || !pending || pending.accountType !== "USER_PENDING_WITHDRAWAL") {
      throw new Error("Required withdrawal ledger accounts do not exist");
    }

    const result = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey: `withdrawal:${withdrawal.id}:submit`,
      referenceType: "withdrawal_pending",
      referenceId: withdrawal.id,
      entries: [
        { accountId: locked.id, direction: "debit", amount: withdrawal.amount },
        { accountId: pending.id, direction: "credit", amount: withdrawal.amount }
      ]
    });

    const updated = await tx
      .update(withdrawals)
      .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(withdrawals.id, withdrawal.id), eq(withdrawals.status, "approved")))
      .returning({ id: withdrawals.id });

    if (updated.length !== 1) {
      throw new Error("Withdrawal lifecycle changed while ledger settlement was being applied");
    }

    return result;
  });
}
