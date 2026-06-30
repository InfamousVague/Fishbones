import { useSyncExternalStore } from "react";
import { SvmDock } from "./SvmDock";
import {
  openSvmDockPopout,
  subscribeSvmDockPopout,
  isSvmDockPoppedOut,
} from "@/lib/svm/dockPopout";

/// Banner-mode SVM dock. Mirrors `EvmDockBanner` exactly — the only
/// reason this exists as its own component (rather than App.tsx
/// reaching into `SvmDock` directly) is the popped-out hide rule:
/// when the user pops the dock into its own OS window we want the
/// embedded banner to disappear so the same UI doesn't render twice.
///
/// `useSyncExternalStore` keeps us in sync with the popout registry
/// in `lib/svm/dockPopout.ts`, which flips `isPopped` back to false
/// when the popout window's `tauri://destroyed` event fires (or the
/// `window.closed` poll catches the browser fallback closing).
export default function SvmDockBanner() {
  const popped = useSyncExternalStore(
    subscribeSvmDockPopout,
    isSvmDockPoppedOut,
    // SSR / pre-mount snapshot — we never run on the server, but
    // useSyncExternalStore demands a getServerSnapshot if any caller
    // hydrates; default to "not popped" to match the module-scope
    // `isPopped = false` initial value.
    () => false,
  );

  if (popped) return null;

  return (
    <SvmDock
      variant="banner"
      onOpenPopout={() => {
        void openSvmDockPopout();
      }}
    />
  );
}
