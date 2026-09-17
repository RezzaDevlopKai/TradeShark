import { describe, expect, it } from "vitest";
import { authorize, hasPermission } from "./policy.js";

describe("authorization policy", () => {
  const user = {
    userId: "user-1",
    role: "user" as const,
    status: "active" as const
  };

  it("grants normal user permissions", () => {
    expect(hasPermission("user", "wallet:withdraw")).toBe(true);
    expect(hasPermission("user", "admin:write")).toBe(false);
  });

  it("requires an active account", () => {
    expect(authorize({ ...user, status: "suspended" }, "account:read")).toEqual({
      allowed: false,
      reason: "ACCOUNT_INACTIVE"
    });
  });

  it("denies permissions outside the role", () => {
    expect(authorize(user, "admin:read")).toEqual({
      allowed: false,
      reason: "PERMISSION_DENIED"
    });
  });

  it("enforces resource ownership for non-admin users", () => {
    expect(authorize(user, "wallet:read", "user-2")).toEqual({
      allowed: false,
      reason: "RESOURCE_OWNERSHIP_REQUIRED"
    });
    expect(authorize(user, "wallet:read", "user-1")).toEqual({ allowed: true });
  });

  it("allows admins to access another user's resource", () => {
    expect(
      authorize(
        { userId: "admin-1", role: "admin", status: "active" },
        "wallet:read",
        "user-2"
      )
    ).toEqual({ allowed: true });
  });

  it("rejects missing authentication before checking permissions", () => {
    expect(authorize(null, "account:read")).toEqual({
      allowed: false,
      reason: "UNAUTHENTICATED"
    });
  });
});
