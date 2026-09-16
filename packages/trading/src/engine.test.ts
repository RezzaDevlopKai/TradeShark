import { describe, expect, it } from "vitest";
import { calculateFee, matchLimitOrder, normalizeDecimal, validateLimitOrder } from "./engine.js";

const maker = (id: string, userId: string, side: "buy" | "sell", price: string, quantity: string, sequence: number) => ({
  id, userId, side, price, quantity, sequence, status: "open" as const
});

describe("trading core", () => {
  it("normalizes decimals without floating point arithmetic", () => {
    expect(normalizeDecimal("2.5")).toBe("2.500000000000000000");
    expect(normalizeDecimal("0.000000000000000001")).toBe("0.000000000000000001");
  });

  it("rejects invalid precision and non-positive values", () => {
    expect(() => validateLimitOrder(maker("o", "u", "buy", "1.0000000000000000001", "1", 1))).toThrow();
    expect(() => validateLimitOrder(maker("o", "u", "buy", "1", "0", 1))).toThrow();
  });

  it("matches best price first, then FIFO at the same price", () => {
    const result = matchLimitOrder(
      maker("taker", "taker-user", "buy", "105", "12", 99),
      [
        maker("late", "maker-2", "sell", "100", "3", 20),
        maker("early", "maker-1", "sell", "100", "4", 10),
        maker("best", "maker-3", "sell", "99", "5", 30),
        maker("too-expensive", "maker-4", "sell", "106", "50", 1)
      ],
      "0.0055",
      (i) => `trade-${i}`
    );

    expect(result.trades).toHaveLength(3);
    expect(result.trades.map((trade) => [trade.sellOrderId, trade.price, trade.quantity])).toEqual([
      ["best", "99.000000000000000000", "5.000000000000000000"],
      ["early", "100.000000000000000000", "4.000000000000000000"],
      ["late", "100.000000000000000000", "3.000000000000000000"]
    ]);
    expect(result.takerRemaining).toBe("0.000000000000000000");
  });

  it("partially fills a maker and leaves the remainder on the book", () => {
    const result = matchLimitOrder(
      maker("taker", "buyer", "buy", "10", "3", 2),
      [maker("maker", "seller", "sell", "9", "5", 1)],
      "0.0055",
      () => "trade-1"
    );

    expect(result.trades[0]?.quantity).toBe("3.000000000000000000");
    expect(result.makerOrders[0]?.remainingQuantity).toBe("2.000000000000000000");
    expect(result.makerOrders[0]?.status).toBe("partially_filled");
  });

  it("calculates the configured 0.55% fee deterministically", () => {
    expect(calculateFee("100", "2")).toBe("1.100000000000000000");
  });

  it("prevents self matching", () => {
    const result = matchLimitOrder(
      maker("taker", "same-user", "buy", "10", "1", 2),
      [maker("maker", "same-user", "sell", "9", "1", 1)]
    );
    expect(result.trades).toEqual([]);
    expect(result.takerRemaining).toBe("1.000000000000000000");
  });
});
