import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const port = 3100 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;

let server: ChildProcess | undefined;

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The child may need another moment to bind the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("API server did not become healthy within 3 seconds");
}

test.before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore"
  });
  await waitForHealth();
});

test.after(async () => {
  if (!server) return;
  server.kill("SIGTERM");
  await once(server, "exit");
});

test("platform status exposes the web integration contract and security headers", async () => {
  const response = await fetch(`${baseUrl}/api/v1/status`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "tradeshark-api",
    status: "operational",
    version: "0.1.0"
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("unknown routes return a stable JSON error", async () => {
  const response = await fetch(`${baseUrl}/api/v1/unknown`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
});

test("protected account endpoint requires authentication", async () => {
  const response = await fetch(`${baseUrl}/api/v1/account/me`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "UNAUTHENTICATED" });
});

test("authentication endpoints manage an HttpOnly session and protected account access", async () => {
  const id = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `api-${id}@example.com`;
  const username = `api_${id}`;
  const password = "correct-horse-battery-staple";

  const registration = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, username, password })
  });
  assert.equal(registration.status, 201);
  const registrationBody = await registration.json() as {
    user: {
      id: string;
      email: string;
      username: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    };
    expiresAt: string;
  };
  assert.equal(registrationBody.user.email, email);
  assert.equal(registrationBody.user.username, username);
  assert.equal(registrationBody.user.status, "active");
  assert.ok(registrationBody.user.id);
  assert.ok(registrationBody.user.createdAt);
  assert.ok(registrationBody.user.updatedAt);
  assert.ok(registrationBody.expiresAt);
  assert.match(registration.headers.get("set-cookie") ?? "", /tradeshark_session=/);
  assert.match(registration.headers.get("set-cookie") ?? "", /HttpOnly/);

  const cookie = registration.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);

  const session = await fetch(`${baseUrl}/api/v1/auth/session`, {
    headers: { cookie }
  });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {
    user: registrationBody.user,
    expiresAt: registrationBody.expiresAt
  });

  const account = await fetch(`${baseUrl}/api/v1/account/me`, {
    headers: { cookie }
  });
  assert.equal(account.status, 200);
  assert.deepEqual(await account.json(), { user: registrationBody.user });

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email.toUpperCase(), password })
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie") ?? "", /tradeshark_session=/);

  const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: "POST",
    headers: { cookie }
  });
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { loggedOut: true });
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);

  const afterLogout = await fetch(`${baseUrl}/api/v1/auth/session`, {
    headers: { cookie }
  });
  assert.equal(afterLogout.status, 401);

  const protectedAfterLogout = await fetch(`${baseUrl}/api/v1/account/me`, {
    headers: { cookie }
  });
  assert.equal(protectedAfterLogout.status, 401);
});

test("authentication endpoints reject malformed and invalid credentials", async () => {
  const malformed = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[]"
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "INVALID_REQUEST" });

  const invalidCredentials = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "missing@example.com", password: "wrong-password" })
  });
  assert.equal(invalidCredentials.status, 401);
  assert.deepEqual(await invalidCredentials.json(), { error: "Invalid email or password" });
});

test("authentication endpoints enforce JSON content type and body limits", async () => {
  const unsupportedContentType = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ email: "missing@example.com", password: "wrong-password" })
  });
  assert.equal(unsupportedContentType.status, 400);
  assert.deepEqual(await unsupportedContentType.json(), { error: "INVALID_REQUEST" });

  const oversized = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "a@example.com", password: "x".repeat(33_000) })
  });
  assert.equal(oversized.status, 400);
  assert.deepEqual(await oversized.json(), { error: "INVALID_REQUEST" });
});

test("authentication registration rate limiting returns Retry-After after repeated malformed requests", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]"
    });
    assert.equal(response.status, 400);
  }

  const limited = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[]"
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "RATE_LIMITED" });
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});
