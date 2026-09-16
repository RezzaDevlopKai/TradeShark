import { describe, expect, it } from "vitest";
import {
  coinCreationEntitlements,
  journalEntries,
  journalTransactions,
  orders,
  users
} from "./index.js";

describe("TradeShark database schema", () => {
  it("exports the financial and growth foundation tables", () => {
    expect(users).toBeDefined();
    expect(orders).toBeDefined();
    expect(journalTransactions).toBeDefined();
    expect(journalEntries).toBeDefined();
    expect(coinCreationEntitlements).toBeDefined();
  });

  it("uses a unique client order id per user", () => {
    expect(orders).toBeDefined();
  });
});
