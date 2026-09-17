export type OrderSide = "buy" | "sell";
export type OrderStatus = "open" | "partially_filled" | "filled" | "cancelled";

export interface LimitOrder {
  id: string;
  userId: string;
  side: OrderSide;
  price: string;
  quantity: string;
  remainingQuantity?: string;
  sequence: number;
  status?: OrderStatus;
  feeRate?: string;
}

export interface Trade {
  id: string;
  buyOrderId: string;
  sellOrderId: string;
  price: string;
  quantity: string;
  feeRate: string;
  feeAmount: string;
}

export interface MatchResult {
  trades: Trade[];
  takerRemaining: string;
  makerOrders: LimitOrder[];
}

const SCALE = 18;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

function parseDecimal(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    throw new Error(`${field} must be a positive decimal with at most 18 decimals`);
  }
  const parts = value.split(".");
  const whole = parts[0] ?? "";
  const fraction = parts[1] ?? "";
  const scaled = BigInt(whole) * SCALE_FACTOR + BigInt(fraction.padEnd(SCALE, "0") || "0");
  if (scaled <= 0n) throw new Error(`${field} must be positive`);
  return scaled;
}

function parseNonNegativeDecimal(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    throw new Error(`${field} must be a non-negative decimal with at most 18 decimals`);
  }
  const parts = value.split(".");
  const whole = parts[0] ?? "";
  const fraction = parts[1] ?? "";
  return BigInt(whole) * SCALE_FACTOR + BigInt(fraction.padEnd(SCALE, "0") || "0");
}

function formatDecimal(value: bigint): string {
  if (value < 0n) throw new Error("decimal value cannot be negative");
  const whole = value / SCALE_FACTOR;
  const fraction = (value % SCALE_FACTOR).toString().padStart(SCALE, "0");
  return `${whole}.${fraction}`;
}

export function normalizeDecimal(value: string): string {
  return formatDecimal(parseDecimal(value, "value"));
}

export function validateLimitOrder(order: LimitOrder): void {
  if (!order.id || !order.userId) throw new Error("order id and userId are required");
  if (order.side !== "buy" && order.side !== "sell") throw new Error("invalid order side");
  parseDecimal(order.price, "price");
  const quantity = parseDecimal(order.quantity, "quantity");
  if (order.remainingQuantity !== undefined) {
    const remaining = parseNonNegativeDecimal(order.remainingQuantity, "remainingQuantity");
    if (remaining > quantity) throw new Error("remainingQuantity cannot exceed quantity");
  }
  if (!Number.isSafeInteger(order.sequence) || order.sequence < 0) {
    throw new Error("sequence must be a non-negative safe integer");
  }
  if (order.feeRate !== undefined) parseDecimal(order.feeRate, "feeRate");
}

function remaining(order: LimitOrder): bigint {
  return parseNonNegativeDecimal(order.remainingQuantity ?? order.quantity, "remainingQuantity");
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function matchLimitOrder(
  taker: LimitOrder,
  makers: readonly LimitOrder[],
  feeRate = "0.0055",
  tradeIdFactory: (index: number, maker: LimitOrder, quantity: string) => string = (index) => `${taker.id}:trade:${index}`
): MatchResult {
  validateLimitOrder(taker);
  let takerRemaining = remaining(taker);
  const candidates = makers
    .map((maker) => {
      validateLimitOrder(maker);
      return maker;
    })
    .filter((maker) => maker.status === undefined || maker.status === "open" || maker.status === "partially_filled")
    .filter((maker) => maker.userId !== taker.userId)
    .filter((maker) => maker.side !== taker.side)
    .filter((maker) => taker.side === "buy"
      ? parseDecimal(maker.price, "price") <= parseDecimal(taker.price, "price")
      : parseDecimal(maker.price, "price") >= parseDecimal(taker.price, "price"))
    .sort((a, b) => {
      const priceA = parseDecimal(a.price, "price");
      const priceB = parseDecimal(b.price, "price");
      const priceCompare = taker.side === "buy"
        ? compareBigInt(priceA, priceB)
        : compareBigInt(priceB, priceA);
      return priceCompare || a.sequence - b.sequence || a.id.localeCompare(b.id);
    });

  const trades: Trade[] = [];
  const makerOrders: LimitOrder[] = [];
  for (const maker of candidates) {
    if (takerRemaining === 0n) break;
    const makerRemaining = remaining(maker);
    const quantity = makerRemaining < takerRemaining ? makerRemaining : takerRemaining;
    const quantityText = formatDecimal(quantity);
    const price = parseDecimal(maker.price, "price");
    const buyerFeeRate = taker.side === "buy" ? (taker.feeRate ?? feeRate) : (maker.feeRate ?? feeRate);
    const feeRateScaled = parseDecimal(buyerFeeRate, "feeRate");
    const grossQuote = (quantity * price) / SCALE_FACTOR;
    const feeAmount = (grossQuote * feeRateScaled) / SCALE_FACTOR;

    trades.push({
      id: tradeIdFactory(trades.length, maker, quantityText),
      buyOrderId: taker.side === "buy" ? taker.id : maker.id,
      sellOrderId: taker.side === "sell" ? taker.id : maker.id,
      price: formatDecimal(price),
      quantity: quantityText,
      feeRate: formatDecimal(feeRateScaled),
      feeAmount: formatDecimal(feeAmount)
    });

    const makerLeft = makerRemaining - quantity;
    makerOrders.push({
      ...maker,
      remainingQuantity: formatDecimal(makerLeft),
      status: makerLeft === 0n ? "filled" : "partially_filled"
    });
    takerRemaining -= quantity;
  }

  return { trades, takerRemaining: formatDecimal(takerRemaining), makerOrders };
}

export function calculateFee(price: string, quantity: string, feeRate = "0.0055"): string {
  const grossQuote = (parseDecimal(price, "price") * parseDecimal(quantity, "quantity")) / SCALE_FACTOR;
  const fee = (grossQuote * parseDecimal(feeRate, "feeRate")) / SCALE_FACTOR;
  return formatDecimal(fee);
}
