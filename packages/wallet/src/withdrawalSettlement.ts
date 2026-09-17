import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import {
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

export type WithdrawalSettlementResult = {
  transactionId: string;
  idempotent: boolean;
};

/**
 * Finalizes a submitted withdrawal only when the caller supplies the external
 * settlement reference returned by the payment/network settlement system.
 *
 * The withdrawal row is locked for the duration of the transaction. This is
 * important because the ledger idempotency key is shared by all confirmation
 * retries: without row serialization, two concurrent callers with different
 * settlement references could both observe submitted before one commits.
 *
 * The reference, ledger movement, and lifecycle transition are committed in a
 * single database transaction. The database migration independently enforces
 * that a confirmed withdrawal cannot exist without an external reference.
 */
export async function confirmWithdrawalWithSettlementAtomically(
  db: TradeSharkDatabase,
  withdrawalId: string,
  externalReference: string
): Promise<WithdrawalSettlementResult> {
  const normalizedReference = externalReference.trim();
  if (!normalizedReference) {
    throw new Error("External settlement reference is required");
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: withdrawals.id,
        userId: withdrawals.userId,
        assetId: withdrawals.assetId,
        pendingAccountId: withdrawals.pendingAccountId,
        amount: withdrawals.amount,
        status: withdrawals.status,
        externalReference: withdrawals.externalReference
      })
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .for("update")
      .limit(1);

    const withdrawal = rows[0];
    if (!withdrawal) throw new Error(`Withdrawal ${withdrawalId} was not found`);

    const idempotencyKey = `withdrawal:${withdrawal.id}:confirm`;
    if (withdrawal.status === "confirmed") {
      if (withdrawal.externalReference !== normalizedReference) {
        throw new Error("Confirmed withdrawal settlement reference does not match the retry");
      }
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
      metadata: { externalReference: normalizedReference },
      entries: [
        { accountId: pending.id, direction: "debit", amount: withdrawal.amount },
        { accountId: external.id, direction: "credit", amount: withdrawal.amount }
      ]
    });

    if (result.idempotent) {
      const currentRows = await tx
        .select({ status: withdrawals.status, externalReference: withdrawals.externalReference })
        .from(withdrawals)
        .where(eq(withdrawals.id, withdrawal.id))
        .limit(1);
      const current = currentRows[0];
      if (current?.status === "confirmed" && current.externalReference === normalizedReference) {
        return { transactionId: result.transactionId, idempotent: true };
      }
      throw new Error("Withdrawal settlement journal exists without matching confirmed lifecycle state");
    }

    const updated = await tx
      .update(withdrawals)
      .set({
        status: "confirmed",
        externalReference: normalizedReference,
        confirmedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(withdrawals.id, withdrawal.id), eq(withdrawals.status, "submitted")))
      .returning({ id: withdrawals.id });

    if (updated.length !== 1) {
      throw new Error("Withdrawal lifecycle changed while external settlement was being recorded");
    }

    return result;
  });
}
