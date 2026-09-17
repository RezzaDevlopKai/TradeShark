import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Resolve Node-style ESM .js specifiers to the sibling TypeScript source file.
 *
 * Using an absolute filesystem path avoids asking Vite to recursively resolve
 * the rewritten specifier. That keeps integration tests pinned to the exact
 * source module under test instead of allowing an alternate .js artifact or
 * package entrypoint to win resolution.
 */
const localTsSpecifierResolver = {
  name: "tradeshark-local-ts-specifiers",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !source.startsWith("./") || !source.endsWith(".js")) return null;
    return resolve(dirname(importer), `${source.slice(0, -3)}.ts`);
  }
};

export default defineConfig({
  plugins: [localTsSpecifierResolver]
});
