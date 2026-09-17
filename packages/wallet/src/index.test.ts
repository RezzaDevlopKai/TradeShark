import { describe, expect, it, vi } from "vitest";
import { getUserAvailableBalance, getUserBalances } from "./index.js";

function createMockDatabase(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const query = {
    select: vi.fn(() => query),
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    limit,
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject)
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

  it("returns all available balances with asset metadata", async () => {
    const db = createMockDatabase([
      {
        accountId: "acct-usd",
        assetId: "usd",
        symbol: "USD",
        name: "US Dollar",
        decimals: 2,
        balance: "125.50"
      },
      {
        accountId: "acct-btc",
        assetId: "btc",
        symbol: "BTC",
        name: "Bitcoin",
        decimals: 8,
        balance: null
      }
    ]);

    await expect(getUserBalances(db, "user-1")).resolves.toEqual([
      {
        accountId: "acct-usd",
        assetId: "usd",
        symbol: "USD",
        name: "US Dollar",
        decimals: 2,
        balance: "125.50"
      },
      {
        accountId: "acct-btc",
        assetId: "btc",
        symbol: "BTC",
        name: "Bitcoin",
        decimals: 8,
        balance: "0"
      }
    ]);
  });
});
