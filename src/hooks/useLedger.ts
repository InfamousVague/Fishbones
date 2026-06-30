/// React bindings for the singleton Ledger transport.
///
/// `useLedger()` exposes the current connection state + a stable set
/// of action callbacks (connect / disconnect / send) that any
/// component in the app can call. Status updates are pushed via the
/// transport's `onStatusChange` so all subscribers re-render together
/// when a device plugs in or out.
///
/// Usage in a status-bar pill:
///
/// ```tsx
/// const { state, device, connect, disconnect } = useLedger();
/// return state === "connected"
///   ? <span>{device?.model} ✓</span>
///   : <button onClick={connect}>Connect Ledger</button>;
/// ```

import { useCallback, useEffect, useState } from "react";
import { ledger } from "@/lib/ledger/index";
import type { LedgerDeviceInfo } from "@/lib/ledger/index";

/// Module-level flag so auto-connect runs ONCE per app session, not
/// once per `useLedger()` call. Without this, every `LedgerStatusPill`
/// + every `DeviceAction` button on a Learning Ledger lesson would
/// race each other to open/close the device — on macOS that
/// serialises through hidapi's blocking `open_path` and can hang the
/// UI for seconds at a time.
let autoConnectStarted = false;

export interface LedgerHook {
  /// "disconnected" until `connect()` resolves, then "connected".
  /// Switching back to "disconnected" happens on explicit disconnect
  /// OR on unrecoverable transport errors (HID timeout, USB unplug —
  /// the Rust transport drops its handle and the next call will
  /// re-trip until you re-connect).
  state: "disconnected" | "connected";
  device: LedgerDeviceInfo | null;
  /// Briefly true while a connect attempt is in flight. UI uses
  /// this to disable the "Connect" button + show a spinner.
  connecting: boolean;
  /// Last error from a connect/send attempt — cleared on success.
  /// Surfaced by the status-bar pill so the user sees "wrong app
  /// open" or "user denied" without digging through devtools.
  error: string | null;
  connect: () => Promise<LedgerDeviceInfo | null>;
  disconnect: () => Promise<void>;
  /// Clear `error` — called when the user dismisses an error toast.
  clearError: () => void;
}

export function useLedger(): LedgerHook {
  const [device, setDevice] = useState<LedgerDeviceInfo | null>(() =>
    ledger.device(),
  );
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe to transport state changes. The unsubscribe runs
    // on unmount + on hot reload.
    const off = (
      ledger as unknown as {
        onStatusChange?: (
          l: (
            s:
              | { state: "disconnected" }
              | { state: "connected"; device: LedgerDeviceInfo },
          ) => void,
        ) => () => void;
      }
    ).onStatusChange?.((s) => {
      if (s.state === "connected") setDevice(s.device);
      else setDevice(null);
    });

    // Kick off auto-connect ONCE per app session (gated by the
    // module-level `autoConnectStarted` flag). Every subsequent
    // `useLedger` mount just subscribes to status — they share the
    // single connect attempt + the single watcher subscription.
    //
    // The watcher itself runs forever for the rest of the app's
    // lifetime; cheap to keep alive (~1 IOKit call every few seconds
    // on macOS) and avoids the unmount-remount thrash that comes from
    // tying it to component lifecycle.
    if (!autoConnectStarted) {
      autoConnectStarted = true;
      void (async () => {
        // 1) Already-plugged-in case.
        try {
          await ledger.tryAutoConnect();
        } catch {
          /* best-effort */
        }
        // 2) Future plug-in case. The returned stop function isn't
        //    captured — the watcher is intentionally global; we want
        //    it running for the whole app session, not tied to any
        //    one component's lifecycle.
        try {
          await ledger.startAutoReconnect(() => {
            // Status listener already updates state; nothing to do.
          });
        } catch {
          /* best-effort */
        }
      })();
    }

    return () => {
      // Only the per-component status listener gets torn down on
      // unmount — the watcher + auto-connect attempt are global.
      if (off) off();
    };
  }, []);

  const connect = useCallback(async (): Promise<LedgerDeviceInfo | null> => {
    setConnecting(true);
    setError(null);
    try {
      const info = await ledger.connect();
      return info;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    await ledger.disconnect();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    state: device ? "connected" : "disconnected",
    device,
    connecting,
    error,
    connect,
    disconnect,
    clearError,
  };
}
