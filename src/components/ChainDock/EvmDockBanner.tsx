import { useSyncExternalStore } from "react";
import { ChainDock } from "./ChainDock";
import {
  openEvmDockPopout,
  subscribeEvmDockPopout,
  isEvmDockPoppedOut,
} from "../../lib/evm/dockPopout";

/// Banner-mode dock. Memoised so the parent re-rendering doesn't
/// also rebuild the heavy chain subscriber chain — the dock listens
/// to its own external store via `subscribe()` and re-renders only
/// on real chain mutations.
///
/// Pop-out behaviour: when the user opens the chain in its own OS
/// window we hide the embedded banner so the same UI doesn't render
/// twice (and so the editor regains the vertical space). The
/// `subscribeEvmDockPopout` registry flips back to `false` when
/// the popout window's `tauri://destroyed` event fires (or the
/// `window.closed` poll catches the browser fallback closing).
export default function EvmDockBanner() {
  const popped = useSyncExternalStore(
    subscribeEvmDockPopout,
    isEvmDockPoppedOut,
    // SSR / pre-mount snapshot — we never run on the server, but
    // useSyncExternalStore demands a getServerSnapshot if any caller
    // hydrates; default to "not popped" which matches the initial
    // module-scope `isPopped = false`.
    () => false,
  );

  if (popped) return null;

  return (
    <ChainDock
      variant="banner"
      onOpenPopout={() => {
        void openEvmDockPopout();
      }}
    />
  );
}
