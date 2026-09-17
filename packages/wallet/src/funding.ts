import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import {
  deposits,
  journalTransactions,
  ledgerAccounts,
  postJournalInTransaction,
  withdrawals
} from "@tradeshark/database";

async function findJournalTransactionId(
  db: Pick<TradeSharkDatabase, "select">,
  idempotencyKey: string
): Promise<string> {
  const rows = await db
    .select({ id: journalTransactions.id })
    .from(journalTransactions)
    .where(eq(journalTransactions.idempotencyKey, idempotencyKey))
    .limit(1);

  const journal = rows[0];
  if (!journal) {
    throw new Error(`Ledger journal for ${idempotencyKey} was not found`);
  }
  return journal.id;
}

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

    const idempotencyKey = `deposit:${deposit.id}:credit`;
    if (deposit.status === "credited") {
      return {
        transactionId: await findJournalTransactionId(tx, idempotencyKey),
        idempotent: true
      };
    }
    if (deposit.status !== "confirmed") {
      throw new Error(`Deposit ${depositId} must be confirmed before crediting`);
    }

    const accounts = await tx
      .select({
        id: ledgerAccounts.id,
        userId: ledgerAccounts.userId,
        assetId: ledgerAccounts.assetId,
        accountType: ledgerAccounts.accountType
      })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, [deposit.pendingAccountId]))
      .limit(1);

    const pending = accounts[0];
    if (
      !pending ||
      pending.accountType !== "USER_PENDING_DEPOSIT" ||
      pending.userId !== deposit.userId ||
      pending.assetId !== deposit.assetId
    ) {
      throw new Error("Deposit pending ledger account does not match the deposit");
    }

    const availableRows = await tx
      .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType })
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
    if (!available || available.accountType !== "USER_AVAILABLE") {
      throw new Error("Required USER_AVAILABLE ledger account does not exist");
    }

    const result = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey,
      referenceType: "deposit_credit",
      referenceId: deposit.id,
      entries: [
        { accountId: deposit.pendingAccountId, direction: "debit", amount: deposit.amount },
        { accountId: available.id, direction: "credit", amount: deposit.amount }
      ]
    });

    if (result.idempotent) return result;

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
 * Locks available customer funds when a withdrawal enters the pending state.
 * The lifecycle update and ledger movement share one transaction.
 */
export async function requestWithdrawalAtomically(
  db: TradeSharkDatabase,
  withdrawalId: string
): Promise<{ transactionId: string; idempotent: boolean }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: withdrawals.id,
        userId: withdrawals.userId,
        assetId: withdrawals.assetId,
        amount: withdrawals.amount,
        status: withdrawals.status
      })
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1);

    const withdrawal = rows[0];
    if (!withdrawal) throw new Error(`Withdrawal ${withdrawalId} was not found`);

    const idempotencyKey = `withdrawal:${withdrawal.id}:lock`;
    if (withdrawal.status === "pending") {
      return {
        transactionId: await findJournalTransactionId(tx, idempotencyKey),
        idempotent: true
      };
    }
    if (withdrawal.status !== "requested") {
      throw new Error(`Withdrawal ${withdrawalId} must be requested before funds can be locked`);
    }

    const accounts = await tx
      .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, withdrawal.userId),
          eq(ledgerAccounts.assetId, withdrawal.assetId),
          inArray(ledgerAccounts.accountType, ["USER_AVAILABLE", "USER_LOCKED"])
        )
      );

    const available = accounts.find((account) => account.accountType === "USER_AVAILABLE");
    const locked = accounts.find((account) => account.accountType === "USER_LOCKED");
    if (!available || !locked) {
      throw new Error("Required USER_AVAILABLE and USER_LOCKED ledger accounts do not exist");
    }

    const result = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey,
      referenceType: "withdrawal_lock",
      referenceId: withdrawal.id,
      entries: [
        { accountId: available.id, direction: "debit", amount: withdrawal.amount },
        { accountId: locked.id, direction: "credit", amount: withdrawal.amount }
      ]
    });

    if (result.idempotent) return result;

    const updated = await tx
      .update(withdrawals)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(withdrawals.id, withdrawal.id), eq(withdrawals.status, "requested")))
      .returning({ id: withdrawals.id });

    if (updated.length !== 1) {
      throw new Error("Withdrawal lifecycle changed while funds were being locked");
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

    const idempotencyKey = `withdrawal:${withdrawal.id}:submit`;
    if (withdrawal.status === "submitted") {
      return {
        transactionId: await findJournalTransactionId(tx, idempotencyKey),
        idempotent: true
      };
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
      idempotencyKey,
      referenceType: "withdrawal_pending",
      referenceId: withdrawal.id,
      entries: [
        { accountId: locked.id, direction: "debit", amount: withdrawal.amount },
        { accountId: pending.id, direction: "credit", amount: withdrawal.amount }
      ]
    });

    if (result.idempotent) return result;

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

/**
 * Finalizes an externally submitted withdrawal. This records the movement out
 * of the customer's pending-withdrawal account into the platform's external
 * settlement account and advances submitted -> confirmed in one transaction.
 */
export async function confirmWithdrawalAtomically(
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

    const idempotencyKey = `withdrawal:${withdrawal.id}:confirm`;
    if (withdrawal.status === "confirmed") {
      return {
        transactionId: await findJournalTransactionId(tx, idempotencyKey),
        idempotent: true
      };
    }
    if (withdrawal.status !== "submitted") {
      throw new Error(`Withdrawal ${withdrawalId} must be submitted before confirmation`);
    }

    const pendingRows = await tx
      .select({
        id: ledgerAccounts.id,
        userId: ledgerAccounts.userId,
        assetId: ledgerAccounts.assetId,
        accountType: ledgerAccounts.accountType
      })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, withdrawal.pendingAccountId))
      .limit(1);

    const pending = pendingRows[0];
    if (
      !pending ||
      pending.accountType !== "USER_PENDING_WITHDRAWAL" ||
      pending.userId !== withdrawal.userId ||
      pending.assetId !== withdrawal.assetId
    ) {
      throw new Error("Withdrawal pending ledger account does not match the withdrawal");
    }

    const externalRows = await tx
      .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.assetId, withdrawal.assetId),
          eq(ledgerAccounts.accountType, "EXTERNAL_SETTLEMENT")
        )
      )
      .limit(1);

    const external = externalRows[0];
    if (!external || external.accountType !== "EXTERNAL_SETTLEMENT") {
      throw new Error("Required EXTERNAL_SETTLEMENT ledger account does not exist");
    }

    const result = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey,
      referenceType: "withdrawal_external_settlement",
      referenceId: withdrawal.id,
      entries: [
        { accountId: pending.id, direction: "debit", amount: withdrawal.amount },
        { accountId: external.id, direction: "credit", amount: withdrawal.amount }
      ]
    });

    if (result.idempotent) return result;

    const updated = await tx
      .update(withdrawals)
      .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(withdrawals.id, withdrawal.id), eq(withdrawals.status, "submitted")))
      .returning({ id: withdrawals.id });

    if (updated.length !== 1) {
      throw new Error("Withdrawal lifecycle changed while external settlement was being recorded");
    }

    return result;
  });
}

/**
 * Fails an in-flight withdrawal and atomically releases any customer funds
 * still held on the platform. For submitted withdrawals, the release comes
 * from USER_PENDING_WITHDRAWAL because the external settlement has not
 * completed successfully.
 */
export async function failWithdrawalAtomically(
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
    if (withdrawal.status === "failed") {
      const idempotencyKey = `withdrawal:${withdrawal.id}:fail`;
      return {
        transactionId: await findJournalTransactionId(tx, idempotencyKey),
        idempotent: true
      };
    }
    if (!["pending", "approved", "submitted"].includes(withdrawal.status)) {
      throw new Error(`Withdrawal ${withdrawalId} cannot be failed from ${withdrawal.status}`);
    }

    const idempotencyKey = `withdrawal:${withdrawal.id}:fail`;
    const sourceType = withdrawal.status === "submitted" ? "USER_PENDING_WITHDRAWAL" : "USER_LOCKED";
    const sourceRows = await tx
      .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, withdrawal.userId),
          eq(ledgerAccounts.assetId, withdrawal.assetId),
          eq(ledgerAccounts.accountType, sourceType)
        )
      )
      .limit(1);

    const source = sourceRows[0];
    const availableRows = await tx
      .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, withdrawal.userId),
          eq(ledgerAccounts.assetId, withdrawal.assetId),
          eq(ledgerAccounts.accountType, "USER_AVAILABLE")
        )
      )
      .limit(1);

    const available = availableRows[0];
    if (!source || source.accountType !== sourceType || !available) {
      throw new Error("Required withdrawal failure-release ledger accounts do not exist");
    }

    const result = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey,
      referenceType: "withdrawal_failure_release",
      referenceId: withdrawal.id,
      entries: [
        { accountId: source.id, direction: "debit", amount: withdrawal.amount },
        { accountId: available.id, direction: "credit", amount: withdrawal.amount }
      ]
    });

    if (result.idempotent) return result;

    const updated = await tx
      .update(withdrawals)
      .set({ status: "failed", failureReason: "withdrawal_failed", updatedAt: new Date() })
      .where(
        and(
          eq(withdrawals.id, withdrawal.id),
          inArray(withdrawals.status, ["pending", "approved", "submitted"])
        )
      )
      .returning({ id: withdrawals.id });

    if (updated.length !== 1) {
      throw new Error("Withdrawal lifecycle changed while failure release was being applied");
    }

    return result;
  });
}
