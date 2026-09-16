import { describe, expect, it } from "vitest";
import {
  confirmDepositAtomically,
  creditDepositAtomically,
  confirmWithdrawalAtomically,
  failWithdrawalAtomically,
  requestWithdrawalAtomically,
  submitWithdrawalAtomically
} from "./index.js";

describe("atomic funding settlement services", () => {
  it("exports the complete withdrawal settlement surface", () => {
    expect(requestWithdrawalAtomically).toBeTypeOf("function");
    expect(submitWithdrawalAtomically).toBeTypeOf("function");
    expect(confirmWithdrawalAtomically).toBeTypeOf("function");
    expect(failWithdrawalAtomically).toBeTypeOf("function");
  });

  it("exports the complete deposit settlement surface", () => {
    expect(confirmDepositAtomically).toBeTypeOf("function");
    expect(creditDepositAtomically).toBeTypeOf("function");
  });
});
