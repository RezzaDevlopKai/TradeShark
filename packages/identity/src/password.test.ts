import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("hashes and verifies a valid password", async () => {
    const password = "correct-horse-battery-staple";
    const hash = await hashPassword(password);

    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(hash).not.toContain(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("uses a fresh salt for each password hash", async () => {
    const password = "correct-horse-battery-staple";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(password, second)).toBe(true);
  });

  it("rejects passwords shorter than the minimum", async () => {
    await expect(hashPassword("too-short")).rejects.toThrow("at least 12 characters");
  });

  it("fails closed for malformed hashes", async () => {
    expect(await verifyPassword("some-password", "not-a-valid-hash")).toBe(false);
    expect(await verifyPassword("some-password", "scrypt$bad$8$1$salt$key")).toBe(false);
  });
});
