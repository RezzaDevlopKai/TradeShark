import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Resolve Node-style ESM .js specifiers to the sibling TypeScript source file.
 *
 * Execution tests use one explicit source entrypoint so the public package
 * entrypoint and the integration suites cannot accidentally resolve different
 * execution implementations during Vitest's transform phase.
 */
const localTsSpecifierResolver = {
  name: "tradeshark-local-ts-specifiers",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !source.startsWith("./") || !source.endsWith(".js")) return null;
    const sourcePath = source.slice(0, -3);
    if (sourcePath === "./execution") return resolve(dirname(importer), "execution.test-entry.ts");
    return resolve(dirname(importer), `${sourcePath}.ts`);
  }
};

export default defineConfig({
  plugins: [localTsSpecifierResolver]
});
