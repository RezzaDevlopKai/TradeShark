import { describe, expect, it } from "vitest";
import {
  canTransitionFunding,
  canTransitionWithdrawal,
  fundingLifecycleStates,
  withdrawalLifecycleStates
} from "./lifecycle.js";

describe("funding lifecycle", () => {
  it("allows only the documented forward transitions", () => {
    expect(canTransitionFunding("pending", "confirmed")).toBe(true);
    expect(canTransitionFunding("confirmed", "credited")).toBe(true);
    expect(canTransitionFunding("credited", "reversed")).toBe(true);
    expect(canTransitionFunding("pending", "credited")).toBe(false);
    expect(canTransitionFunding("credited", "confirmed")).toBe(false);
    expect(canTransitionFunding("failed", "pending")).toBe(false);
  });

  it("keeps the state list stable", () => {
    expect(fundingLifecycleStates).toEqual([
      "pending",
      "confirmed",
      "credited",
      "failed",
      "reversed"
    ]);
  });
});

describe("withdrawal lifecycle", () => {
  it("allows the documented operational transitions", () => {
    expect(canTransitionWithdrawal("requested", "pending")).toBe(true);
    expect(canTransitionWithdrawal("pending", "approved")).toBe(true);
    expect(canTransitionWithdrawal("approved", "submitted")).toBe(true);
    expect(canTransitionWithdrawal("submitted", "confirmed")).toBe(true);
    expect(canTransitionWithdrawal("pending", "cancelled")).toBe(true);
    expect(canTransitionWithdrawal("failed", "reversed")).toBe(true);
  });

  it("rejects skipping or reopening terminal states", () => {
    expect(canTransitionWithdrawal("requested", "approved")).toBe(false);
    expect(canTransitionWithdrawal("approved", "confirmed")).toBe(false);
    expect(canTransitionWithdrawal("confirmed", "reversed")).toBe(false);
    expect(canTransitionWithdrawal("cancelled", "pending")).toBe(false);
    expect(canTransitionWithdrawal("reversed", "submitted")).toBe(false);
  });

  it("keeps the state list stable", () => {
    expect(withdrawalLifecycleStates).toEqual([
      "requested",
      "pending",
      "approved",
      "submitted",
      "confirmed",
      "failed",
      "reversed",
      "cancelled"
    ]);
  });
});
