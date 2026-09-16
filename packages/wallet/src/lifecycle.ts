import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { PostJournalInput, TradeSharkDatabase } from "@tradeshark/database";
import { deposits, ledgerAccounts, postJournal, withdrawals } from "@tradeshark/database";

export const fundingLifecycleStates = [
  "pending",
  "confirmed",
  "credited",
  "failed",
  "reversed"
] as const;

export type FundingLifecycleState = (typeof fundingLifecycleStates)[number];

export const withdrawalLifecycleStates = [
  "requested",
  "pending",
  "approved",
  "submitted",
  "confirmed",
  "failed",
  "reversed",
  "cancelled"
] as const;

export type WithdrawalLifecycleState = (typeof withdrawalLifecycleStates)[number];

const FUNDING_TRANSITIONS: Record<FundingLifecycleState, readonly FundingLifecycleState[]> = {
  pending: ["confirmed", "failed"],
  confirmed: ["credited", "failed"],
  credited: ["reversed"],
  failed: [],
  reversed: []
};

const WITHDRAWAL_TRANSITIONS: Record<WithdrawalLifecycleState, readonly WithdrawalLifecycleState[]> = {
  requested: ["pending", "cancelled"],
  pending: ["approved", "failed", "cancelled"],
  approved: ["submitted", "failed", "cancelled"],
  submitted: ["confirmed", "failed"],
  confirmed: [],
  failed: ["reversed"],
  reversed: [],
  cancelled: []
};

export function canTransitionFunding(
  from: FundingLifecycleState,
  to: FundingLifecycleState
): boolean {
  return FUNDING_TRANSITIONS[from].includes(to);
}

export function canTransitionWithdrawal(
  from: WithdrawalLifecycleState,
  to: WithdrawalLifecycleState
): boolean {
  return WITHDRAWAL_TRANSITIONS[from].includes(to);
}

function assertPositiveAmount(amount: string): void {
  const normalized = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized) || /^0+(\.0+)?$/.test(normalized)) {
    throw new Error(`Amount must be greater than zero: ${amount}`);
  }
  const fraction = normalized.split(".")[1] ?? "";
  if (fraction.length > 18) {
    throw new Error(`Amount exceeds 18 decimal places: ${amount}`);
  }
}

function assertFailureReason(to: FundingLifecycleState | WithdrawalLifecycleState, failureReason?: string): void {
  if ((to === "failed" || to === "reversed") && !failureReason?.trim()) {
    throw new Error(`A failure reason is required when transitioning to ${to}`);
  }
}

type FundingAccountPair = {
  pendingDepositAccountId: string;
  userAvailableAccountId: string;
};

async function assertFundingAccounts(
  db: TradeSharkDatabase,
  pair: FundingAccountPair
): Promise<void> {
  const ids = [pair.pendingDepositAccountId, pair.userAvailableAccountId];
  const rows = await db
    .select({
      id: ledgerAccounts.id,
      userId: ledgerAccounts.userId,
      assetId: ledgerAccounts.assetId,
      accountType: ledgerAccounts.accountType
    })
    .from(ledgerAccounts)
    .where(inArray(ledgerAccounts.id, ids));

  if (rows.length !== 2) {
    throw new Error("Required funding ledger accounts do not exist");
  }

  const pending = rows.find((row) => row.id === pair.pendingDepositAccountId);
  const available = rows.find((row) => row.id === pair.userAvailableAccountId);

  if (
    !pending ||
    !available ||
    pending.accountType !== "USER_PENDING_DEPOSIT" ||
    available.accountType !== "USER_AVAILABLE" ||
    pending.userId === null ||
    available.userId === null ||
    pending.userId !== available.userId ||
    pending.assetId !== available.assetId
  ) {
    throw new Error("Funding ledger accounts must belong to the same user and asset");
  }
}

export type TransitionDepositInput = {
  depositId: string;
  from: FundingLifecycleState;
  to: FundingLifecycleState;
  failureReason?: string;
};

/**
 * Persists a deposit lifecycle transition with optimistic concurrency control.
 * The status in the UPDATE predicate prevents two workers from applying the
 * same transition concurrently. Callers should pass the state they observed.
 */
export async function transitionDeposit(
  db: TradeSharkDatabase,
  input: TransitionDepositInput
): Promise<{ depositId: string; status: FundingLifecycleState }> {
  if (!canTransitionFunding(input.from, input.to)) {
    throw new Error(`Invalid deposit lifecycle transition: ${input.from} -> ${input.to}`);
  }
  assertFailureReason(input.to, input.failureReason);

  const now = new Date();
  const result = await db
    .update(deposits)
    .set({
      status: input.to,
      updatedAt: now,
      ...(input.to === "confirmed" ? { confirmedAt: now } : {}),
      ...(input.to === "credited" ? { creditedAt: now } : {}),
      ...(input.to === "failed" || input.to === "reversed"
        ? { failureReason: input.failureReason?.trim() }
        : {})
    })
    .where(and(eq(deposits.id, input.depositId), eq(deposits.status, input.from)))
    .returning({ id: deposits.id });

  if (result.length !== 1) {
    throw new Error(
      `Deposit lifecycle transition was rejected because the deposit was missing or no longer in ${input.from}`
    );
  }

  return { depositId: result[0]!.id, status: input.to };
}

export type TransitionWithdrawalInput = {
  withdrawalId: string;
  from: WithdrawalLifecycleState;
  to: WithdrawalLifecycleState;
  failureReason?: string;
};

/**
 * Persists a withdrawal lifecycle transition with optimistic concurrency control.
 * Timestamps are written by the transition itself so state and audit timing
 * cannot depend on application-side defaults.
 */
export async function transitionWithdrawal(
  db: TradeSharkDatabase,
  input: TransitionWithdrawalInput
): Promise<{ withdrawalId: string; status: WithdrawalLifecycleState }> {
  if (!canTransitionWithdrawal(input.from, input.to)) {
    throw new Error(`Invalid withdrawal lifecycle transition: ${input.from} -> ${input.to}`);
  }
  assertFailureReason(input.to, input.failureReason);

  const now = new Date();
  const result = await db
    .update(withdrawals)
    .set({
      status: input.to,
      updatedAt: now,
      ...(input.to === "submitted" ? { submittedAt: now } : {}),
      ...(input.to === "confirmed" ? { confirmedAt: now } : {}),
      ...(input.to === "failed" || input.to === "reversed"
        ? { failureReason: input.failureReason?.trim() }
        : {})
    })
    .where(and(eq(withdrawals.id, input.withdrawalId), eq(withdrawals.status, input.from)))
    .returning({ id: withdrawals.id });

  if (result.length !== 1) {
    throw new Error(
      `Withdrawal lifecycle transition was rejected because the withdrawal was missing or no longer in ${input.from}`
    );
  }

  return { withdrawalId: result[0]!.id, status: input.to };
}

export type CreditConfirmedDepositInput = {
  pendingDepositAccountId: string;
  userAvailableAccountId: string;
  amount: string;
  idempotencyKey: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Credits a confirmed deposit into the customer's available balance.
 * The journal remains the financial source of truth; account roles are
 * validated before any money movement is attempted.
 */
export async function creditConfirmedDeposit(
  db: TradeSharkDatabase,
  input: CreditConfirmedDepositInput
): Promise<{ transactionId: string; idempotent: boolean }> {
  assertPositiveAmount(input.amount);
  await assertFundingAccounts(db, input);

  const journal: PostJournalInput = {
    transactionId: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    referenceType: "deposit_credit",
    ...(input.referenceId === undefined ? {} : { referenceId: input.referenceId }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    entries: [
      { accountId: input.pendingDepositAccountId, direction: "debit", amount: input.amount },
      { accountId: input.userAvailableAccountId, direction: "credit", amount: input.amount }
    ]
  };

  return postJournal(db, journal);
}

export type SettleWithdrawalInput = {
  userId: string;
  assetId: string;
  userLockedAccountId: string;
  pendingWithdrawalAccountId: string;
  amount: string;
  idempotencyKey: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

async function assertWithdrawalAccounts(
  db: TradeSharkDatabase,
  input: SettleWithdrawalInput
): Promise<void> {
  const rows = await db
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
        inArray(ledgerAccounts.accountType, ["USER_LOCKED", "USER_PENDING_WITHDRAWAL"])
      )
    );

  const locked = rows.find((row) => row.id === input.userLockedAccountId);
  const pending = rows.find((row) => row.id === input.pendingWithdrawalAccountId);

  if (
    !locked ||
    !pending ||
    locked.accountType !== "USER_LOCKED" ||
    pending.accountType !== "USER_PENDING_WITHDRAWAL"
  ) {
    throw new Error("Withdrawal ledger accounts must belong to the requested user and asset");
  }
}

/**
 * Moves an already-locked customer balance into the customer's pending
 * withdrawal account. External blockchain settlement happens separately.
 */
export async function settleWithdrawalToPending(
  db: TradeSharkDatabase,
  input: SettleWithdrawalInput
): Promise<{ transactionId: string; idempotent: boolean }> {
  assertPositiveAmount(input.amount);
  await assertWithdrawalAccounts(db, input);

  const journal: PostJournalInput = {
    transactionId: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    referenceType: "withdrawal_pending",
    ...(input.referenceId === undefined ? {} : { referenceId: input.referenceId }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    entries: [
      { accountId: input.userLockedAccountId, direction: "debit", amount: input.amount },
      { accountId: input.pendingWithdrawalAccountId, direction: "credit", amount: input.amount }
    ]
  };

  return postJournal(db, journal);
}
