import { useLedger } from "@/hooks/useLedger";
import "./LedgerStatusPill.css";

/// Floating status chip showing whether a Ledger is connected, plus
/// a one-click connect/disconnect affordance. Mounted in lessons
/// that involve hardware-wallet interaction (any course or chapter
/// flagged `requiresDevice`).
///
/// Visual states:
///   - **disconnected**: outlined chip "Connect Ledger" — clicking
///     fires the WebHID picker (web) or opens the device by serial
///     (desktop).
///   - **connecting**: spinner + "Connecting…" — disabled while the
///     transport attempt is in flight.
///   - **connected**: filled chip "<model> ✓" — clicking disconnects.
///   - **error**: red-tinged chip showing the last failure, with a
///     dismiss × to clear it.
export default function LedgerStatusPill() {
  const { state, device, connecting, error, connect, disconnect, clearError } =
    useLedger();

  if (error) {
    return (
      <div
        className="libre-ledger-pill libre-ledger-pill--error"
        role="status"
        aria-live="polite"
      >
        <span className="libre-ledger-pill__label" title={error}>
          {error.length > 60 ? error.slice(0, 57) + "…" : error}
        </span>
        <button
          type="button"
          className="libre-ledger-pill__dismiss"
          onClick={clearError}
          aria-label="Dismiss error"
        >
          ×
        </button>
      </div>
    );
  }

  if (connecting) {
    return (
      <div className="libre-ledger-pill libre-ledger-pill--connecting">
        <span className="libre-ledger-pill__spinner" aria-hidden />
        <span className="libre-ledger-pill__label">Connecting…</span>
      </div>
    );
  }

  if (state === "connected" && device) {
    return (
      <button
        type="button"
        className="libre-ledger-pill libre-ledger-pill--connected"
        onClick={() => void disconnect()}
        title="Click to disconnect"
      >
        <span className="libre-ledger-pill__dot" aria-hidden />
        <span className="libre-ledger-pill__label">{device.model} connected</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="libre-ledger-pill libre-ledger-pill--disconnected"
      onClick={() => void connect()}
      title="Plug in your Ledger and click to connect"
    >
      <span className="libre-ledger-pill__icon" aria-hidden>
        ◯
      </span>
      <span className="libre-ledger-pill__label">Connect Ledger</span>
    </button>
  );
}
