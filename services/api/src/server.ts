import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createDatabase } from "@tradeshark/database";
import { IdentityError, IdentityService } from "@tradeshark/identity";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL;

const database = databaseUrl ? createDatabase(databaseUrl) : null;
const identity = database ? new IdentityService(database.db) : null;

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!Buffer.concat(chunks).length) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function sessionCookie(token: string, expiresAt: Date): string {
  return `tradeshark_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}`;
}

function clearSessionCookie(): string {
  return "tradeshark_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function getSessionToken(req: IncomingMessage): string | null {
  const cookies = req.headers.cookie?.split(";").map((value) => value.trim()) ?? [];
  const cookie = cookies.find((value) => value.startsWith("tradeshark_session="));
  return cookie ? decodeURIComponent(cookie.slice("tradeshark_session=".length)) : null;
}

function requireIdentity(res: ServerResponse): IdentityService | null {
  if (!identity) {
    json(res, 503, { error: "DATABASE_UNAVAILABLE" });
    return null;
  }
  return identity;
}

const server = createServer(async (req, res) => {
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
      const token = getSessionToken(req);
      const result = token ? await auth.validateSession(token) : null;
      if (!result) {
        json(res, 401, { error: "UNAUTHENTICATED" });
        return;
      }
      json(res, 200, { user: result.user, expiresAt: result.expiresAt });
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

  json(res, 404, { error: "NOT_FOUND" });
});

server.listen(port, host, () => {
  console.log(`TradeShark API listening on ${host}:${port}`);
});

process.on("SIGTERM", async () => {
  server.close();
  await database?.pool.end();
});
