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

  it("requires a rejection reason before touching the database", async () => {
    const db = {} as Parameters<typeof rejectManualDeposit>[0];

    await expect(
      rejectManualDeposit(db, "deposit", "admin", "   ")
    ).rejects.toThrow("A rejection reason is required");
  });
});
