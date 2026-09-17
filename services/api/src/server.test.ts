import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
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

test("platform status exposes the web integration contract", async () => {
  const response = await fetch(`${baseUrl}/api/v1/status`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "tradeshark-api",
    status: "operational",
    version: "0.1.0"
  });
});

test("unknown routes return a stable JSON error", async () => {
  const response = await fetch(`${baseUrl}/api/v1/unknown`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
});
