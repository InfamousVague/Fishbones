/// Pre-populated request library for the HelloTrade API tester.
///
/// Pulled directly from the HelloTrade developer docs at
/// https://hellotrade.gitbook.io/hellotrade-docs/. Each preset is a
/// drop-in starting point the learner can tap once and tweak — same
/// pattern as Postman's "collection" sidebar, just bundled rather
/// than user-imported.
///
/// Two flavours of preset:
///
///   - **REST** entries carry `method` + `url` + `headers` + `body`.
///     The dock's request panel deserialises them into the form
///     fields verbatim.
///
///   - **WebSocket** entries carry a `wsUrl` and an optional
///     `wsMessages` array. The dock's WS panel opens the URL and
///     auto-sends each message as a JSON frame after the connection
///     opens (the same flow you'd run by hand to subscribe to
///     market-data channels).
///
/// All URLs target the staging environment by default — HelloTrade
/// publishes a public testnet at `*.staging.hello.trade` that any
/// reader can hit without an account. Live mode (toggled in the
/// dock header) follows whichever URL is in the form; Mock mode
/// recognises the staging URLs and returns canned responses so the
/// course works fully offline.

export type PresetMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RestPreset {
  kind: "rest";
  /// Stable id used as the React key + saved-history join key.
  id: string;
  /// Human-readable label rendered in the sidebar.
  label: string;
  /// One-line summary shown under the label / on hover.
  description: string;
  /// Loose category tag — drives the section grouping in the
  /// sidebar. Lower-cased, kept short ("market", "account",
  /// "auth", "trade", "data").
  category: string;
  method: PresetMethod;
  url: string;
  headers?: Record<string, string>;
  /// Pretty-printed JSON, kept as a string so the editor's
  /// monospace seed value is byte-identical to what the user sees.
  body?: string;
}

export interface WsPreset {
  kind: "ws";
  id: string;
  label: string;
  description: string;
  category: string;
  wsUrl: string;
  /// Frames to send AUTOMATICALLY after the connection opens.
  /// Useful for "subscribe to candles for BTC-PERP" — the
  /// learner doesn't have to hand-craft the subscribe payload
  /// before they see any data flow.
  wsMessages?: string[];
}

export type Preset = RestPreset | WsPreset;

/// Staging environment defaults. Surfaced as `{{baseUrl}}` and
/// friends so the learner can swap to mainnet by editing one
/// variable in the env panel rather than 30 URLs.
export const ENV_DEFAULTS: Record<string, string> = {
  baseUrl: "https://api.staging.hello.trade",
  wsUrl: "wss://api.staging.hello.trade/ws",
  marketDataWsUrl: "wss://api.staging.hello.trade/marketdata",
  marketDataToken: "eyJleGNoYW5nZUlkIjoyMjgsInByb2plY3RJZCI6M30=",
};

/// The full preset library. Categories cluster in the sidebar
/// in this order; lessons that link to a specific preset reference
/// it by id.
export const PRESETS: Preset[] = [
  // ── Public market data (REST) ──────────────────────────────
  {
    kind: "rest",
    id: "rest.public.instruments",
    label: "List instruments",
    description: "All tradable perpetuals + spot pairs.",
    category: "Market data",
    method: "GET",
    url: "{{baseUrl}}/api/instruments",
  },
  {
    kind: "rest",
    id: "rest.public.markets",
    label: "List markets",
    description: "Numeric market ids + their tick / lot size.",
    category: "Market data",
    method: "GET",
    url: "{{baseUrl}}/api/markets",
  },
  {
    kind: "rest",
    id: "rest.public.candles",
    label: "Historical candles",
    description: "OHLCV bars for a given market + interval.",
    category: "Market data",
    method: "GET",
    url: "{{baseUrl}}/api/candles?market=BTC-PERP&interval=1m&limit=100",
  },
  {
    kind: "rest",
    id: "rest.public.tickers",
    label: "24h tickers",
    description: "Last price, 24h volume, change for every market.",
    category: "Market data",
    method: "GET",
    url: "{{baseUrl}}/api/tickers",
  },
  // ── Account / authenticated REST ───────────────────────────
  {
    kind: "rest",
    id: "rest.auth.account",
    label: "Account snapshot",
    description: "Balance, positions, open orders. Requires sig.",
    category: "Account",
    method: "GET",
    url: "{{baseUrl}}/api/account",
    headers: {
      "X-Signature": "<eip191-sig>",
      "X-Payload": "<hex-payload>",
    },
  },
  {
    kind: "rest",
    id: "rest.auth.deposit",
    label: "Deposit USDC",
    description: "ERC-2612 permit deposit. Body carries the EIP-712 sig.",
    category: "Account",
    method: "POST",
    url: "{{baseUrl}}/api/deposit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      {
        account: "0xYOUR_WALLET",
        amount: "1000000000",
        nonce: 1,
        deadline: Math.floor(Date.now() / 1000) + 86400,
        signature: { sig: "<eip712-sig>", payload: "<hex-permit-payload>" },
      },
      null,
      2,
    ),
  },
  {
    kind: "rest",
    id: "rest.auth.withdraw",
    label: "Withdraw USDC",
    description: "Authenticated withdrawal. Body carries an EIP-712 sig.",
    category: "Account",
    method: "POST",
    url: "{{baseUrl}}/api/withdraw",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      {
        account: "0xYOUR_WALLET",
        amount: "500000000",
        nonce: 2,
        deadline: Math.floor(Date.now() / 1000) + 86400,
        signature: { sig: "<eip712-sig>", payload: "<hex-withdraw-payload>" },
      },
      null,
      2,
    ),
  },
  // ── Account history (REST) ─────────────────────────────────
  // These exercise the Transaction History surface the user is
  // debugging. Adding them as TradeDock presets means the API
  // tester can fire them in Live mode + show the actual response
  // time / shape, which is the fastest path to reproing the
  // "loads forever, sometimes returns empty" issue without
  // standing up the full HelloTrade web app.
  //
  // Endpoint shapes mirror the conventions the rest of the
  // presets use (signature pair in headers, account scoped via
  // the address baked into the signed payload). Adjust the query
  // params on the row that's slow to characterize the bug:
  //   - drop `limit` → server defaults can be huge
  //   - swap `status=open` for `status=filled` to compare codepaths
  //   - add `before=<ts>` to test cursor pagination
  {
    kind: "rest",
    id: "rest.auth.orders",
    label: "Order history",
    description:
      "Every order the account has placed. Slow for old accounts " +
      "when the orders table lacks a (account_id, created_at DESC) index.",
    category: "Account",
    method: "GET",
    // 100-row page is the typical default. If the server times out
    // on this, drop to limit=10 to confirm it's a query-cost issue
    // rather than a transport problem.
    url: "{{baseUrl}}/api/orders?limit=100",
    headers: {
      "X-Signature": "<eip191-sig>",
      "X-Payload": "<hex-payload>",
    },
  },
  {
    kind: "rest",
    id: "rest.auth.ordersOpen",
    label: "Open orders",
    description:
      "Only orders currently resting on the book. Should be a tiny " +
      "set per account (typically <10). If this returns empty for an " +
      "account with known-open orders, the status filter is buggy.",
    category: "Account",
    method: "GET",
    url: "{{baseUrl}}/api/orders?status=open&limit=100",
    headers: {
      "X-Signature": "<eip191-sig>",
      "X-Payload": "<hex-payload>",
    },
  },
  {
    kind: "rest",
    id: "rest.auth.fills",
    label: "Trade fills",
    description:
      "Per-fill execution log (one row per match, not per order). " +
      "Cardinality is higher than /orders for any account that " +
      "places large orders that fill in pieces.",
    category: "Account",
    method: "GET",
    url: "{{baseUrl}}/api/fills?limit=100",
    headers: {
      "X-Signature": "<eip191-sig>",
      "X-Payload": "<hex-payload>",
    },
  },
  // ── Reference data ─────────────────────────────────────────
  {
    kind: "rest",
    id: "rest.public.fundingRates",
    label: "Funding rates",
    description: "Current and historical funding for every perp.",
    category: "Reference",
    method: "GET",
    url: "{{baseUrl}}/api/funding-rates?market=BTC-PERP&limit=24",
  },
  {
    kind: "rest",
    id: "rest.public.markPrices",
    label: "Mark prices",
    description: "Index + mark price snapshot.",
    category: "Reference",
    method: "GET",
    url: "{{baseUrl}}/api/mark-prices",
  },
  // ── WebSocket: market data ─────────────────────────────────
  {
    kind: "ws",
    id: "ws.market.tickers",
    label: "Live tickers",
    description: "Subscribe to compressed price + 24h stats.",
    category: "WebSocket · market data",
    wsUrl: "{{marketDataWsUrl}}?token={{marketDataToken}}",
    wsMessages: [
      JSON.stringify({ type: "subscribe", channel: "lightTickers" }, null, 2),
    ],
  },
  {
    kind: "ws",
    id: "ws.market.orderbook",
    label: "Order book (BTC-PERP)",
    description: "Top-of-book snapshots + diff updates.",
    category: "WebSocket · market data",
    wsUrl: "{{marketDataWsUrl}}?token={{marketDataToken}}",
    wsMessages: [
      JSON.stringify(
        {
          type: "subscribe",
          channel: "partialOrderBook",
          market: "BTC-PERP",
          depth: 10,
        },
        null,
        2,
      ),
    ],
  },
  {
    kind: "ws",
    id: "ws.market.trades",
    label: "Live trades (BTC-PERP)",
    description: "Stream of every print on a market.",
    category: "WebSocket · market data",
    wsUrl: "{{marketDataWsUrl}}?token={{marketDataToken}}",
    wsMessages: [
      JSON.stringify(
        { type: "subscribe", channel: "trades", market: "BTC-PERP" },
        null,
        2,
      ),
    ],
  },
  {
    kind: "ws",
    id: "ws.market.candles",
    label: "Live candles (BTC-PERP)",
    description: "Streaming OHLCV bars.",
    category: "WebSocket · market data",
    wsUrl: "{{marketDataWsUrl}}?token={{marketDataToken}}",
    wsMessages: [
      JSON.stringify(
        {
          type: "subscribe",
          channel: "candles",
          market: "BTC-PERP",
          interval: "1m",
        },
        null,
        2,
      ),
    ],
  },
  // ── WebSocket: trading ─────────────────────────────────────
  {
    kind: "ws",
    id: "ws.trade.authenticate",
    label: "Authenticate session",
    description: "EIP-191 sign-in. Send a SimpleSignature payload.",
    category: "WebSocket · trading",
    wsUrl: "{{wsUrl}}",
    wsMessages: [
      JSON.stringify(
        {
          type: "authenticate",
          signature: { sig: "<eip191-sig>", payload: "<hex-payload>" },
        },
        null,
        2,
      ),
    ],
  },
  {
    kind: "ws",
    id: "ws.trade.subscribeTrading",
    label: "Subscribe to execution reports",
    description: "After auth: receive order/fill/margin events live.",
    category: "WebSocket · trading",
    wsUrl: "{{wsUrl}}",
    wsMessages: [JSON.stringify({ type: "subscribeTrading" }, null, 2)],
  },
  {
    kind: "ws",
    id: "ws.trade.placeOrder",
    label: "Place limit order",
    description: "EIP-712 Order signature. Buy 0.001 BTC at 50,000.",
    category: "WebSocket · trading",
    wsUrl: "{{wsUrl}}",
    wsMessages: [
      JSON.stringify(
        {
          type: "placeOrder",
          signature: { sig: "<eip712-sig>", payload: "<hex-order-payload>" },
        },
        null,
        2,
      ),
    ],
  },
  {
    kind: "ws",
    id: "ws.trade.cancelOrder",
    label: "Cancel order",
    description: "EIP-712 OrderCancel signature.",
    category: "WebSocket · trading",
    wsUrl: "{{wsUrl}}",
    wsMessages: [
      JSON.stringify(
        {
          type: "cancelOrder",
          signature: { sig: "<eip712-sig>", payload: "<hex-cancel-payload>" },
        },
        null,
        2,
      ),
    ],
  },
];
