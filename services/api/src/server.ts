import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { authorize } from "@tradeshark/authorization";
import { createDatabase } from "@tradeshark/database";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { IdentityError, IdentityService } from "@tradeshark/identity";
import { createManualDepositRequest, createWithdrawalRequest, getUserBalances, getUserDeposits, getUserWithdrawals } from "@tradeshark/wallet";

const MAX_JSON_BODY_BYTES = 32 * 1024;
const AUTH_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const AUTH_LOGIN_LIMIT = 10;
const AUTH_REGISTER_LIMIT = 5;

type RateLimitBucket = { count: number; resetAt: number };

type AuthenticatedIdentity = {
  sessionId: string;
  expiresAt: Date;
  user: NonNullable<Awaited<ReturnType<IdentityService["validateSession"]>>>["user"];
};

export function createApiServer(identity: IdentityService | null, database: TradeSharkDatabase | null = null) {
  const rateLimits = new Map<string, RateLimitBucket>();

  function json(res: ServerResponse, status: number, body: unknown, retryAfterSeconds?: number) {
    const headers: Record<string, string | number> = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer"
    };
    if (retryAfterSeconds !== undefined) headers["retry-after"] = retryAfterSeconds;
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    const contentType = (req.headers["content-type"]?.split(";", 1)[0] ?? "").trim().toLowerCase();
    if (contentType !== "application/json") return null;

    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_JSON_BODY_BYTES) return null;

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_JSON_BODY_BYTES) return null;
      chunks.push(buffer);
    }

    const payload = Buffer.concat(chunks);
    if (!payload.length) return {};
    try {
      const parsed: unknown = JSON.parse(payload.toString("utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  function sessionCookie(token: string, expiresAt: Date): string {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `tradeshark_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
  }

  function clearSessionCookie(): string {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `tradeshark_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  }

  function getSessionToken(req: IncomingMessage): string | null {
    const cookies = req.headers.cookie?.split(";").map((value) => value.trim()) ?? [];
    const cookie = cookies.find((value) => value.startsWith("tradeshark_session="));
    if (!cookie) return null;
    try {
      return decodeURIComponent(cookie.slice("tradeshark_session=".length));
    } catch {
      return null;
    }
  }

  function clientKey(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? "unknown";
  }

  function consumeRateLimit(req: IncomingMessage, route: "login" | "register", limit: number): number | null {
    const now = Date.now();
    const key = `${route}:${clientKey(req)}`;
    const current = rateLimits.get(key);
    if (!current || current.resetAt <= now) {
      rateLimits.set(key, { count: 1, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS });
      return null;
    }
    if (current.count >= limit) {
      return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    }
    current.count += 1;
    return null;
  }

  function clearRateLimit(req: IncomingMessage, route: "login" | "register") {
    rateLimits.delete(`${route}:${clientKey(req)}`);
  }

  function requireIdentity(res: ServerResponse): IdentityService | null {
    if (!identity) {
      json(res, 503, { error: "DATABASE_UNAVAILABLE" });
      return null;
    }
    return identity;
  }

  async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<AuthenticatedIdentity | null> {
    const auth = requireIdentity(res);
    if (!auth) return null;

    const token = getSessionToken(req);
    const result = token ? await auth.validateSession(token) : null;
    if (!result) {
      json(res, 401, { error: "UNAUTHENTICATED" });
      return null;
    }
    return result;
  }

  function requirePermission(
    res: ServerResponse,
    session: AuthenticatedIdentity,
    permission: Parameters<typeof authorize>[1],
    ownerUserId?: string
  ): boolean {
    const decision = authorize(
      {
        userId: session.user.id,
        role: "user",
        status: session.user.status
      },
      permission,
      ownerUserId
    );

    if (decision.allowed) return true;
    json(res, decision.reason === "UNAUTHENTICATED" ? 401 : 403, { error: decision.reason });
    return false;
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { status: "ok", service: "tradeshark-api" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/status") {
        json(res, 200, {
          service: "tradeshark-api",
          status: "operational",
          version: "0.1.0"
        });
        return;
      }

      if (url.pathname.startsWith("/api/v1/auth/")) {
        const auth = requireIdentity(res);
        if (!auth) return;

        if (req.method === "POST" && url.pathname === "/api/v1/auth/register") {
          const retryAfter = consumeRateLimit(req, "register", AUTH_REGISTER_LIMIT);
          if (retryAfter !== null) {
            json(res, 429, { error: "RATE_LIMITED" }, retryAfter);
            return;
          }

          const body = await readJson(req);
          if (!body || typeof body.email !== "string" || typeof body.username !== "string" || typeof body.password !== "string") {
            json(res, 400, { error: "INVALID_REQUEST" });
            return;
          }

          try {
            const result = await auth.register({
              email: body.email,
              username: body.username,
              password: body.password,
              userAgent: req.headers["user-agent"] ?? null
            });
            clearRateLimit(req, "register");
            res.setHeader("set-cookie", sessionCookie(result.token, result.expiresAt));
            json(res, 201, { user: result.user, expiresAt: result.expiresAt });
          } catch (error) {
            if (error instanceof IdentityError) {
              json(res, 400, { error: error.message });
              return;
            }
            json(res, 500, { error: "INTERNAL_SERVER_ERROR" });
          }
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/v1/auth/login") {
          const retryAfter = consumeRateLimit(req, "login", AUTH_LOGIN_LIMIT);
          if (retryAfter !== null) {
            json(res, 429, { error: "RATE_LIMITED" }, retryAfter);
            return;
          }

          const body = await readJson(req);
          if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
            json(res, 400, { error: "INVALID_REQUEST" });
            return;
          }

          try {
            const result = await auth.login({
              email: body.email,
              password: body.password,
              userAgent: req.headers["user-agent"] ?? null
            });
            clearRateLimit(req, "login");
            res.setHeader("set-cookie", sessionCookie(result.token, result.expiresAt));
            json(res, 200, { user: result.user, expiresAt: result.expiresAt });
          } catch (error) {
            if (error instanceof IdentityError) {
              json(res, 401, { error: error.message });
              return;
            }
            json(res, 500, { error: "INTERNAL_SERVER_ERROR" });
          }
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/v1/auth/session") {
          const session = await authenticate(req, res);
          if (!session) return;
          json(res, 200, { user: session.user, expiresAt: session.expiresAt });
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/v1/auth/logout") {
          const token = getSessionToken(req);
          await auth.logout(token ?? "");
          res.setHeader("set-cookie", clearSessionCookie());
          json(res, 200, { loggedOut: true });
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/v1/account/me") {
        const session = await authenticate(req, res);
        if (!session) return;
        if (!requirePermission(res, session, "account:read", session.user.id)) return;
        json(res, 200, { user: session.user });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/v1/wallet/deposits") {
        const session = await authenticate(req, res);
        if (!session) return;
        if (!requirePermission(res, session, "wallet:deposit", session.user.id)) return;
        if (!database) {
          json(res, 503, { error: "DATABASE_UNAVAILABLE" });
          return;
        }

        const idempotencyKey = req.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey.trim())) {
          json(res, 400, { error: "INVALID_IDEMPOTENCY_KEY" });
          return;
        }

        const body = await readJson(req);
        if (
          !body ||
          typeof body.assetId !== "string" ||
          typeof body.amount !== "string" ||
          (body.note !== undefined && typeof body.note !== "string")
        ) {
          json(res, 400, { error: "INVALID_REQUEST" });
          return;
        }

        try {
          const result = await createManualDepositRequest(database, {
            userId: session.user.id,
            assetId: body.assetId,
            amount: body.amount,
            ...(body.note === undefined ? {} : { note: body.note }),
            idempotencyKey: idempotencyKey.trim()
          });
          json(res, 201, result);
        } catch (error) {
          if (error instanceof Error && (
            error.message.startsWith("Minimum deposit amount") ||
            error.message.startsWith("Invalid positive decimal") ||
            error.message === "Invalid idempotency key"
          )) {
            json(res, 400, { error: error.message });
            return;
          }
          if (error instanceof Error && error.message.includes("Idempotency key was already used")) {
            json(res, 409, { error: "IDEMPOTENCY_CONFLICT" });
            return;
          }
          json(res, 500, { error: "INTERNAL_SERVER_ERROR" });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/v1/wallet/withdrawals") {
        const session = await authenticate(req, res);
        if (!session) return;
        if (!requirePermission(res, session, "wallet:withdraw", session.user.id)) return;
        if (!database) {
          json(res, 503, { error: "DATABASE_UNAVAILABLE" });
          return;
        }

        const idempotencyKey = req.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey.trim())) {
          json(res, 400, { error: "INVALID_IDEMPOTENCY_KEY" });
          return;
        }

        const body = await readJson(req);
        if (
          !body ||
          typeof body.assetId !== "string" ||
          typeof body.amount !== "string" ||
          typeof body.destination !== "string"
        ) {
          json(res, 400, { error: "INVALID_REQUEST" });
          return;
        }

        try {
          const result = await createWithdrawalRequest(database, {
            userId: session.user.id,
            assetId: body.assetId,
            amount: body.amount,
            destination: body.destination,
            idempotencyKey: idempotencyKey.trim()
          });
          json(res, result.idempotent ? 200 : 201, result);
        } catch (error) {
          if (error instanceof Error && (
            error.message.startsWith("Invalid positive decimal") ||
            error.message === "Invalid idempotency key" ||
            error.message === "Withdrawal destination is required" ||
            error.message === "Withdrawals are supported only for active USDT" ||
            error.message === "Minimum USDT withdrawal is 10"
          )) {
            json(res, 400, { error: error.message });
            return;
          }
          if (error instanceof Error && error.message.includes("Idempotency key was already used")) {
            json(res, 409, { error: "IDEMPOTENCY_CONFLICT" });
            return;
          }
          if (error instanceof Error && error.message.includes("Required withdrawal ledger accounts")) {
            json(res, 409, { error: "WALLET_NOT_PROVISIONED" });
            return;
          }
          json(res, 500, { error: "INTERNAL_SERVER_ERROR" });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/wallet/withdrawals") {
        const session = await authenticate(req, res);
        if (!session) return;
        if (!requirePermission(res, session, "wallet:read", session.user.id)) return;
        if (!database) {
          json(res, 503, { error: "DATABASE_UNAVAILABLE" });
          return;
        }

        const rawLimit = url.searchParams.get("limit");
        const parsedLimit = rawLimit === null ? 50 : Number(rawLimit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
          json(res, 400, { error: "INVALID_LIMIT" });
          return;
        }

        const withdrawals = await getUserWithdrawals(database, session.user.id, parsedLimit);
        json(res, 200, { withdrawals });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/wallet/deposits") {
        const session = await authenticate(req, res);
        if (!session) return;
        if (!requirePermission(res, session, "wallet:read", session.user.id)) return;
        if (!database) {
          json(res, 503, { error: "DATABASE_UNAVAILABLE" });
          return;
        }

        const rawLimit = url.searchParams.get("limit");
        const parsedLimit = rawLimit === null ? 50 : Number(rawLimit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
          json(res, 400, { error: "INVALID_LIMIT" });
          return;
        }

        const deposits = await getUserDeposits(database, session.user.id, parsedLimit);
        json(res, 200, { deposits });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/wallet/balances") {
        const session = await authenticate(req, res);
        if (!session) return;
        if (!requirePermission(res, session, "wallet:read", session.user.id)) return;
        if (!database) {
          json(res, 503, { error: "DATABASE_UNAVAILABLE" });
          return;
        }

        const balances = await getUserBalances(database, session.user.id);
        json(res, 200, { balances });
        return;
      }

      json(res, 404, { error: "NOT_FOUND" });
    } catch {
      if (!res.headersSent) json(res, 500, { error: "INTERNAL_SERVER_ERROR" });
      else res.destroy();
    }
  });
}

export async function startApiServer() {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  const databaseUrl = process.env.DATABASE_URL;
  const database = databaseUrl ? createDatabase(databaseUrl) : null;
  const identity = database ? new IdentityService(database.db) : null;
  const server = createApiServer(identity, database?.db ?? null);

  server.on("close", () => {
    void database?.pool.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  console.log(`TradeShark API listening on ${host}:${port}`);
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = await startApiServer();
  process.once("SIGTERM", () => server.close());
  process.once("SIGINT", () => server.close());
}
