import { fetchMarketTrades, fetchMarkets, fetchOrderBook, fetchPlatformStatus } from "./api.js";

const root = document.body;

for (const button of document.querySelectorAll('[data-action="future-mode"]')) {
  button.addEventListener("click", () => {
    root.classList.toggle("future");
    const active = root.classList.contains("future");
    for (const item of document.querySelectorAll('[data-action="future-mode"]')) {
      item.textContent = active ? "Normal Mode" : "Future Mode →";
    }
  });
}

const status = document.querySelector("[data-system-status]");
const statusLabel = document.querySelector("[data-system-status-label]");

function setStatus(state, label) {
  if (!status || !statusLabel) return;
  status.dataset.state = state;
  statusLabel.textContent = label;
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return { controller, cleanup: () => window.clearTimeout(timeout) };
}

async function loadPlatformStatus() {
  const { controller, cleanup } = createAbortSignal(3500);
  try {
    const platform = await fetchPlatformStatus(controller.signal);
    setStatus(platform.status === "operational" ? "online" : "degraded", platform.status === "operational" ? "CORE ONLINE" : "CORE DEGRADED");
  } catch {
    setStatus("standby", "CORE STANDBY");
  } finally {
    cleanup();
  }
}

async function loadTerminalMarket() {
  const page = document.querySelector("[data-trading-terminal]");
  if (!page) return;

  const { controller, cleanup } = createAbortSignal(5000);
  try {
    const markets = await fetchMarkets(controller.signal);
    const market = markets.find((item) => item.symbol.toUpperCase() === "BTC/USD")
      ?? markets.find((item) => item.symbol.toUpperCase() === "BTC-USDT")
      ?? markets[0];

    if (!market) throw new Error("No active markets available");

    const [orderBook, trades] = await Promise.all([
      fetchOrderBook(market.id, 8, controller.signal),
      fetchMarketTrades(market.id, 8, controller.signal)
    ]);

    renderTerminalMarket(market, orderBook, trades);
    page.dataset.marketState = "live";
  } catch (error) {
    page.dataset.marketState = "preview";
    console.warn("TradeShark market feed unavailable; keeping preview data.", error);
  } finally {
    cleanup();
  }
}

function numberText(value, maximumFractionDigits = 8) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "—");
  return number.toLocaleString("en-US", { maximumFractionDigits });
}

function priceText(value) {
  return `$${numberText(value, 2)}`;
}

function renderTerminalMarket(market, orderBook, trades) {
  const symbol = String(market.symbol ?? "").replace("-", " / ");
  const base = market.baseAsset?.symbol ?? symbol.split(" / ")[0];
  const quote = market.quoteAsset?.symbol ?? symbol.split(" / ")[1] ?? "USD";
  const bestBid = orderBook.bestBid ?? orderBook.bids[0]?.price ?? null;
  const bestAsk = orderBook.bestAsk ?? orderBook.asks[0]?.price ?? null;
  const lastTrade = trades[0]?.price ?? bestBid ?? bestAsk ?? null;

  setText("[data-market-symbol]", symbol || "—");
  setText("[data-market-subtitle]", `${market.baseAsset?.name ?? base} · TradeShark Market`);
  setText("[data-market-price]", lastTrade === null ? "—" : priceText(lastTrade));
  setText("[data-market-quote]", quote);
  setText("[data-market-base]", base);
  setText("[data-market-spread]", orderBook.spread === null ? "—" : `Spread ${priceText(orderBook.spread)}`);
  setText("[data-chart-price]", lastTrade === null ? "—" : priceText(lastTrade));

  const asks = document.querySelector("[data-order-asks]");
  const bids = document.querySelector("[data-order-bids]");
  if (asks) asks.replaceChildren(...orderBook.asks.map((row) => createBookRow(row, "ask", quote)));
  if (bids) bids.replaceChildren(...orderBook.bids.map((row) => createBookRow(row, "bid", quote)));

  const recent = document.querySelector("[data-recent-trades]");
  if (recent) recent.replaceChildren(...trades.map(createTradeRow));

  const marketState = document.querySelector("[data-market-state]");
  if (marketState) marketState.textContent = "LIVE MARKET DATA";
}

function appendTextRow(parent, className, values) {
  const element = document.createElement("div");
  element.className = className;
  for (const value of values) {
    const span = document.createElement("span");
    span.textContent = value;
    element.appendChild(span);
  }
  parent.appendChild(element);
  return element;
}

function createBookRow(row, side, quote) {
  const element = document.createElement("div");
  element.className = `book-row ${side}`;
  const total = Number(row.price) * Number(row.quantity);
  const values = [
    numberText(row.price, 8),
    numberText(row.quantity, 8),
    Number.isFinite(total) ? `${numberText(total, 2)} ${quote}` : "—"
  ];
  for (const value of values) {
    const span = document.createElement("span");
    span.textContent = value;
    element.appendChild(span);
  }
  return element;
}

function createTradeRow(trade) {
  const element = document.createElement("div");
  element.className = "trade-row";
  const timestamp = trade.createdAt ?? trade.executedAt ?? trade.timestamp ?? null;
  const time = timestamp ? new Date(timestamp).toLocaleTimeString("en-US", { hour12: false }) : "—";
  for (const value of [numberText(trade.price, 8), numberText(trade.quantity, 8), time]) {
    const span = document.createElement("span");
    span.textContent = value;
    element.appendChild(span);
  }
  return element;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

async function loadMarketList() {
  const list = document.querySelector("[data-market-list]");
  if (!list) return;

  const state = document.querySelector("[data-market-list-state]");
  const { controller, cleanup } = createAbortSignal(5000);

  try {
    const markets = await fetchMarkets(controller.signal);
    if (!markets.length) throw new Error("No active markets available");
    list.replaceChildren(...markets.slice(0, 12).map((market, index) => createMarketRow(market, index)));
    if (state) state.textContent = `${markets.length} active markets · server-backed`;
  } catch (error) {
    if (state) state.textContent = "Market feed unavailable · preview";
    console.warn("TradeShark market discovery unavailable.", error);
  } finally {
    cleanup();
  }
}

function createMarketRow(market, index) {
  const row = document.createElement("article");
  row.className = "market-row";
  const symbol = String(market.symbol ?? "").replace("-", " / ");
  const base = market.baseAsset?.symbol ?? symbol.split(" / ")[0] ?? "TS";
  const quote = market.quoteAsset?.symbol ?? symbol.split(" / ")[1] ?? "";
  const rank = document.createElement("span");
  rank.className = "rank";
  rank.textContent = String(index + 1).padStart(2, "0");
  const icon = document.createElement("div");
  icon.className = "coin-icon";
  icon.textContent = String(base).slice(0, 1);
  const name = document.createElement("div");
  name.className = "coin-name";
  const symbolText = document.createElement("b");
  symbolText.textContent = symbol || "—";
  const nameText = document.createElement("small");
  nameText.textContent = market.baseAsset?.name ?? base;
  name.append(symbolText, nameText);
  const price = document.createElement("b");
  price.textContent = "—";
  const change = document.createElement("span");
  change.textContent = "—";
  const bars = document.createElement("div");
  bars.className = "mini-bars";
  for (let i = 0; i < 5; i += 1) bars.appendChild(document.createElement("i"));
  row.append(rank, icon, name, price, change, bars);
  row.setAttribute("data-market-id", String(market.id ?? ""));
  row.title = `${symbol} · quote ${quote}`;
  return row;
}

let marketRefreshTimer = null;
let marketRefreshInFlight = false;

async function refreshMarketSurfaces() {
  if (marketRefreshInFlight || document.hidden) return;
  marketRefreshInFlight = true;
  try {
    await Promise.all([loadTerminalMarket(), loadMarketList()]);
  } finally {
    marketRefreshInFlight = false;
  }
}

await loadPlatformStatus();
await refreshMarketSurfaces();

if (document.querySelector("[data-trading-terminal], [data-market-list]")) {
  marketRefreshTimer = window.setInterval(refreshMarketSurfaces, 5000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshMarketSurfaces();
  });
  window.addEventListener("beforeunload", () => {
    if (marketRefreshTimer) window.clearInterval(marketRefreshTimer);
  }, { once: true });
}
