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
  /// i18n key for the human-readable label rendered in the sidebar
  /// (`tradeDock.presets.<id>.label`). Plain data module — the dock
  /// resolves keys through `t()` at render time.
  label: string;
  /// i18n key for the one-line summary shown under the label / on
  /// hover (`tradeDock.presets.<id>.description`).
  description: string;
  /// i18n key for the category heading — drives the section
  /// grouping in the sidebar (`tradeDock.category.<id>`).
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
    label: "tradeDock.presets.rest.public.instruments.label",
    description: "tradeDock.presets.rest.public.instruments.description",
    category: "tradeDock.category.market",
    method: "GET",
    url: "{{baseUrl}}/api/instruments",
  },
  {
    kind: "rest",
    id: "rest.public.markets",
    label: "tradeDock.presets.rest.public.markets.label",
    description: "tradeDock.presets.rest.public.markets.description",
    category: "tradeDock.category.market",
    method: "GET",
    url: "{{baseUrl}}/api/markets",
  },
  {
    kind: "rest",
    id: "rest.public.candles",
    label: "tradeDock.presets.rest.public.candles.label",
    description: "tradeDock.presets.rest.public.candles.description",
    category: "tradeDock.category.market",
    method: "GET",
    url: "{{baseUrl}}/api/candles?market=BTC-PERP&interval=1m&limit=100",
  },
  {
    kind: "rest",
    id: "rest.public.tickers",
    label: "tradeDock.presets.rest.public.tickers.label",
    description: "tradeDock.presets.rest.public.tickers.description",
    category: "tradeDock.category.market",
    method: "GET",
    url: "{{baseUrl}}/api/tickers",
  },
  // ── Account / authenticated REST ───────────────────────────
  {
    kind: "rest",
    id: "rest.auth.account",
    label: "tradeDock.presets.rest.auth.account.label",
    description: "tradeDock.presets.rest.auth.account.description",
    category: "tradeDock.category.account",
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
    label: "tradeDock.presets.rest.auth.deposit.label",
    description: "tradeDock.presets.rest.auth.deposit.description",
    category: "tradeDock.category.account",
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
    label: "tradeDock.presets.rest.auth.withdraw.label",
    description: "tradeDock.presets.rest.auth.withdraw.description",
    category: "tradeDock.category.account",
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
    label: "tradeDock.presets.rest.auth.orders.label",
    description: "tradeDock.presets.rest.auth.orders.description",
    category: "tradeDock.category.account",
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
    label: "tradeDock.presets.rest.auth.ordersOpen.label",
    description: "tradeDock.presets.rest.auth.ordersOpen.description",
    category: "tradeDock.category.account",
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
    label: "tradeDock.presets.rest.auth.fills.label",
    description: "tradeDock.presets.rest.auth.fills.description",
    category: "tradeDock.category.account",
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
    label: "tradeDock.presets.rest.public.fundingRates.label",
    description: "tradeDock.presets.rest.public.fundingRates.description",
    category: "tradeDock.category.reference",
    method: "GET",
    url: "{{baseUrl}}/api/funding-rates?market=BTC-PERP&limit=24",
  },
  {
    kind: "rest",
    id: "rest.public.markPrices",
    label: "tradeDock.presets.rest.public.markPrices.label",
    description: "tradeDock.presets.rest.public.markPrices.description",
    category: "tradeDock.category.reference",
    method: "GET",
    url: "{{baseUrl}}/api/mark-prices",
  },
  // ── WebSocket: market data ─────────────────────────────────
  {
    kind: "ws",
    id: "ws.market.tickers",
    label: "tradeDock.presets.ws.market.tickers.label",
    description: "tradeDock.presets.ws.market.tickers.description",
    category: "tradeDock.category.wsMarket",
    wsUrl: "{{marketDataWsUrl}}?token={{marketDataToken}}",
    wsMessages: [
      JSON.stringify({ type: "subscribe", channel: "lightTickers" }, null, 2),
    ],
  },
  {
    kind: "ws",
    id: "ws.market.orderbook",
    label: "tradeDock.presets.ws.market.orderbook.label",
    description: "tradeDock.presets.ws.market.orderbook.description",
    category: "tradeDock.category.wsMarket",
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
    label: "tradeDock.presets.ws.market.trades.label",
    description: "tradeDock.presets.ws.market.trades.description",
    category: "tradeDock.category.wsMarket",
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
    label: "tradeDock.presets.ws.market.candles.label",
    description: "tradeDock.presets.ws.market.candles.description",
    category: "tradeDock.category.wsMarket",
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
    label: "tradeDock.presets.ws.trade.authenticate.label",
    description: "tradeDock.presets.ws.trade.authenticate.description",
    category: "tradeDock.category.wsTrading",
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
    label: "tradeDock.presets.ws.trade.subscribeTrading.label",
    description: "tradeDock.presets.ws.trade.subscribeTrading.description",
    category: "tradeDock.category.wsTrading",
    wsUrl: "{{wsUrl}}",
    wsMessages: [JSON.stringify({ type: "subscribeTrading" }, null, 2)],
  },
  {
    kind: "ws",
    id: "ws.trade.placeOrder",
    label: "tradeDock.presets.ws.trade.placeOrder.label",
    description: "tradeDock.presets.ws.trade.placeOrder.description",
    category: "tradeDock.category.wsTrading",
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
    label: "tradeDock.presets.ws.trade.cancelOrder.label",
    description: "tradeDock.presets.ws.trade.cancelOrder.description",
    category: "tradeDock.category.wsTrading",
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
