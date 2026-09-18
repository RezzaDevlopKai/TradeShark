import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { createDatabase } from "@tradeshark/database";
import { IdentityService } from "@tradeshark/identity";
import { createApiServer } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabase(databaseUrl) : null;

integration("API market catalog integration", () => {
  after(async () => {
    await database?.pool.end();
  });

  it("lists active markets, excludes inactive markets, respects limits, and validates requests", async () => {
    if (!database) throw new Error("DATABASE_URL is required");

    const baseAssetId = randomUUID();
    const quoteAssetId = randomUUID();
    const secondBaseAssetId = randomUUID();
    const secondQuoteAssetId = randomUUID();
    const inactiveBaseAssetId = randomUUID();
    const inactiveQuoteAssetId = randomUUID();
    const firstMarketId = randomUUID();
    const secondMarketId = randomUUID();
    const inactiveMarketId = randomUUID();
    const identity = new IdentityService(database.db);
    const server = createApiServer(identity, database.db);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API server did not expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await database.pool.query(
        `INSERT INTO assets (id, symbol, name, decimals, is_active) VALUES
          ($1, 'AAA', 'Alpha Asset', 18, true),
          ($2, 'USD', 'US Dollar', 2, true),
          ($3, 'BBB', 'Beta Asset', 8, true),
          ($4, 'USDC', 'USD Coin', 6, true),
          ($5, 'CCC', 'Gamma Asset', 18, true),
          ($6, 'EUR', 'Euro', 2, true)`,
        [baseAssetId, quoteAssetId, secondBaseAssetId, secondQuoteAssetId, inactiveBaseAssetId, inactiveQuoteAssetId]
      );
      await database.pool.query(
        `INSERT INTO markets (id, symbol, base_asset_id, quote_asset_id, is_active) VALUES
          ($1, 'AAA/USD', $2, $3, true),
          ($4, 'BBB/USDC', $5, $6, true),
          ($7, 'CCC/EUR', $8, $9, false)`,
        [firstMarketId, baseAssetId, quoteAssetId, secondMarketId, secondBaseAssetId, secondQuoteAssetId, inactiveMarketId, inactiveBaseAssetId, inactiveQuoteAssetId]
      );

      const response = await fetch(`${baseUrl}/api/v1/markets`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        markets: [
          {
            id: firstMarketId,
            symbol: "AAA/USD",
            isActive: true,
            baseAsset: { id: baseAssetId, symbol: "AAA", name: "Alpha Asset", decimals: 18 },
            quoteAsset: { id: quoteAssetId, symbol: "USD", name: "US Dollar", decimals: 2 }
          },
          {
            id: secondMarketId,
            symbol: "BBB/USDC",
            isActive: true,
            baseAsset: { id: secondBaseAssetId, symbol: "BBB", name: "Beta Asset", decimals: 8 },
            quoteAsset: { id: secondQuoteAssetId, symbol: "USDC", name: "USD Coin", decimals: 6 }
          }
        ]
      });

      const limited = await fetch(`${baseUrl}/api/v1/markets?limit=1`);
      assert.equal(limited.status, 200);
      const limitedBody = await limited.json() as { markets: Array<Record<string, unknown>> };
      assert.equal(limitedBody.markets.length, 1);
      assert.equal(limitedBody.markets[0]?.id, firstMarketId);
      assert.equal(limitedBody.markets[0]?.symbol, "AAA/USD");

      const invalid = await fetch(`${baseUrl}/api/v1/markets?limit=101`);
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), { error: "INVALID_LIMIT" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.pool.query(
        `DELETE FROM markets WHERE id = ANY($1::uuid[])`,
        [[firstMarketId, secondMarketId, inactiveMarketId]]
      );
      await database.pool.query(
        `DELETE FROM assets WHERE id = ANY($1::uuid[])`,
        [[baseAssetId, quoteAssetId, secondBaseAssetId, secondQuoteAssetId, inactiveBaseAssetId, inactiveQuoteAssetId]]
      );
    }
  });

  it("returns service unavailable when the database is not configured", async () => {
    const server = createApiServer(null, null);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API server did not expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/v1/markets`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "DATABASE_UNAVAILABLE" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
