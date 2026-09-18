import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@tradeshark/database";
import { getRecentMarketTrades } from "./trades.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabase(databaseUrl) : null;

integration("recent market trades integration", () => {
  afterAll(async () => { await database?.pool.end(); });

  it("returns newest market trades first and preserves decimal values", async () => {
    if (!database) throw new Error("DATABASE_URL is required");
    const marketId = randomUUID(), baseAssetId = randomUUID(), quoteAssetId = randomUUID();
    const userIds = [randomUUID(), randomUUID()], orderIds = [randomUUID(), randomUUID()];
    const tradeIds = [randomUUID(), randomUUID(), randomUUID()];
    await database.pool.query("INSERT INTO users (id,email,username) VALUES ($1,$2,$3),($4,$5,$6)", [userIds[0], `rt-${userIds[0]}@example.test`, `rt_${userIds[0]!.slice(0,8)}`, userIds[1], `rt-${userIds[1]}@example.test`, `rt_${userIds[1]!.slice(0,8)}`]);
    await database.pool.query("INSERT INTO assets (id,symbol,name,decimals) VALUES ($1,'RTB','Recent Trade Base',18),($2,'RTQ','Recent Trade Quote',18)", [baseAssetId, quoteAssetId]);
    await database.pool.query("INSERT INTO markets (id,symbol,base_asset_id,quote_asset_id) VALUES ($1,'RTB/RTQ',$2,$3)", [marketId,baseAssetId,quoteAssetId]);
    await database.pool.query("INSERT INTO orders (id,user_id,market_id,side,status,quantity,remaining_quantity,limit_price,fee_rate,client_order_id) VALUES ($1,$2,$3,'buy','filled','10','0','100','0.0055',$4),($5,$6,$3,'sell','filled','10','0','100','0.0055',$7)", [orderIds[0],userIds[0],marketId,`rt-${orderIds[0]}`,orderIds[1],userIds[1],`rt-${orderIds[1]}`]);
    try {
      await database.pool.query("INSERT INTO trades (id,market_id,buy_order_id,sell_order_id,price,quantity,fee_amount,executed_at) VALUES ($1,$2,$3,$4,'101.500000000000000000','1.250000000000000000','0.00696875',NOW()-INTERVAL '3 seconds'),($5,$2,$3,$4,'102.25','2.5','0.014059375',NOW()-INTERVAL '2 seconds'),($6,$2,$3,$4,'103.000000000000000000','0.75','0.00424875',NOW()-INTERVAL '1 second')", [tradeIds[0],marketId,orderIds[0],orderIds[1],tradeIds[1],tradeIds[2]]);
      const recent = await getRecentMarketTrades(database.db, marketId, 2);
      expect(recent).toHaveLength(2);
      expect(recent[0]).toMatchObject({id:tradeIds[2],marketId,price:"103",quantity:"0.75"});
      expect(recent[1]).toMatchObject({id:tradeIds[1],marketId,price:"102.25",quantity:"2.5"});
      expect(recent[0]!.executedAt).toBeInstanceOf(Date);
      expect(await getRecentMarketTrades(database.db, randomUUID(), 50)).toEqual([]);
    } finally {
      await database.pool.query("DELETE FROM trades WHERE id = ANY($1::uuid[])", [tradeIds]);
      await database.pool.query("DELETE FROM orders WHERE id = ANY($1::uuid[])", [orderIds]);
      await database.pool.query("DELETE FROM markets WHERE id = $1", [marketId]);
      await database.pool.query("DELETE FROM assets WHERE id = ANY($1::uuid[])", [[baseAssetId,quoteAssetId]]);
      await database.pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    }
  });
});
