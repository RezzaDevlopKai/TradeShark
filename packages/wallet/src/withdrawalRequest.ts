import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import {
  idempotencyKeys,
  journalTransactions,
  ledgerAccounts,
  postJournalInTransaction,
  withdrawals
} from "@tradeshark/database";

const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export type CreateWithdrawalRequestInput = {
  userId: string;
  assetId: string;
  amount: string;
  destination: string;
  idempotencyKey: string;
};

export type CreateWithdrawalRequestResult = {
  withdrawalId: string;
  status: "pending";
  amount: string;
  assetId: string;
  destination: string;
  transactionId: string;
  idempotent: boolean;
};

function assertPositiveDecimal(amount: string): string {
  const normalized = amount.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error(`Invalid positive decimal amount: ${amount}`);
  const integerPart = match[1] ?? "";
  const fractionalPart = match[2] ?? "";
  if (fractionalPart.length > 18 || (/^0+$/.test(integerPart) && /^0*$/.test(fractionalPart))) {
    throw new Error(`Invalid positive decimal amount: ${amount}`);
  }
  return normalized;
}

function normalizeIdempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length < MIN_IDEMPOTENCY_KEY_LENGTH || key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new Error("Invalid idempotency key");
  }
  return key;
}

function hashRequest(input: Omit<CreateWithdrawalRequestInput, "idempotencyKey">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function findJournalTransactionId(
  db: Pick<TradeSharkDatabase, "select">,
  idempotencyKey: string
): Promise<string> {
  const rows = await db.select({ id: journalTransactions.id }).from(journalTransactions)
    .where(eq(journalTransactions.idempotencyKey, idempotencyKey)).limit(1);
  if (!rows[0]) throw new Error(`Ledger journal for ${idempotencyKey} was not found`);
  return rows[0].id;
}

export async function createWithdrawalRequest(
  db: TradeSharkDatabase,
  input: CreateWithdrawalRequestInput
): Promise<CreateWithdrawalRequestResult> {
  const amount = assertPositiveDecimal(input.amount);
  const destination = input.destination.trim();
  if (!destination) throw new Error("Withdrawal destination is required");
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestHash = hashRequest({ userId: input.userId, assetId: input.assetId, amount, destination });
  const storageKey = `wallet:withdrawal:${input.userId}:${idempotencyKey}`;

  return db.transaction(async (tx) => {
    const existingRows = await tx.select({
      requestHash: idempotencyKeys.requestHash,
      responseBody: idempotencyKeys.responseBody
    }).from(idempotencyKeys).where(eq(idempotencyKeys.key, storageKey)).limit(1);
    const existing = existingRows[0];

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new Error("Idempotency key was already used with a different withdrawal request");
      }
      const body = existing.responseBody as Partial<CreateWithdrawalRequestResult> | null;
      if (!body?.withdrawalId || !body.transactionId) {
        throw new Error("Withdrawal request is still being finalized; retry with the same idempotency key");
      }
      return {
        withdrawalId: body.withdrawalId,
        status: "pending",
        amount: String(body.amount ?? amount),
        assetId: String(body.assetId ?? input.assetId),
        destination: String(body.destination ?? destination),
        transactionId: String(body.transactionId),
        idempotent: true
      };
    }

    const accounts = await tx.select({
      id: ledgerAccounts.id,
      accountType: ledgerAccounts.accountType
    }).from(ledgerAccounts).where(and(
      eq(ledgerAccounts.userId, input.userId),
      eq(ledgerAccounts.assetId, input.assetId),
      inArray(ledgerAccounts.accountType, ["USER_AVAILABLE", "USER_LOCKED", "USER_PENDING_WITHDRAWAL"])
    ));

    const available = accounts.find((a) => a.accountType === "USER_AVAILABLE");
    const locked = accounts.find((a) => a.accountType === "USER_LOCKED");
    const pending = accounts.find((a) => a.accountType === "USER_PENDING_WITHDRAWAL");
    if (!available || !locked || !pending) {
      throw new Error("Required withdrawal ledger accounts do not exist");
    }

    const withdrawalId = randomUUID();
    await tx.insert(withdrawals).values({
      id: withdrawalId,
      userId: input.userId,
      assetId: input.assetId,
      pendingAccountId: pending.id,
      amount,
      status: "requested",
      destination
    });

    const lockKey = `withdrawal:${withdrawalId}:lock`;
    const lockResult = await postJournalInTransaction(tx, {
      transactionId: randomUUID(),
      idempotencyKey: lockKey,
      referenceType: "withdrawal_lock",
      referenceId: withdrawalId,
      entries: [
        { accountId: available.id, direction: "debit", amount },
        { accountId: locked.id, direction: "credit", amount }
      ]
    });

    const updated = await tx.update(withdrawals).set({
      status: "pending",
      updatedAt: new Date()
    }).where(and(eq(withdrawals.id, withdrawalId), eq(withdrawals.status, "requested")))
      .returning({ id: withdrawals.id });

    if (updated.length !== 1) {
      throw new Error("Withdrawal lifecycle changed while funds were being locked");
    }

    const responseBody: CreateWithdrawalRequestResult = {
      withdrawalId,
      status: "pending",
      amount,
      assetId: input.assetId,
      destination,
      transactionId: lockResult.transactionId,
      idempotent: false
    };

    await tx.insert(idempotencyKeys).values({
      key: storageKey,
      userId: input.userId,
      operation: "wallet.withdrawal.create",
      requestHash,
      responseStatus: 201,
      responseBody,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    return responseBody;
  });
}
