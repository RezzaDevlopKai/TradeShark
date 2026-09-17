import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");

await execFileAsync(process.execPath, [resolve(root, "scripts/build.mjs")]);

const required = [
  "index.html",
  "markets.html",
  "intelligence.html",
  "mayhem.html",
  "trade.html",
  "styles.css",
  "app.js",
  "api.js",
  "robots.txt",
  "sitemap.xml"
];

for (const name of required) {
  await access(resolve(dist, name));
}

const app = await readFile(resolve(dist, "app.js"), "utf8");
const api = await readFile(resolve(dist, "api.js"), "utf8");
if (!app.includes('from "./api.js"')) {
  throw new Error("app.js is missing the API client import");
}
if (!api.includes("/api/v1/status")) {
  throw new Error("api.js is missing the platform status endpoint");
}

const pages = ["index.html", "markets.html", "intelligence.html", "mayhem.html", "trade.html"];
for (const name of pages) {
  const html = await readFile(resolve(dist, name), "utf8");
  if (!html.includes("./styles.css")) {
    throw new Error(`${name} is missing the shared stylesheet`);
  }
  if (!html.includes("TradeShark")) {
    throw new Error(`${name} is missing TradeShark branding`);
  }
}

const index = await readFile(resolve(dist, "index.html"), "utf8");
for (const href of ["./markets.html", "./intelligence.html", "./mayhem.html", "./trade.html"]) {
  if (!index.includes(`href=\"${href}\"`)) {
    throw new Error(`index.html is missing navigation link ${href}`);
  }
}

const robots = await readFile(resolve(dist, "robots.txt"), "utf8");
if (!robots.includes("Sitemap:")) {
  throw new Error("robots.txt is missing a sitemap declaration");
}

const sitemap = await readFile(resolve(dist, "sitemap.xml"), "utf8");
for (const page of ["/", "/markets.html", "/intelligence.html", "/mayhem.html", "/trade.html"]) {
  if (!sitemap.includes(`<loc>https://tradeshark.app${page}</loc>`)) {
    throw new Error(`sitemap.xml is missing ${page}`);
  }
}

console.log("TradeShark web verification passed");
