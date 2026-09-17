import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";
import * as identity from "./identity.js";

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema: { ...schema, ...identity } });

  return { db, pool };
}

export type TradeSharkDatabase = ReturnType<typeof createDatabase>["db"];
