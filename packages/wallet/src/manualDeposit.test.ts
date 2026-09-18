import { describe, expect, it } from "vitest";
import {
  approveManualDeposit,
  createManualDepositRequest,
  rejectManualDeposit
} from "./manualDeposit.js";

describe("manual deposit review services", () => {
  it("exports the manual deposit lifecycle surface", () => {
    expect(createManualDepositRequest).toBeTypeOf("function");
    expect(approveManualDeposit).toBeTypeOf("function");
    expect(rejectManualDeposit).toBeTypeOf("function");
  });

  it("rejects invalid deposit amounts before touching the database", async () => {
    const db = {} as Parameters<typeof createManualDepositRequest>[0];

    await expect(
      createManualDepositRequest(db, {
        userId: "user",
        assetId: "asset",
        amount: "0"
      })
    ).rejects.toThrow("Invalid positive decimal amount");

    await expect(
      createManualDepositRequest(db, {
        userId: "user",
        assetId: "asset",
        amount: "-1"
      })
    ).rejects.toThrow("Invalid positive decimal amount");
  });

  it("enforces the minimum deposit and ledger precision without floating point", async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => []
          })
        })
      })
    };
    const db = {
      transaction: async (callback: (value: typeof tx) => unknown) => callback(tx)
    } as unknown as Parameters<typeof createManualDepositRequest>[0];

    await expect(
      createManualDepositRequest(db, {
        userId: "user",
        assetId: "asset",
        amount: "2.499999999999999999"
      })
    ).rejects.toThrow("Minimum deposit amount is 2.5");

    await expect(
      createManualDepositRequest(db, {
        userId: "user",
        assetId: "asset",
        amount: "2.500000000000000000"
      })
    ).rejects.toThrow("Required USER_PENDING_DEPOSIT ledger account does not exist");

    await expect(
      createManualDepositRequest(db, {
        userId: "user",
        assetId: "asset",
        amount: "2.5000000000000000001"
      })
    ).rejects.toThrow("Invalid positive decimal amount");
  });

  it("requires a rejection reason before touching the database", async () => {
    const db = {} as Parameters<typeof rejectManualDeposit>[0];

    await expect(
      rejectManualDeposit(db, "deposit", "admin", "   ")
    ).rejects.toThrow("A rejection reason is required");
  });
});
