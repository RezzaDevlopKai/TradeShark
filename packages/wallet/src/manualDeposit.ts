import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import {
  auditEvents,
  deposits,
  journalTransactions,
  ledgerAccounts,
  outboxEvents,
  postJournalInTransaction
} from "@tradeshark/database";

const MANUAL_REFERENCE_PREFIX = "manual-deposit:";

type ManualDepositInput = {
  userId: string;
  assetId: string;
  amount: string;
  note?: string;
};

function assertPositiveDecimal(amount: string): string {
  const normalized = amount.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error(`Invalid positive decimal amount: ${amount}`);

  const integerPart = match[1] ?? "";
  const fractionalPart = match[2] ?? "";
  if (/^0+$/.test(integerPart) && /^0*$/.test(fractionalPart)) {
    throw new Error(`Invalid positive decimal amount: ${amount}`);
  }

  return normalized;
}

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
 * Creates a manual deposit request without changing the customer's available
 * balance. A request is pending until an authorized admin reviews it.
 *
 * No proof image is stored. The generated external reference is the stable
 * manual-review identifier and can later be replaced by a provider reference
 * when automated funding is introduced.
 */
export async function createManualDepositRequest(
  db: TradeSharkDatabase,
  input: ManualDepositInput
): Promise<{ depositId: string; externalReference: string }> {
  const amount = assertPositiveDecimal(input.amount);
  const depositId = randomUUID();
  const externalReference = `${MANUAL_REFERENCE_PREFIX}${depositId}`;

  await db.transaction(async (tx) => {
    const accountRows = await tx
      .select({
        id: ledgerAccounts.id,
        userId: ledgerAccounts.userId,
        assetId: ledgerAccounts.assetId,
        accountType: ledgerAccounts.accountType
      })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, input.userId),
          eq(ledgerAccounts.assetId, input.assetId),
          eq(ledgerAccounts.accountType, "USER_PENDING_DEPOSIT")
        )
      )
      .limit(1);

    const pending = accountRows[0];
    if (!pending) {
      throw new Error("Required USER_PENDING_DEPOSIT ledger account does not exist");
    }

    await tx.insert(deposits).values({
      id: depositId,
      userId: input.userId,
      assetId: input.assetId,
      pendingAccountId: pending.id,
      amount,
      status: "pending",
      externalReference
    });

    const metadata = {
      source: "manual",
      ...(input.note === undefined ? {} : { note: input.note })
    };

    await tx.insert(auditEvents).values({
      id: randomUUID(),
      actorType: "user",
      actorUserId: input.userId,
      action: "deposit.requested",
      entityType: "deposit",
      entityId: depositId,
      after: { status: "pending", amount, assetId: input.assetId },
      metadata
    });

    await tx.insert(outboxEvents).values({
      id: randomUUID(),
      eventType: "deposit.created",
      aggregateType: "deposit",
      aggregateId: depositId,
      payload: {
        depositId,
        userId: input.userId,
        assetId: input.assetId,
        amount,
        externalReference,
        source: "manual"
      }
    });
  });

  return { depositId, externalReference };
}

/**
 * Approves a pending manual deposit in one database transaction.
 *
 * The two ledger movements are deliberately kept separate:
 * external settlement -> pending deposit -> available balance.
 * Both use deterministic idempotency keys, so a retried approval cannot
 * duplicate customer funds.
 */
export async function approveManualDeposit(
  db: TradeSharkDatabase,
  depositId: string,
  adminUserId: string,
  note?: string
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

    const confirmKey = `deposit:${deposit.id}:confirm`;
    const creditKey = `deposit:${deposit.id}:credit`;

    if (deposit.status === "credited") {
      return {
        transactionId: await findJournalTransactionId(tx, creditKey),
        idempotent: true
      };
    }
    if (deposit.status !== "pending" && deposit.status !== "confirmed") {
      throw new Error(`Deposit ${depositId} cannot be approved from ${deposit.status}`);
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
    if (!external) throw new Error("Required EXTERNAL_SETTLEMENT ledger account does not exist");

    const confirmResult = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey: confirmKey,
      referenceType: "deposit_manual_approval",
      referenceId: deposit.id,
      metadata: { adminUserId, source: "manual" },
      entries: [
        { accountId: external.id, direction: "debit", amount: deposit.amount },
        { accountId: pending.id, direction: "credit", amount: deposit.amount }
      ]
    });

    if (!confirmResult.idempotent) {
      const updated = await tx
        .update(deposits)
        .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(deposits.id, deposit.id), eq(deposits.status, "pending")))
        .returning({ id: deposits.id });

      if (updated.length !== 1) {
        throw new Error("Deposit lifecycle changed while confirmation was being applied");
      }

      await tx.insert(auditEvents).values({
        id: randomUUID(),
        actorType: "admin",
        actorUserId: adminUserId,
        action: "deposit.approved",
        entityType: "deposit",
        entityId: deposit.id,
        before: { status: "pending" },
        after: { status: "confirmed" },
        metadata: { source: "manual", ...(note === undefined ? {} : { note }) }
      });
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
    if (!available) throw new Error("Required USER_AVAILABLE ledger account does not exist");

    const creditResult = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey: creditKey,
      referenceType: "deposit_credit",
      referenceId: deposit.id,
      metadata: { adminUserId, source: "manual" },
      entries: [
        { accountId: pending.id, direction: "debit", amount: deposit.amount },
        { accountId: available.id, direction: "credit", amount: deposit.amount }
      ]
    });

    if (!creditResult.idempotent) {
      const updated = await tx
        .update(deposits)
        .set({ status: "credited", creditedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(deposits.id, deposit.id), eq(deposits.status, "confirmed")))
        .returning({ id: deposits.id });

      if (updated.length !== 1) {
        throw new Error("Deposit lifecycle changed while manual approval was being applied");
      }

      await tx.insert(outboxEvents).values({
        id: randomUUID(),
        eventType: "deposit.approved",
        aggregateType: "deposit",
        aggregateId: deposit.id,
        payload: {
          depositId: deposit.id,
          userId: deposit.userId,
          assetId: deposit.assetId,
          amount: deposit.amount,
          adminUserId,
          status: "credited"
        }
      });
    }

    return { transactionId: creditResult.transactionId, idempotent: creditResult.idempotent };
  });
}

/**
 * Rejects a pending manual deposit without touching the ledger balance.
 */
export async function rejectManualDeposit(
  db: TradeSharkDatabase,
  depositId: string,
  adminUserId: string,
  reason: string
): Promise<{ depositId: string; idempotent: boolean }> {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("A rejection reason is required");

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: deposits.id, status: deposits.status, userId: deposits.userId })
      .from(deposits)
      .where(eq(deposits.id, depositId))
      .limit(1);

    const deposit = rows[0];
    if (!deposit) throw new Error(`Deposit ${depositId} was not found`);
    if (deposit.status === "failed") return { depositId, idempotent: true };
    if (deposit.status !== "pending") {
      throw new Error(`Deposit ${depositId} cannot be rejected from ${deposit.status}`);
    }

    const updated = await tx
      .update(deposits)
      .set({ status: "failed", failureReason: normalizedReason, updatedAt: new Date() })
      .where(and(eq(deposits.id, deposit.id), eq(deposits.status, "pending")))
      .returning({ id: deposits.id });

    if (updated.length !== 1) {
      throw new Error("Deposit lifecycle changed while rejection was being applied");
    }

    await tx.insert(auditEvents).values({
      id: randomUUID(),
      actorType: "admin",
      actorUserId: adminUserId,
      action: "deposit.rejected",
      entityType: "deposit",
      entityId: deposit.id,
      before: { status: "pending" },
      after: { status: "failed", failureReason: normalizedReason },
      metadata: { source: "manual" }
    });

    await tx.insert(outboxEvents).values({
      id: randomUUID(),
      eventType: "deposit.rejected",
      aggregateType: "deposit",
      aggregateId: deposit.id,
      payload: {
        depositId: deposit.id,
        userId: deposit.userId,
        adminUserId,
        reason: normalizedReason,
        status: "failed"
      }
    });

    return { depositId, idempotent: false };
  });
}
