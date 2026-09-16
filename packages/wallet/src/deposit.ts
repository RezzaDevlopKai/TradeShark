import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import {
  deposits,
  journalTransactions,
  ledgerAccounts,
  postJournalInTransaction
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
  if (!journal) throw new Error(`Ledger journal for ${idempotencyKey} was not found`);
  return journal.id;
}

/**
 * Records an observed external deposit into the customer's pending-deposit
 * ledger account and advances pending -> confirmed atomically.
 *
 * The external provider remains the source of the blockchain/payment event;
 * TradeShark records that event in its double-entry ledger before the deposit
 * can be credited to USER_AVAILABLE.
 */
export async function confirmDepositAtomically(
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

    const idempotencyKey = `deposit:${deposit.id}:confirm`;
    if (deposit.status === "confirmed" || deposit.status === "credited") {
      return {
        transactionId: await findJournalTransactionId(tx, idempotencyKey),
        idempotent: true
      };
    }
    if (deposit.status !== "pending") {
      throw new Error(`Deposit ${depositId} must be pending before confirmation`);
    }

    const pendingRows = await tx
      .select({
        id: ledgerAccounts.id,
        userId: ledgerAccounts.userId,
        assetId: ledgerAccounts.assetId,
        accountType: ledgerAccounts.accountType
      })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, deposit.pendingAccountId))
      .limit(1);

    const pending = pendingRows[0];
    if (
      !pending ||
      pending.accountType !== "USER_PENDING_DEPOSIT" ||
      pending.userId !== deposit.userId ||
      pending.assetId !== deposit.assetId
    ) {
      throw new Error("Deposit pending ledger account does not match the deposit");
    }

    const externalRows = await tx
      .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.assetId, deposit.assetId),
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
      referenceType: "deposit_external_settlement",
      referenceId: deposit.id,
      entries: [
        { accountId: external.id, direction: "debit", amount: deposit.amount },
        { accountId: pending.id, direction: "credit", amount: deposit.amount }
      ]
    });

    const updated = await tx
      .update(deposits)
      .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(deposits.id, deposit.id), eq(deposits.status, "pending")))
      .returning({ id: deposits.id });

    if (updated.length !== 1) {
      throw new Error("Deposit lifecycle changed while external settlement was being recorded");
    }

    return result;
  });
}
