import { describe, expect, it, vi } from "vitest";
import { getUserAvailableBalance } from "./index.js";

function createMockDatabase(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const query = {
    select: vi.fn(() => query),
    from: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    limit
  };

  return query as never;
}

describe("wallet balance read model", () => {
  it("returns the user's available ledger balance", async () => {
    const db = createMockDatabase([
      {
        accountId: "acct-1",
        assetId: "usd",
        accountType: "USER_AVAILABLE",
        balance: "125.50"
      }
    ]);

    await expect(getUserAvailableBalance(db, "user-1", "usd")).resolves.toEqual({
      accountId: "acct-1",
      assetId: "usd",
      accountType: "USER_AVAILABLE",
      balance: "125.50"
    });
  });

  it("returns null when the available account does not exist", async () => {
    const db = createMockDatabase([]);

    await expect(getUserAvailableBalance(db, "user-1", "usd")).resolves.toBeNull();
  });

  it("normalizes a missing balance projection to zero", async () => {
    const db = createMockDatabase([
      {
        accountId: "acct-1",
        assetId: "usd",
        accountType: "USER_AVAILABLE",
        balance: null
      }
    ]);

    await expect(getUserAvailableBalance(db, "user-1", "usd")).resolves.toMatchObject({
      accountId: "acct-1",
      balance: "0"
    });
  });
});
