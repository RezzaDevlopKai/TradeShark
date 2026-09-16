import { describe, expect, it } from "vitest";
import {
  creditDepositAtomically,
  confirmWithdrawalAtomically,
  failWithdrawalAtomically,
  requestWithdrawalAtomically,
  submitWithdrawalAtomically
} from "./funding.js";

describe("atomic funding settlement services", () => {
  it("exports the complete withdrawal settlement surface", () => {
    expect(requestWithdrawalAtomically).toBeTypeOf("function");
    expect(submitWithdrawalAtomically).toBeTypeOf("function");
    expect(confirmWithdrawalAtomically).toBeTypeOf("function");
    expect(failWithdrawalAtomically).toBeTypeOf("function");
  });

  it("exports atomic deposit crediting", () => {
    expect(creditDepositAtomically).toBeTypeOf("function");
  });
});
