import { defineConfig } from "vitest/config";

/**
 * Keep Vitest's ESM test imports deterministic when the production TypeScript
 * source uses Node-style .js specifiers. Vite normally remaps these, but this
 * explicit resolver makes the contract unambiguous for integration tests.
 */
const localTsSpecifierResolver = {
  name: "tradeshark-local-ts-specifiers",
  enforce: "pre" as const,
  async resolveId(source: string, importer?: string) {
    if (!importer || !source.startsWith("./") || !source.endsWith(".js")) return null;
    const tsSource = `${source.slice(0, -3)}.ts`;
    return this.resolve(tsSource, importer, { skipSelf: true });
  }
};

export default defineConfig({
  plugins: [localTsSpecifierResolver]
});
