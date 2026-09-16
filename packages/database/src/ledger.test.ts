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

  it("accepts many postings when the totals balance exactly", () => {
    expect(() =>
      validateJournalEntries([
        { accountId: "a", direction: "debit", amount: "1.25" },
        { accountId: "b", direction: "debit", amount: "8.75" },
        { accountId: "c", direction: "credit", amount: "10" }
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

    expect(() =>
      validateJournalEntries([
        { accountId: "a", direction: "debit", amount: "-1" },
        { accountId: "b", direction: "credit", amount: "-1" }
      ])
    ).toThrow(/Invalid positive decimal/);
  });

  it("rejects amounts beyond ledger precision", () => {
    const amount = `1.${"0".repeat(18)}1`;
    expect(() =>
      validateJournalEntries([
        { accountId: "a", direction: "debit", amount },
        { accountId: "b", direction: "credit", amount }
      ])
    ).toThrow(/18 decimal places/);
  });

  it("rejects duplicate accounts to keep each journal posting unambiguous", () => {
    expect(() =>
      validateJournalEntries([
        { accountId: "a", direction: "debit", amount: "10" },
        { accountId: "a", direction: "credit", amount: "10" }
      ])
    ).toThrow(/duplicate account/);
  });

  it("rejects an empty account id", () => {
    expect(() =>
      validateJournalEntries([
        { accountId: "   ", direction: "debit", amount: "10" },
        { accountId: "b", direction: "credit", amount: "10" }
      ])
    ).toThrow(/accountId is required/);
  });

  it("rejects an invalid posting direction at runtime", () => {
    expect(() =>
      validateJournalEntries([
        { accountId: "a", direction: "bogus" as "debit", amount: "10" },
        { accountId: "b", direction: "credit", amount: "10" }
      ])
    ).toThrow(/Invalid journal posting direction/);
  });
});
