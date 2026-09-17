import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

const server = createServer((req, res) => {
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

  json(res, 404, { error: "NOT_FOUND" });
});

server.listen(port, host, () => {
  console.log(`TradeShark API listening on ${host}:${port}`);
});
