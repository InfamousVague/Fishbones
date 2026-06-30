import { useEffect, useState } from "react";
import PhoneFrame from "@/components/molecules/PhoneFrame/PhoneFrame";
import {
  makePhonePreviewBus,
  type PhonePreviewMsg,
} from "@/lib/phonePopout";
import type { LogLine } from "@/runtimes/types";
import "./PhonePopoutView.css";

/// Standalone view rendered in the popped-out OS window when the
/// URL carries `?phone=1&scope=<id>`. Listens on the phone-preview
/// bus for whatever the main window pushes — running, preview URL,
/// console logs — and renders the simulator chrome around it.
///
/// This component is the entire React tree of the popped window
/// (`main.tsx` short-circuits `<App>` when `?phone=1` is present),
/// so we set the document body to fill its OS window and let
/// `PhoneFrame`'s aspect-ratio rules size the simulator to fit.
type State =
  | { kind: "empty" }
  | { kind: "running" }
  | { kind: "preview"; url: string }
  | { kind: "console"; logs: LogLine[]; error?: string };

export default function PhonePopoutView() {
  // `scope` keyed in `?scope=...` so each lesson / playground combo
  // gets its own bus channel. Without it a stale popout from one
  // lesson could pick up messages meant for another's phone preview.
  const scope = new URLSearchParams(window.location.search).get("scope") ?? "default";

  const [state, setState] = useState<State>({ kind: "empty" });

  useEffect(() => {
    const bus = makePhonePreviewBus(scope);
    const unlisten = bus.listen((msg: PhonePreviewMsg) => {
      switch (msg.type) {
        case "running":
          setState({ kind: "running" });
          break;
        case "preview":
          setState({ kind: "preview", url: msg.url });
          break;
        case "console":
          setState({
            kind: "console",
            logs: msg.logs,
            error: msg.error,
          });
          break;
        case "clear":
          setState({ kind: "empty" });
          break;
        case "request-state":
          // Originates from another popout instance, not the main
          // window — ignore. The main is the only side that should
          // respond to this message.
          break;
      }
    });
    // Handshake: ask the main window to re-emit its most recent
    // state so a fresh popout (opened AFTER the user already ran
    // code, or just after a reload) doesn't sit on the empty
    // placeholder forever. Cross-window emit is fire-and-forget;
    // the main window's LessonView listens for this on the same
    // bus and replies with a cached `preview` / `console` /
    // `running` message if it has one. Posted asynchronously so
    // the request always lands AFTER our own listener is wired —
    // otherwise we could miss our own request's reply.
    queueMicrotask(() => bus.emit({ type: "request-state" }));
    return unlisten;
  }, [scope]);

  return (
    <div className="libre-phone-popout-root">
      <PhoneFrame carrier="LIBRE">
        {state.kind === "empty" && (
          <div className="libre-phone-frame-placeholder">
            <span>
              run your code to see it here
              <br />
              on the simulator
            </span>
          </div>
        )}
        {state.kind === "running" && (
          <div className="libre-phone-frame-placeholder">
            <span>running…</span>
          </div>
        )}
        {state.kind === "preview" && (
          <iframe
            className="libre-phone-frame-iframe"
            title="React Native preview"
            src={state.url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        )}
        {state.kind === "console" && (
          <div className="libre-phone-frame-console">
            {state.logs.map((line, i) => (
              <div
                key={`popped-phone-log-${i}`}
                className={`libre-phone-frame-console-line libre-phone-frame-console-line--${line.level}`}
              >
                {line.text}
              </div>
            ))}
            {state.error && (
              <pre className="libre-phone-frame-console-error-block">
                {state.error}
              </pre>
            )}
          </div>
        )}
      </PhoneFrame>
    </div>
  );
}
