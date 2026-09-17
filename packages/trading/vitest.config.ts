import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Resolve Node-style ESM .js specifiers to the sibling TypeScript source file.
 *
 * Production modules keep Node-compatible .js specifiers, while Vitest runs
 * directly against the TypeScript source tree. The resolver must be a pure
 * extension bridge: it must never redirect one module to a different test
 * entrypoint or implementation.
 */
const localTsSpecifierResolver = {
  name: "tradeshark-local-ts-specifiers",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !source.startsWith("./") || !source.endsWith(".js")) return null;
    const sourcePath = source.slice(0, -3);
    return resolve(dirname(importer), `${sourcePath}.ts`);
  }
};

export default defineConfig({
  plugins: [localTsSpecifierResolver]
});
