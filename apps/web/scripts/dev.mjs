import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".xml": "application/xml", ".txt": "text/plain" };

createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  try {
    const data = await readFile(resolve(root, file));
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}).listen(4173, "127.0.0.1", () => console.log("TradeShark web: http://127.0.0.1:4173"));
