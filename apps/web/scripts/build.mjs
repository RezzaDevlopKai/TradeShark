import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ["index.html", "styles.css", "app.js", "robots.txt", "sitemap.xml"]) {
  await cp(resolve(root, name), resolve(dist, name));
}
console.log(`TradeShark web built to ${dist}`);
