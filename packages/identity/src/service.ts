import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { authSessions, userCredentials, users } from "@tradeshark/database";
import { hashPassword, verifyPassword } from "./password.js";
import { createSessionToken, hashSessionToken } from "./session.js";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

export type PublicUser = Pick<typeof users.$inferSelect, "id" | "email" | "username" | "status" | "createdAt" | "updatedAt">;

export type SessionResult = {
  token: string;
  expiresAt: Date;
  user: PublicUser;
};

export type IdentityServiceOptions = {
  now?: () => Date;
  sessionTtlMs?: number;
};

export class IdentityService {
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;

  constructor(
    private readonly db: TradeSharkDatabase,
    options: IdentityServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;

    if (!Number.isSafeInteger(this.sessionTtlMs) || this.sessionTtlMs <= 0) {
      throw new Error("Session TTL must be a positive safe integer");
    }
  }

  async register(input: {
    email: string;
    username: string;
    password: string;
    userAgent?: string | null;
  }): Promise<SessionResult> {
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);
    validateCredentials(email, username);

    const passwordHash = await hashPassword(input.password);
    const userId = randomUUID();
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.sessionTtlMs);

    try {
      const user = await this.db.transaction(async (tx) => {
        const [createdUser] = await tx
          .insert(users)
          .values({
            id: userId,
            email,
            username,
            status: "active",
            createdAt,
            updatedAt: createdAt
          })
          .returning();

        if (!createdUser) {
          throw new IdentityError("Unable to create user");
        }

        await tx.insert(userCredentials).values({
          userId: createdUser.id,
          passwordHash,
          passwordUpdatedAt: createdAt,
          createdAt,
          updatedAt: createdAt
        });

        await tx.insert(authSessions).values({
          id: randomUUID(),
          userId: createdUser.id,
          tokenHash,
          expiresAt,
          lastSeenAt: createdAt,
          userAgent: input.userAgent ?? null,
          createdAt,
          updatedAt: createdAt
        });

        return createdUser;
      });

      return { token, expiresAt, user: toPublicUser(user) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new IdentityError("Email or username is already registered");
      }
      throw error;
    }
  }

  async login(input: {
    email: string;
    password: string;
    userAgent?: string | null;
  }): Promise<SessionResult> {
    const email = normalizeEmail(input.email);
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user) {
      throw new IdentityError("Invalid email or password");
    }

    const [credentials] = await this.db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, user.id))
      .limit(1);

    if (!credentials || !(await verifyPassword(input.password, credentials.passwordHash))) {
      throw new IdentityError("Invalid email or password");
    }

    if (user.status !== "active") {
      throw new IdentityError("User account is not active");
    }

    return this.createSession(user, input.userAgent ?? null);
  }

  async validateSession(token: string): Promise<{ sessionId: string; expiresAt: Date; user: PublicUser } | null> {
    if (!token) return null;

    const tokenHash = hashSessionToken(token);
    const now = this.now();
    const [row] = await this.db
      .select({
        session: authSessions,
        user: users
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.tokenHash, tokenHash),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, now),
          eq(users.status, "active")
        )
      )
      .limit(1);

    if (!row) return null;

    await this.db
      .update(authSessions)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(
        and(
          eq(authSessions.id, row.session.id),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, now)
        )
      );

    return {
      sessionId: row.session.id,
      expiresAt: row.session.expiresAt,
      user: toPublicUser(row.user)
    };
  }

  async logout(token: string): Promise<boolean> {
    if (!token) return false;

    const tokenHash = hashSessionToken(token);
    const now = this.now();
    const result = await this.db
      .update(authSessions)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });

    return result.length > 0;
  }

  private async createSession(user: typeof users.$inferSelect, userAgent: string | null): Promise<SessionResult> {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.sessionTtlMs);

    await this.db.insert(authSessions).values({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt,
      lastSeenAt: createdAt,
      userAgent,
      createdAt,
      updatedAt: createdAt
    });

    return { token, expiresAt, user: toPublicUser(user) };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateCredentials(email: string, username: string): void {
  if (!email || !email.includes("@") || email.length > 320) {
    throw new IdentityError("Invalid email");
  }
  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    throw new IdentityError("Username must be 3-32 characters and use only letters, numbers, or underscores");
  }
}

function toPublicUser(user: typeof users.$inferSelect): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}
