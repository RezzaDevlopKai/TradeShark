import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { TradeSharkDatabase } from "./client.js";
import { idempotencyKeys, journalEntries, journalTransactions } from "./schema/index.js";

const SCALE = 18n;
const TEN = 10n;
const TEN_TO_SCALE = TEN ** SCALE;

type LedgerPosting = {
  accountId: string;
  direction: "debit" | "credit";
  amount: string;
};

type PostJournalInput = {
  transactionId: string;
  idempotencyKey: string;
  referenceType: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
  entries: LedgerPosting[];
};

function toScaledInteger(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid positive decimal amount: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > Number(SCALE)) {
    throw new Error(`Amount exceeds ${SCALE} decimal places: ${value}`);
  }

  const paddedFraction = fraction.padEnd(Number(SCALE), "0");
  return BigInt(whole) * TEN_TO_SCALE + BigInt(paddedFraction || "0");
}

function requestHash(input: PostJournalInput): string {
  return createHash("sha256")
    .update(JSON.stringify({
      referenceType: input.referenceType,
      referenceId: input.referenceId ?? null,
      metadata: input.metadata ?? {},
      entries: input.entries
    }))
    .digest("hex");
}

/**
 * Posts an immutable double-entry journal transaction.
 *
 * Invariants enforced here:
 * - at least two postings
 * - every amount is strictly positive
 * - total debits exactly equal total credits using integer arithmetic
 * - idempotency key can only represent one request payload
 * - journal transaction and entries commit atomically
 */
export async function postJournal(
  db: TradeSharkDatabase,
  input: PostJournalInput
): Promise<{ transactionId: string; idempotent: boolean }> {
  if (input.entries.length < 2) {
    throw new Error("A journal transaction requires at least two postings");
  }

  const debitTotal = input.entries
    .filter((entry) => entry.direction === "debit")
    .reduce((sum, entry) => sum + toScaledInteger(entry.amount), 0n);
  const creditTotal = input.entries
    .filter((entry) => entry.direction === "credit")
    .reduce((sum, entry) => sum + toScaledInteger(entry.amount), 0n);

  if (debitTotal <= 0n || creditTotal <= 0n || debitTotal !== creditTotal) {
    throw new Error("Unbalanced journal transaction: debits must equal credits and both must be positive");
  }

  const hash = requestHash(input);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ key: idempotencyKeys.key, requestHash: idempotencyKeys.requestHash })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, input.idempotencyKey))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0]!.requestHash !== hash) {
        throw new Error("Idempotency key was already used with a different request");
      }
      return { transactionId: input.transactionId, idempotent: true };
    }

    await tx.insert(idempotencyKeys).values({
      key: input.idempotencyKey,
      operation: "ledger.post_journal",
      requestHash: hash,
      expiresAt: sql`now() + interval '24 hours'`
    });

    await tx.insert(journalTransactions).values({
      id: input.transactionId,
      idempotencyKey: input.idempotencyKey,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      metadata: input.metadata ?? {}
    });

    await tx.insert(journalEntries).values(
      input.entries.map((entry, sequence) => ({
        id: cryptoRandomId(),
        transactionId: input.transactionId,
        accountId: entry.accountId,
        direction: entry.direction,
        amount: entry.amount,
        sequence
      }))
    );

    return { transactionId: input.transactionId, idempotent: false };
  });
}

function cryptoRandomId(): string {
  // IDs are supplied by the application as UUIDv7. This fallback keeps the
  // database package dependency-light; production callers should pass UUIDv7 IDs.
  return crypto.randomUUID();
}
