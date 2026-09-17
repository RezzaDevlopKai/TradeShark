import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type TradeSharkDatabase } from "@tradeshark/database";
import { IdentityError, IdentityService } from "./service.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL ? describe : describe.skip;

let db: TradeSharkDatabase;
let pool: ReturnType<typeof createDatabase>["pool"];

beforeAll(() => {
  if (!DATABASE_URL) return;
  const database = createDatabase(DATABASE_URL);
  db = database.db;
  pool = database.pool;
});

afterAll(async () => {
  await pool?.end();
});

describeIntegration("identity service", () => {
  it("registers, validates, and logs out a session", async () => {
    const service = new IdentityService(db);

    const registration = await service.register({
      email: "alice@example.com",
      username: "Alice_01",
      password: "correct-horse-battery-staple",
      userAgent: "vitest"
    });

    expect(registration.user.email).toBe("alice@example.com");
    expect(registration.user.username).toBe("alice_01");
    expect(registration.token.length).toBeGreaterThan(20);

    const validated = await service.validateSession(registration.token);
    expect(validated?.user.id).toBe(registration.user.id);
    expect(validated?.user.email).toBe("alice@example.com");

    await expect(
      service.login({
        email: "ALICE@EXAMPLE.COM",
        password: "correct-horse-battery-staple"
      })
    ).resolves.toMatchObject({ user: { id: registration.user.id } });

    await expect(service.logout(registration.token)).resolves.toBe(true);
    await expect(service.validateSession(registration.token)).resolves.toBeNull();
    await expect(service.logout(registration.token)).resolves.toBe(false);
  });

  it("normalizes email and username and rejects duplicate registration", async () => {
    const service = new IdentityService(db);

    const first = await service.register({
      email: " Bob@Example.COM ",
      username: "Bob_01",
      password: "another-correct-password"
    });

    expect(first.user.email).toBe("bob@example.com");
    expect(first.user.username).toBe("bob_01");

    await expect(
      service.register({
        email: "bob@example.com",
        username: "different_user",
        password: "another-correct-password"
      })
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it("rejects invalid login credentials", async () => {
    const service = new IdentityService(db);

    await service.register({
      email: "carol@example.com",
      username: "carol_01",
      password: "a-secure-password-for-test"
    });

    await expect(
      service.login({
        email: "carol@example.com",
        password: "wrong-password"
      })
    ).rejects.toThrow("Invalid email or password");
  });

  it("does not validate an expired session", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const service = new IdentityService(db, {
      now: () => new Date(now),
      sessionTtlMs: 60_000
    });

    const registration = await service.register({
      email: "dave@example.com",
      username: "dave_01",
      password: "a-secure-password-for-test"
    });

    now = new Date(now.getTime() + 60_001);
    await expect(service.validateSession(registration.token)).resolves.toBeNull();
  });
});
