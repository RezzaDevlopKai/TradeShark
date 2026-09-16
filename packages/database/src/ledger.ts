import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { TradeSharkDatabase } from "./client.js";
import {
  idempotencyKeys,
  journalEntries,
  journalTransactions,
  ledgerAccounts,
  ledgerBalanceProjections
} from "./schema/index.js";

const SCALE = 18n;
const SCALE_DIGITS = Number(SCALE);
const TEN_TO_SCALE = 10n ** SCALE;

export type LedgerPosting = {
  accountId: string;
  direction: "debit" | "credit";
  amount: string;
};

export type PostJournalInput = {
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

  const parts = normalized.split(".");
  const whole = parts[0];
  const fraction = parts[1] ?? "";

  if (whole === undefined) {
    throw new Error(`Invalid positive decimal amount: ${value}`);
  }

  if (fraction.length > SCALE_DIGITS) {
    throw new Error(`Amount exceeds ${SCALE} decimal places: ${value}`);
  }

  return BigInt(whole) * TEN_TO_SCALE + BigInt(fraction.padEnd(SCALE_DIGITS, "0") || "0");
}

/** Validate the core double-entry invariant before persistence. */
export function validateJournalEntries(entries: LedgerPosting[]): void {
  if (entries.length < 2) {
    throw new Error("A journal transaction requires at least two postings");
  }

  let debitTotal = 0n;
  let creditTotal = 0n;
  const accountIds = new Set<string>();

  for (const entry of entries) {
    if (!entry.accountId.trim()) {
      throw new Error("Journal posting accountId is required");
    }

    if (accountIds.has(entry.accountId)) {
      throw new Error(`Journal transaction contains duplicate account ${entry.accountId}`);
    }
    accountIds.add(entry.accountId);

    if (entry.direction !== "debit" && entry.direction !== "credit") {
      throw new Error(`Invalid journal posting direction: ${entry.direction}`);
    }

    const amount = toScaledInteger(entry.amount);
    if (amount <= 0n) {
      throw new Error("Journal posting amounts must be positive");
    }

    if (entry.direction === "debit") debitTotal += amount;
    else creditTotal += amount;
  }

  if (debitTotal <= 0n || creditTotal <= 0n || debitTotal !== creditTotal) {
    throw new Error("Unbalanced journal transaction: debits must equal credits and both must be positive");
  }
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

/** Atomically posts an immutable double-entry journal transaction. */
export async function postJournal(
  db: TradeSharkDatabase,
  input: PostJournalInput
): Promise<{ transactionId: string; idempotent: boolean }> {
  validateJournalEntries(input.entries);
  const hash = requestHash(input);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ requestHash: idempotencyKeys.requestHash })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, input.idempotencyKey))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0]!.requestHash !== hash) {
        throw new Error("Idempotency key was already used with a different request");
      }

      const original = await tx
        .select({ transactionId: journalTransactions.id })
        .from(journalTransactions)
        .where(eq(journalTransactions.idempotencyKey, input.idempotencyKey))
        .limit(1);

      if (original.length === 0) {
        throw new Error("Idempotency record exists without its journal transaction");
      }

      return { transactionId: original[0]!.transactionId, idempotent: true };
    }

    await tx.insert(idempotencyKeys).values({
      key: input.idempotencyKey,
      operation: "ledger.post_journal",
      requestHash: hash,
      expiresAt: sql`now() + interval '24 hours'`
    });

    const transactionValues = {
      id: input.transactionId,
      idempotencyKey: input.idempotencyKey,
      referenceType: input.referenceType,
      metadata: input.metadata ?? {}
    };

    await tx.insert(journalTransactions).values(
      input.referenceId === undefined
        ? transactionValues
        : { ...transactionValues, referenceId: input.referenceId }
    );

    await tx.insert(journalEntries).values(
      input.entries.map((entry, sequence) => ({
        id: randomUUID(),
        transactionId: input.transactionId,
        accountId: entry.accountId,
        direction: entry.direction,
        amount: entry.amount,
        sequence
      }))
    );

    // The projection is deliberately limited to customer wallet accounts.
    // Other ledger account types can have different accounting sign semantics.
    const accountIds = [...new Set(input.entries.map((entry) => entry.accountId))];
    const accounts = await tx
      .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, accountIds));
    const accountTypes = new Map(accounts.map((account) => [account.id, account.accountType]));

    for (const entry of input.entries) {
      if (!accountTypes.get(entry.accountId)?.startsWith("USER_")) continue;

      await tx
        .insert(ledgerBalanceProjections)
        .values({ accountId: entry.accountId, balance: "0" })
        .onConflictDoNothing({ target: ledgerBalanceProjections.accountId });

      const updated = await tx
        .update(ledgerBalanceProjections)
        .set({
          balance:
            entry.direction === "debit"
              ? sql`${ledgerBalanceProjections.balance} - ${entry.amount}`
              : sql`${ledgerBalanceProjections.balance} + ${entry.amount}`,
          version: sql`${ledgerBalanceProjections.version} + 1`,
          updatedAt: sql`now()`
        })
        .where(
          and(
            eq(ledgerBalanceProjections.accountId, entry.accountId),
            entry.direction === "debit"
              ? sql`${ledgerBalanceProjections.balance} >= ${entry.amount}`
              : sql`true`
          )
        );

      if (updated.rowCount !== 1) {
        throw new Error(`Insufficient wallet balance for ledger account ${entry.accountId}`);
      }
    }

    return { transactionId: input.transactionId, idempotent: false };
  });
}
