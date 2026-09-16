import { describe, expect, it } from "vitest";
import { validateJournalEntries } from "./ledger.js";

describe("ledger invariants", () => {
  it("accepts exactly balanced postings", () => {
    expect(() =>
      validateJournalEntries([
        { accountId: "a", direction: "debit", amount: "10.00" },
        { accountId: "b", direction: "credit", amount: "10.00" }
      ])
    ).not.toThrow();
  });

  it("rejects unbalanced postings", () => {
    expect(() =>
      validateJournalEntries([
        { accountId: "a", direction: "debit", amount: "10.00" },
        { accountId: "b", direction: "credit", amount: "9.99" }
      ])
    ).toThrow(/Unbalanced/);
  });

  it("rejects zero and malformed amounts", () => {
    expect(() =>
      validateJournalEntries([
        { accountId: "a", direction: "debit", amount: "0" },
        { accountId: "b", direction: "credit", amount: "0" }
      ])
    ).toThrow(/positive/);
  });
});
