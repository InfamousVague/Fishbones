/// Top-level React error boundary.
///
/// The app shipped with NO error boundary anywhere, so a single
/// uncaught render/lifecycle throw unmounted the whole tree to a
/// blank white screen with no recovery path — the worst-feeling
/// failure mode on iPad / packaged builds where there's no Web
/// Inspector to even see what broke.
///
/// This catches those throws and paints a branded "something went
/// wrong — reload" card. The fallback uses INLINE styles on purpose:
/// if the failure is in the stylesheet/theme layer, the app's CSS
/// classes can't be trusted, so the recovery screen must render
/// correctly with zero external CSS.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

const wrapStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "#14101c",
  color: "#f5f5f7",
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  zIndex: 99999,
};

const cardStyle: React.CSSProperties = {
  maxWidth: 380,
  textAlign: "center",
};

const btnStyle: React.CSSProperties = {
  marginTop: 20,
  background: "#e8732c",
  color: "#ffffff",
  border: "none",
  borderRadius: 10,
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(
      "[libre] uncaught render error:",
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={wrapStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 30, marginBottom: 10 }} aria-hidden>
            🐟
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              opacity: 0.7,
              margin: 0,
            }}
          >
            Libre hit an unexpected error and couldn't continue. Your
            progress is saved on this device — reloading usually clears it.
          </p>
          <button
            type="button"
            style={btnStyle}
            onClick={() => window.location.reload()}
          >
            Reload Libre
          </button>
        </div>
      </div>
    );
  }
}
