const API_BASE = window.TRADE_SHARK_API_BASE ?? "";

function isObject(value) {
  return Boolean(value) && typeof value === "object";
}

function assertResponse(response) {
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
}

async function getJson(path, signal) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    signal
  });
  assertResponse(response);
  return response.json();
}

function isPlatformStatus(value) {
  return isObject(value)
    && value.service === "tradeshark-api"
    && typeof value.status === "string"
    && typeof value.version === "string";
}

function isMarketsPayload(value) {
  return isObject(value) && Array.isArray(value.markets);
}

function isOrderBook(value) {
  return isObject(value)
    && typeof value.marketId === "string"
    && Array.isArray(value.bids)
    && Array.isArray(value.asks);
}

function isTradesPayload(value) {
  return isObject(value) && Array.isArray(value.trades);
}

export async function fetchPlatformStatus(signal) {
  const body = await getJson("/api/v1/status", signal);
  if (!isPlatformStatus(body)) throw new Error("API returned an invalid platform status payload");
  return body;
}

export async function fetchMarkets(signal) {
  const body = await getJson("/api/v1/markets?limit=100", signal);
  if (!isMarketsPayload(body)) throw new Error("API returned an invalid markets payload");
  return body.markets;
}

export async function fetchOrderBook(marketId, depth = 8, signal) {
  const body = await getJson(`/api/v1/markets/${encodeURIComponent(marketId)}/order-book?depth=${depth}`, signal);
  if (!isOrderBook(body)) throw new Error("API returned an invalid order book payload");
  return body;
}

export async function fetchMarketTrades(marketId, limit = 8, signal) {
  const body = await getJson(`/api/v1/markets/${encodeURIComponent(marketId)}/trades?limit=${limit}`, signal);
  if (!isTradesPayload(body)) throw new Error("API returned an invalid trades payload");
  return body.trades;
}
