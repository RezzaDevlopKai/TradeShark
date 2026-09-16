import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://tradeshark:tradeshark@localhost:5432/tradeshark"
  },
  strict: true,
  verbose: true
});
