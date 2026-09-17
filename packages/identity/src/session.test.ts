import { describe, expect, it } from "vitest";
import { createSessionToken, hashSessionToken, SESSION_TOKEN_BYTES } from "./session.js";

describe("session tokens", () => {
  it("creates cryptographically random tokens with the expected entropy", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(40);
    expect(Buffer.from(first, "base64url")).toHaveLength(SESSION_TOKEN_BYTES);
  });

  it("hashes tokens deterministically without exposing the raw token", () => {
    const token = createSessionToken();
    const hash = hashSessionToken(token);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashSessionToken(token)).toBe(hash);
    expect(hashSessionToken(`${token}-different`)).not.toBe(hash);
  });
});
