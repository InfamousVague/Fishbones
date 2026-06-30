/// Offline mock layer for the HelloTrade API tester.
///
/// The dock defaults to mock mode so a learner can work through
/// the entire course without a network round-trip — every preset
/// returns a structurally accurate canned response that mirrors
/// what the staging API would actually send. The shapes here are
/// pulled directly from the developer docs (response examples,
/// schema tables); when the staging API drifts the canned data
/// stays close enough to teach against.
///
/// Live mode (toggled via the dock header) bypasses this module
/// entirely and lets the request hit the wire.
///
/// Two interceptors:
///
///   - `mockRest(url, method, body)` returns `{ status, headers,
///     body }` for any URL the dock recognises, or `null` for
///     "no canned response available — fall through to a friendly
///     message in the response panel."
///
///   - `mockWs(wsUrl, sentMessages)` returns an array of fake
///     server frames the WS panel renders inline as if they
///     arrived over the wire. Recognises the subscribe payloads
///     from `presets.ts` and emits a couple of plausible event
///     frames (a snapshot then a diff).

interface MockRestResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /// Simulated round-trip latency in ms. Adds a touch of realism;
  /// the dock awaits this before painting the response.
  latencyMs: number;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

const ok = (body: unknown, latencyMs = 80): MockRestResponse => ({
  status: 200,
  statusText: "OK",
  headers: JSON_HEADERS,
  body: JSON.stringify(body, null, 2),
  latencyMs,
});

const created = (body: unknown, latencyMs = 120): MockRestResponse => ({
  status: 201,
  statusText: "Created",
  headers: JSON_HEADERS,
  body: JSON.stringify(body, null, 2),
  latencyMs,
});

const unauthorized = (latencyMs = 60): MockRestResponse => ({
  status: 401,
  statusText: "Unauthorized",
  headers: JSON_HEADERS,
  body: JSON.stringify(
    {
      error: "INVALID_SIGNATURE",
      message:
        "Mock mode rejects unsigned writes. Toggle Live mode + provide a real EIP-712 signature, or just inspect the request body — the contract is real even when the response is canned.",
    },
    null,
    2,
  ),
  latencyMs,
});

/// Try to match the URL's pathname (ignoring query string + base
/// host) to a known endpoint. Returns the canned response or null.
export function mockRest(
  rawUrl: string,
  method: string,
  body: string | null,
): MockRestResponse | null {
  let url: URL;
  try {
    // Allow templated `{{baseUrl}}` to slip through by replacing
    // before parsing; the dock should already have substituted,
    // but defence-in-depth against hand-edited URLs.
    url = new URL(
      rawUrl.replace(/\{\{[^}]+\}\}/g, "https://mock.local"),
    );
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  const m = method.toUpperCase();

  // Public market data
  if (m === "GET" && path === "/api/instruments") {
    return ok(MOCK_INSTRUMENTS);
  }
  if (m === "GET" && path === "/api/markets") {
    return ok(MOCK_MARKETS);
  }
  if (m === "GET" && path === "/api/tickers") {
    return ok(MOCK_TICKERS);
  }
  if (m === "GET" && path === "/api/candles") {
    const market = url.searchParams.get("market") ?? "BTC-PERP";
    const interval = url.searchParams.get("interval") ?? "1m";
    const limit = Math.min(
      Number(url.searchParams.get("limit") ?? "100") || 100,
      500,
    );
    return ok(generateCandles(market, interval, limit));
  }
  if (m === "GET" && path === "/api/funding-rates") {
    const market = url.searchParams.get("market") ?? "BTC-PERP";
    const limit = Math.min(
      Number(url.searchParams.get("limit") ?? "24") || 24,
      168,
    );
    return ok(generateFundingRates(market, limit));
  }
  if (m === "GET" && path === "/api/mark-prices") {
    return ok(MOCK_MARK_PRICES);
  }

  // Authenticated endpoints — mock mode shows the contract by
  // returning 401 unless the request looks remotely real (has a
  // payload + sig field). This teaches the auth shape without
  // leaking a way to "succeed" without actually signing.
  if (path === "/api/account" && m === "GET") {
    const sig = headerLike(body, "signature") || hasAuthHeaders();
    if (!sig) return unauthorized();
    return ok(MOCK_ACCOUNT);
  }
  if (path === "/api/deposit" && m === "POST") {
    if (!body || !/signature/.test(body)) return unauthorized();
    return created({
      depositId: "dep_" + Math.random().toString(36).slice(2, 10),
      status: "pending",
      receivedAt: new Date().toISOString(),
    });
  }
  if (path === "/api/withdraw" && m === "POST") {
    if (!body || !/signature/.test(body)) return unauthorized();
    return created({
      withdrawalId: "wd_" + Math.random().toString(36).slice(2, 10),
      status: "queued",
      estimatedSettlementMs: 2_400,
    });
  }

  return null;
}

/// Cheap heuristic for "did the body include something that looks
/// like a sig field?" Used by the auth-required mocks to avoid
/// returning 200 on an obviously-empty request without forcing
/// learners to actually sign anything in mock mode.
function headerLike(body: string | null, field: string): boolean {
  if (!body) return false;
  return new RegExp(`["']${field}["']\\s*:`, "i").test(body);
}

function hasAuthHeaders(): boolean {
  // Headers are forwarded by the caller; we don't see them here,
  // so we treat header-only auth as unauthorized in mock mode.
  // The course's auth lessons walk you through hitting Live mode
  // for the actual round-trip.
  return false;
}

// ── Canned datasets ─────────────────────────────────────────

const MOCK_INSTRUMENTS = [
  {
    symbol: "BTC-PERP",
    type: "PERP",
    base: "BTC",
    quote: "USDC",
    tickSize: "0.5",
    lotSize: "0.0001",
    maxLeverage: 50,
    isActive: true,
  },
  {
    symbol: "ETH-PERP",
    type: "PERP",
    base: "ETH",
    quote: "USDC",
    tickSize: "0.05",
    lotSize: "0.001",
    maxLeverage: 50,
    isActive: true,
  },
  {
    symbol: "SOL-PERP",
    type: "PERP",
    base: "SOL",
    quote: "USDC",
    tickSize: "0.001",
    lotSize: "0.01",
    maxLeverage: 25,
    isActive: true,
  },
  {
    symbol: "BTC-USDC",
    type: "SPOT",
    base: "BTC",
    quote: "USDC",
    tickSize: "0.5",
    lotSize: "0.00001",
    maxLeverage: 1,
    isActive: true,
  },
];

const MOCK_MARKETS = [
  { id: 8, symbol: "BTC-PERP", baseDecimals: 8, quoteDecimals: 6 },
  { id: 9, symbol: "ETH-PERP", baseDecimals: 18, quoteDecimals: 6 },
  { id: 10, symbol: "SOL-PERP", baseDecimals: 9, quoteDecimals: 6 },
  { id: 23, symbol: "BTC-USDC", baseDecimals: 8, quoteDecimals: 6 },
];

const MOCK_TICKERS = [
  {
    symbol: "BTC-PERP",
    last: "67342.50",
    change24h: "+1.84%",
    volume24h: "8421.5",
    high24h: "68210.00",
    low24h: "66120.50",
    openInterest: "12340.2",
  },
  {
    symbol: "ETH-PERP",
    last: "3284.20",
    change24h: "-0.42%",
    volume24h: "55320.1",
    high24h: "3320.85",
    low24h: "3258.00",
    openInterest: "98421.7",
  },
  {
    symbol: "SOL-PERP",
    last: "152.842",
    change24h: "+3.21%",
    volume24h: "281430.5",
    high24h: "155.120",
    low24h: "147.350",
    openInterest: "412980.3",
  },
];

const MOCK_MARK_PRICES = [
  {
    market: "BTC-PERP",
    indexPrice: "67340.12",
    markPrice: "67342.85",
    fundingRate: "0.00012",
    nextFundingMs: 1730000000000,
  },
  {
    market: "ETH-PERP",
    indexPrice: "3283.95",
    markPrice: "3284.10",
    fundingRate: "-0.00004",
    nextFundingMs: 1730000000000,
  },
];

const MOCK_ACCOUNT = {
  account: "0xa1B2c3D4E5F60718293A4b5C6D7E8f9012345678",
  collateral: { asset: "USDC", balance: "12450.000000", available: "8200.500000" },
  positions: [
    {
      market: "BTC-PERP",
      size: "0.0500",
      entryPrice: "66400.00",
      markPrice: "67342.85",
      unrealizedPnl: "+47.14",
      leverage: 10,
    },
  ],
  openOrders: [
    {
      orderId: "ord_8FQp2",
      market: "BTC-PERP",
      side: "BUY",
      type: "LIMIT",
      size: "0.0100",
      price: "66000.00",
      filled: "0.0000",
      status: "OPEN",
    },
  ],
};

function generateCandles(market: string, interval: string, limit: number) {
  // Anchored seed so the same query returns the same data — keeps
  // the lesson examples stable across reloads. Mulberry32 over a
  // hash of (market + interval).
  const seed = hashString(market + ":" + interval);
  const rand = mulberry32(seed);
  const intervalSec = parseIntervalSeconds(interval);
  const now = Math.floor(Date.now() / 1000);
  const aligned = now - (now % intervalSec);
  const base = market.startsWith("BTC")
    ? 67000
    : market.startsWith("ETH")
      ? 3280
      : market.startsWith("SOL")
        ? 152
        : 100;
  const out: Array<Record<string, string | number>> = [];
  let price = base;
  for (let i = limit - 1; i >= 0; i--) {
    const time = aligned - i * intervalSec;
    const drift = (rand() - 0.5) * 0.004 * base;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + rand() * 0.002 * base;
    const low = Math.min(open, close) - rand() * 0.002 * base;
    const volume = (rand() * 50 + 5).toFixed(2);
    out.push({
      time,
      open: open.toFixed(2),
      high: high.toFixed(2),
      low: low.toFixed(2),
      close: close.toFixed(2),
      volume,
    });
    price = close;
  }
  return out;
}

function generateFundingRates(market: string, limit: number) {
  const seed = hashString("funding:" + market);
  const rand = mulberry32(seed);
  const now = Math.floor(Date.now() / 1000);
  const out: Array<Record<string, string | number>> = [];
  for (let i = limit - 1; i >= 0; i--) {
    const time = now - i * 3600; // hourly funding marks
    const rate = ((rand() - 0.5) * 0.0008).toFixed(7);
    out.push({ market, time, fundingRate: rate });
  }
  return out;
}

function parseIntervalSeconds(interval: string): number {
  const m = /^(\d+)([smhd])$/.exec(interval);
  if (!m) return 60;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "s") return n;
  if (unit === "m") return n * 60;
  if (unit === "h") return n * 3600;
  return n * 86400;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── WebSocket mock ──────────────────────────────────────────

export interface MockWsFrame {
  /// Direction for the message-stream renderer. "in" frames are
  /// painted as if they arrived from the server; "out" frames are
  /// echoes of what the dock sent (rendered separately so the user
  /// sees their subscribe before the server's snapshot lands).
  direction: "in";
  /// JSON-stringified payload. The dock pretty-prints these in the
  /// stream view.
  payload: string;
  /// Synthetic delay before this frame is "delivered" — staggers
  /// the snapshot vs first diff in a believable way.
  delayMs: number;
}

/// Given the URL the WS panel is connecting to + the messages it
/// just sent, produce a sequence of frames the panel should pretend
/// to receive. Returns [] when nothing is recognised.
export function mockWs(_wsUrl: string, sentMessages: string[]): MockWsFrame[] {
  const out: MockWsFrame[] = [];
  // Welcome envelope, like real GitBook-style services.
  out.push({
    direction: "in",
    payload: JSON.stringify(
      { type: "welcome", server: "mock", protocol: 1 },
      null,
      2,
    ),
    delayMs: 50,
  });

  for (const raw of sentMessages) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = msg.type as string | undefined;
    const channel = msg.channel as string | undefined;

    if (type === "subscribe" && channel === "lightTickers") {
      out.push({
        direction: "in",
        payload: JSON.stringify(
          { type: "subscribed", channel: "lightTickers" },
          null,
          2,
        ),
        delayMs: 80,
      });
      out.push({
        direction: "in",
        payload: JSON.stringify(
          {
            type: "tickers",
            data: MOCK_TICKERS.map((t) => ({
              s: t.symbol,
              p: t.last,
              v: t.volume24h,
            })),
          },
          null,
          2,
        ),
        delayMs: 200,
      });
    } else if (type === "subscribe" && channel === "partialOrderBook") {
      const market = (msg.market as string) ?? "BTC-PERP";
      out.push({
        direction: "in",
        payload: JSON.stringify(
          {
            type: "orderbook.snapshot",
            market,
            bids: [
              ["67340.0", "0.521"],
              ["67339.5", "0.834"],
              ["67339.0", "1.230"],
              ["67338.5", "0.412"],
              ["67338.0", "2.108"],
            ],
            asks: [
              ["67340.5", "0.345"],
              ["67341.0", "0.901"],
              ["67341.5", "1.554"],
              ["67342.0", "0.270"],
              ["67342.5", "1.812"],
            ],
            ts: Date.now(),
          },
          null,
          2,
        ),
        delayMs: 150,
      });
      out.push({
        direction: "in",
        payload: JSON.stringify(
          {
            type: "orderbook.diff",
            market,
            bids: [["67340.0", "0.621"]],
            asks: [["67342.5", "0"]],
            ts: Date.now() + 800,
          },
          null,
          2,
        ),
        delayMs: 900,
      });
    } else if (type === "subscribe" && channel === "trades") {
      const market = (msg.market as string) ?? "BTC-PERP";
      out.push({
        direction: "in",
        payload: JSON.stringify(
          { type: "subscribed", channel: "trades", market },
          null,
          2,
        ),
        delayMs: 80,
      });
      const trades = [
        { side: "BUY", size: "0.0125", price: "67340.5", ts: Date.now() },
        { side: "SELL", size: "0.0040", price: "67340.0", ts: Date.now() + 120 },
        { side: "BUY", size: "0.0500", price: "67341.0", ts: Date.now() + 280 },
      ];
      trades.forEach((t, i) => {
        out.push({
          direction: "in",
          payload: JSON.stringify({ type: "trade", market, ...t }, null, 2),
          delayMs: 200 + i * 220,
        });
      });
    } else if (type === "subscribe" && channel === "candles") {
      const market = (msg.market as string) ?? "BTC-PERP";
      const interval = (msg.interval as string) ?? "1m";
      out.push({
        direction: "in",
        payload: JSON.stringify(
          {
            type: "candle",
            market,
            interval,
            ...generateCandles(market, interval, 1)[0],
          },
          null,
          2,
        ),
        delayMs: 150,
      });
    } else if (type === "authenticate") {
      out.push({
        direction: "in",
        payload: JSON.stringify(
          {
            type: "authenticate.error",
            code: "INVALID_SIGNATURE",
            message:
              "Mock mode can't verify a real wallet signature — toggle Live mode against staging to complete this round-trip. The contract you sent (auth + signature.payload + signature.sig) is correct.",
          },
          null,
          2,
        ),
        delayMs: 200,
      });
    } else if (type === "subscribeTrading") {
      out.push({
        direction: "in",
        payload: JSON.stringify(
          { type: "subscribed", channel: "trading" },
          null,
          2,
        ),
        delayMs: 100,
      });
    } else if (type === "placeOrder" || type === "cancelOrder") {
      out.push({
        direction: "in",
        payload: JSON.stringify(
          {
            type: type + ".error",
            code: "INVALID_SIGNATURE",
            message:
              "Mock mode rejects unsigned trade ops — the wire shape is correct (type + signature.payload + signature.sig), but you'd need an actual EIP-712 sig over the Order/OrderCancel struct to land this on staging.",
          },
          null,
          2,
        ),
        delayMs: 200,
      });
    } else {
      // Unknown frame — echo a generic ack.
      out.push({
        direction: "in",
        payload: JSON.stringify(
          { type: "ack", echo: type ?? "unknown" },
          null,
          2,
        ),
        delayMs: 120,
      });
    }
  }

  return out;
}
