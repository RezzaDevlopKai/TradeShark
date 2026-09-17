import { and, eq } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { withdrawals } from "@tradeshark/database";

export type WithdrawalApprovalResult = {
  status: "approved";
  idempotent: boolean;
};

/**
 * Approves a pending withdrawal without moving ledger funds.
 *
 * Funds were already reserved by requestWithdrawalAtomically. Approval is
 * therefore a lifecycle-only transition; submitWithdrawalAtomically performs
 * the next ledger movement. Lock the withdrawal row before any lifecycle
 * decision so approval and failure use a consistent lock order and cannot
 * deadlock while racing on the withdrawal's ledger projections.
 */
export async function approveWithdrawalAtomically(
  db: TradeSharkDatabase,
  withdrawalId: string
): Promise<WithdrawalApprovalResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: withdrawals.id, status: withdrawals.status })
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .for("update")
      .limit(1);

    const withdrawal = rows[0];
    if (!withdrawal) throw new Error(`Withdrawal ${withdrawalId} was not found`);

    if (withdrawal.status === "approved") {
      return { status: "approved", idempotent: true };
    }
    if (withdrawal.status !== "pending") {
      throw new Error(`Withdrawal ${withdrawalId} must be pending before approval`);
    }

    const updated = await tx
      .update(withdrawals)
      .set({ status: "approved", updatedAt: new Date() })
      .where(and(eq(withdrawals.id, withdrawal.id), eq(withdrawals.status, "pending")))
      .returning({ id: withdrawals.id });

    if (updated.length === 1) {
      return { status: "approved", idempotent: false };
    }

    const afterRace = await tx
      .select({ status: withdrawals.status })
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawal.id))
      .limit(1);

    if (afterRace[0]?.status === "approved") {
      return { status: "approved", idempotent: true };
    }

    throw new Error("Withdrawal lifecycle changed while approval was being applied");
  });
}
