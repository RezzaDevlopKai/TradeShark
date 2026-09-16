import { and, eq } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import {
  ledgerAccountType,
  ledgerAccounts,
  ledgerBalanceProjections
} from "@tradeshark/database";

export type WalletBalance = {
  accountId: string;
  assetId: string;
  accountType: (typeof ledgerAccountType.enumValues)[number];
  balance: string;
};

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
