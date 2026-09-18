import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { idempotencyKeys, ledgerAccounts, withdrawals } from "@tradeshark/database";
import { requestWithdrawalAtomically } from "./funding.js";

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
  if (
    fractionalPart.length > 18 ||
    (/^0+$/.test(integerPart) && /^0*$/.test(fractionalPart))
  ) {
    throw new Error(`Invalid positive decimal amount: ${amount}`);
  }

  return normalized;
}

function normalizeIdempotencyKey(value: string): string {
  const key = value.trim();
  if (
    key.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
    key.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    !/^[A-Za-z0-9._:-]+$/.test(key)
  ) {
    throw new Error("Invalid idempotency key");
  }
  return key;
}

function hashRequest(input: Omit<CreateWithdrawalRequestInput, "idempotencyKey">): string {
  return createHash("sha256")
    .update(JSON.stringify({
      userId: input.userId,
      assetId: input.assetId,
      amount: input.amount,
      destination: input.destination
    }))
    .digest("hex");
}

export async function createWithdrawalRequest(
  db: TradeSharkDatabase,
  input: CreateWithdrawalRequestInput
): Promise<CreateWithdrawalRequestResult> {
  const amount = assertPositiveDecimal(input.amount);
  const destination = input.destination.trim();
  if (!destination) throw new Error("Withdrawal destination is required");
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestHash = hashRequest({ ...input, amount, destination });
  const storageKey = `wallet:withdrawal:${input.userId}:${idempotencyKey}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const existingRows = await tx
      .select({
        requestHash: idempotencyKeys.requestHash,
        responseStatus: idempotencyKeys.responseStatus,
        responseBody: idempotencyKeys.responseBody
      })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, storageKey))
      .limit(1);

    const existing = existingRows[0];
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new Error("Idempotency key was already used with a different withdrawal request");
      }
      const body = existing.responseBody as Partial<CreateWithdrawalRequestResult> | null;
      if (!body?.withdrawalId || !body.transactionId) {
        throw new Error("Stored withdrawal idempotency response is incomplete");
      }
      return {
        withdrawalId: body.withdrawalId,
        status: "pending",
        amount: String(body.amount ?? amount),
        assetId: String(body.assetId ?? input.assetId),
        destination: String(body.destination ?? destination),
        transactionId: body.transactionId,
        idempotent: true
      };
    }

    const pendingRows = await tx
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
          eq(ledgerAccounts.accountType, "USER_PENDING_WITHDRAWAL")
        )
      )
      .limit(1);

    const pending = pendingRows[0];
    if (!pending) {
      throw new Error("Required USER_PENDING_WITHDRAWAL ledger account does not exist");
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

    const lockResult = await requestWithdrawalAtomically(tx as TradeSharkDatabase, withdrawalId);
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
      expiresAt
    });

    return responseBody;
  });
}
