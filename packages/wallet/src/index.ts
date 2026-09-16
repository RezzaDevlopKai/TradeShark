import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { PostJournalInput, TradeSharkDatabase } from "@tradeshark/database";
import {
  ledgerAccountType,
  ledgerAccounts,
  ledgerBalanceProjections,
  postJournal
} from "@tradeshark/database";

export * from "./deposit.js";
export * from "./funding.js";
export * from "./lifecycle.js";

export type WalletBalance = {
  accountId: string;
  assetId: string;
  accountType: (typeof ledgerAccountType.enumValues)[number];
  balance: string;
};

const MOVABLE_ACCOUNT_TYPES = ["USER_AVAILABLE", "USER_LOCKED"] as const;
type MovableAccountType = (typeof MOVABLE_ACCOUNT_TYPES)[number];

export async function getUserAvailableBalance(
  db: TradeSharkDatabase,
  userId: string,
  assetId: string
): Promise<WalletBalance | null> {
  const rows = await db
    .select({
      accountId: ledgerAccounts.id,
      assetId: ledgerAccounts.assetId,
      accountType: ledgerAccounts.accountType,
      balance: ledgerBalanceProjections.balance
    })
    .from(ledgerAccounts)
    .leftJoin(
      ledgerBalanceProjections,
      eq(ledgerBalanceProjections.accountId, ledgerAccounts.id)
    )
    .where(
      and(
        eq(ledgerAccounts.userId, userId),
        eq(ledgerAccounts.assetId, assetId),
        eq(ledgerAccounts.accountType, "USER_AVAILABLE")
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    accountId: row.accountId,
    assetId: row.assetId,
    accountType: row.accountType,
    balance: row.balance ?? "0"
  };
}

export type MoveWalletBalanceInput = {
  userId: string;
  assetId: string;
  from: MovableAccountType;
  to: MovableAccountType;
  amount: string;
  idempotencyKey: string;
  referenceType: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

export async function moveWalletBalance(
  db: TradeSharkDatabase,
  input: MoveWalletBalanceInput
): Promise<{ transactionId: string; idempotent: boolean }> {
  if (input.from === input.to) {
    throw new Error("Wallet source and destination accounts must differ");
  }

  if (!/^\d+(\.\d+)?$/.test(input.amount.trim())) {
    throw new Error(`Invalid positive decimal amount: ${input.amount}`);
  }

  const accounts = await db
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
        inArray(ledgerAccounts.accountType, MOVABLE_ACCOUNT_TYPES)
      )
    );

  const accountByType = new Map<MovableAccountType, typeof accounts[number]>();
  for (const account of accounts) {
    if (MOVABLE_ACCOUNT_TYPES.includes(account.accountType as MovableAccountType)) {
      accountByType.set(account.accountType as MovableAccountType, account);
    }
  }

  const source = accountByType.get(input.from);
  const destination = accountByType.get(input.to);
  if (!source || !destination) {
    throw new Error("Required wallet ledger accounts do not exist");
  }

  const journal: PostJournalInput = {
    transactionId: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    referenceType: input.referenceType,
    ...(input.referenceId === undefined ? {} : { referenceId: input.referenceId }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    entries: [
      { accountId: source.id, direction: "debit", amount: input.amount },
      { accountId: destination.id, direction: "credit", amount: input.amount }
    ]
  };

  return postJournal(db, journal);
}
