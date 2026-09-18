import { asc, eq } from "drizzle-orm";
import type { TradeSharkDatabase } from "@tradeshark/database";
import { assets, markets } from "@tradeshark/database";

export type ActiveMarket = {
  id: string;
  symbol: string;
  isActive: boolean;
  baseAsset: { id: string; symbol: string; name: string; decimals: number };
  quoteAsset: { id: string; symbol: string; name: string; decimals: number };
};

export async function getActiveMarkets(db: TradeSharkDatabase, limit = 100): Promise<ActiveMarket[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be between 1 and 100");
  }

  const rows = await db
    .select({
      id: markets.id,
      symbol: markets.symbol,
      isActive: markets.isActive,
      baseId: assets.id,
      baseSymbol: assets.symbol,
      baseName: assets.name,
      baseDecimals: assets.decimals,
      quoteId: assets.id,
      quoteSymbol: assets.symbol,
      quoteName: assets.name,
      quoteDecimals: assets.decimals
    })
    .from(markets)
    .innerJoin(assets, eq(markets.baseAssetId, assets.id))
    .where(eq(markets.isActive, true))
    .orderBy(asc(markets.symbol))
    .limit(limit);

  const quoteRows = await db
    .select({
      marketId: markets.id,
      quoteId: assets.id,
      quoteSymbol: assets.symbol,
      quoteName: assets.name,
      quoteDecimals: assets.decimals
    })
    .from(markets)
    .innerJoin(assets, eq(markets.quoteAssetId, assets.id))
    .where(eq(markets.isActive, true))
    .orderBy(asc(markets.symbol))
    .limit(limit);

  const quoteByMarket = new Map(quoteRows.map((row) => [row.marketId, row]));

  return rows.map((row) => {
    const quote = quoteByMarket.get(row.id);
    if (!quote) throw new Error(`Quote asset missing for market ${row.id}`);
    return {
      id: row.id,
      symbol: row.symbol,
      isActive: row.isActive,
      baseAsset: { id: row.baseId, symbol: row.baseSymbol, name: row.baseName, decimals: row.baseDecimals },
      quoteAsset: { id: quote.quoteId, symbol: quote.quoteSymbol, name: quote.quoteName, decimals: quote.quoteDecimals }
    };
  });
}
