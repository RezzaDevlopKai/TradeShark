import { randomUUID } from "node:crypto";
import type { PostJournalInput, TradeSharkDatabase } from "@tradeshark/database";
import { postJournal } from "@tradeshark/database";

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
 * The caller must only invoke this after the external deposit has passed its
 * own confirmation/risk policy. The journal remains the financial source of truth.
 */
export async function creditConfirmedDeposit(
  db: TradeSharkDatabase,
  input: CreditConfirmedDepositInput
): Promise<{ transactionId: string; idempotent: boolean }> {
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
  userLockedAccountId: string;
  pendingWithdrawalAccountId: string;
  amount: string;
  idempotencyKey: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Moves an already-locked customer balance into the platform's pending
 * withdrawal account. External blockchain settlement happens separately.
 */
export async function settleWithdrawalToPending(
  db: TradeSharkDatabase,
  input: SettleWithdrawalInput
): Promise<{ transactionId: string; idempotent: boolean }> {
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
