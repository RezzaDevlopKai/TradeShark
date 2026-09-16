import { and, eq, sql } from "drizzle-orm";
import type { TradeSharkDatabase } from "./client.js";
import {
  journalEntries,
  journalTransactions,
  ledgerBalanceProjections
} from "./schema/index.js";

type ReconciliationDbExecutor = Pick<TradeSharkDatabase, "select">;

export type LedgerReconciliation = {
  accountId: string;
  projectedBalance: string;
  ledgerBalance: string;
  difference: string;
  consistent: boolean;
};

/**
 * Reconciles one projection against posted journal entries using PostgreSQL
 * NUMERIC arithmetic. No JavaScript Number conversion is used for money.
 */
export async function reconcileLedgerBalance(
  db: ReconciliationDbExecutor,
  accountId: string
): Promise<LedgerReconciliation> {
  const projectionRows = await db
    .select({ balance: ledgerBalanceProjections.balance })
    .from(ledgerBalanceProjections)
    .where(eq(ledgerBalanceProjections.accountId, accountId))
    .limit(1);

  const journalRows = await db
    .select({
      balance: sql<string>`coalesce(sum(case when ${journalEntries.direction} = 'credit' then ${journalEntries.amount} else -${journalEntries.amount} end), 0)`
    })
    .from(journalEntries)
    .innerJoin(
      journalTransactions,
      eq(journalEntries.transactionId, journalTransactions.id)
    )
    .where(
      and(
        eq(journalEntries.accountId, accountId),
        eq(journalTransactions.status, "posted")
      )
    );

  const projectedBalance = projectionRows[0]?.balance ?? "0";
  const ledgerBalance = journalRows[0]?.balance ?? "0";

  const differenceRows = await db
    .select({
      difference: sql<string>`${projectedBalance}::numeric - ${ledgerBalance}::numeric`,
      consistent: sql<boolean>`${projectedBalance}::numeric = ${ledgerBalance}::numeric`
    });

  const difference = differenceRows[0]?.difference ?? "0";
  const consistent = differenceRows[0]?.consistent ?? false;

  return {
    accountId,
    projectedBalance,
    ledgerBalance,
    difference,
    consistent
  };
}
