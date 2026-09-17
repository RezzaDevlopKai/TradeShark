import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { createDatabase } from "@tradeshark/database";
import { IdentityError, IdentityService } from "@tradeshark/identity";

const MAX_JSON_BODY_BYTES = 32 * 1024;

export function createApiServer(identity: IdentityService | null) {
  function json(res: ServerResponse, status: number, body: unknown) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer"
    });
    res.end(payload);
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

  function requireIdentity(res: ServerResponse): IdentityService | null {
    if (!identity) {
      json(res, 503, { error: "DATABASE_UNAVAILABLE" });
      return null;
    }
    return identity;
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
  const server = createApiServer(identity);

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
