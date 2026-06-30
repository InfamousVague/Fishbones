/// Unified Ledger transport entry point. Picks the right backend
/// based on whether we're running in the web build (use WebHID) or
/// inside Tauri (use the Rust hidapi bridge).
///
/// Usage from React components:
///
/// ```ts
/// import { ledger } from "../lib/ledger";
///
/// const info = await ledger.connect();
/// const response = await ledger.send(0xe0, 0x06, 0x00, 0x00);
/// ```
///
/// `ledger` is a singleton — there's only one device at a time and
/// the UX assumes "the device" rather than "a device". For learning
/// scenarios where students need to inspect the raw transport class,
/// they can construct one directly via `DesktopLedgerTransport` or
/// `WebLedgerTransport`.

import { isWeb } from "@/lib/platform";
import { DesktopLedgerTransport } from "./desktop";
import { WebLedgerTransport, isWebHidSupported } from "./web";
import type { LedgerTransport, LedgerStatusListener } from "./types";

export * from "./types";
export { DesktopLedgerTransport } from "./desktop";
export { WebLedgerTransport, isWebHidSupported } from "./web";

let singleton: LedgerTransport | null = null;
const listeners = new Set<LedgerStatusListener>();

function build(): LedgerTransport {
  if (isWeb) {
    if (!isWebHidSupported()) {
      // Return a stub that throws on every API call. Lets the
      // status-bar UI render a "your browser doesn't support
      // hardware wallets" message without crashing the app.
      return new UnsupportedTransport();
    }
    const t = new WebLedgerTransport();
    t.onStatusChange((s) => fanOut(s));
    return t;
  }
  const t = new DesktopLedgerTransport();
  t.onStatusChange((s) => fanOut(s));
  return t;
}

function fanOut(
  status:
    | { state: "disconnected" }
    | { state: "connected"; device: import("./types").LedgerDeviceInfo },
): void {
  for (const fn of listeners) {
    try {
      fn(status);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ledger] listener threw:", err);
    }
  }
}

/// The shared transport. Lazily constructed on first access so
/// platform detection (`isWeb`) has a chance to settle.
export const ledger: LedgerTransport & {
  onStatusChange: (l: LedgerStatusListener) => () => void;
  /// Try to open a Ledger silently — works on desktop whenever a
  /// device is plugged in, on web only if the user previously
  /// granted permission to that device. Resolves to the device
  /// info on success or null when no device is available. Used by
  /// `useLedger` at app mount.
  tryAutoConnect: () => Promise<import("./types").LedgerDeviceInfo | null>;
  /// Start watching for plug-in events and auto-open when a device
  /// appears. Returns an unsubscribe handler. Combine with
  /// `tryAutoConnect` for the full UX: connect what's already
  /// plugged in, then auto-connect anything plugged in later.
  startAutoReconnect: (
    onConnect: (info: import("./types").LedgerDeviceInfo) => void,
  ) => Promise<() => void> | (() => void);
} = new Proxy({} as LedgerTransport, {
  get(_target, prop) {
    if (!singleton) singleton = build();
    if (prop === "onStatusChange") {
      // Surface the singleton's listener subscription via the proxy
      // so consumers don't need to know about the underlying class.
      return (l: LedgerStatusListener) => {
        listeners.add(l);
        return () => listeners.delete(l);
      };
    }
    const value = (singleton as unknown as Record<string, unknown>)[
      prop as string
    ];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(singleton);
    }
    return value;
  },
}) as LedgerTransport & {
  onStatusChange: (l: LedgerStatusListener) => () => void;
  tryAutoConnect: () => Promise<import("./types").LedgerDeviceInfo | null>;
  startAutoReconnect: (
    onConnect: (info: import("./types").LedgerDeviceInfo) => void,
  ) => Promise<() => void> | (() => void);
};

/// Stub transport returned when the platform doesn't support any
/// Ledger access path (e.g. Safari web build). Every call throws an
/// instructive error explaining the limitation.
class UnsupportedTransport implements LedgerTransport {
  private readonly message =
    "Hardware wallets aren't supported in this browser. Use the Libre desktop app, or open this lesson in Chrome / Edge / Opera.";

  async listDevices() {
    return [];
  }
  async connect(): Promise<never> {
    throw new Error(this.message);
  }
  async disconnect() {
    /* no-op */
  }
  isConnected() {
    return false;
  }
  device() {
    return null;
  }
  async send(): Promise<never> {
    throw new Error(this.message);
  }
}
