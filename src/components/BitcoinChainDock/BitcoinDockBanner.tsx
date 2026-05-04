import { useSyncExternalStore } from "react";
import { BitcoinChainDock } from "./BitcoinChainDock";
import {
  openBitcoinDockPopout,
  subscribeBitcoinDockPopout,
  isBitcoinDockPoppedOut,
} from "../../lib/bitcoin/dockPopout";

/// Banner-mode Bitcoin dock. Mirrors `EvmDockBanner` exactly:
/// hides the embedded view while the popout window is alive, shows
/// it again when the popout closes (via `tauri://destroyed` or the
/// browser-fallback poll loop).
export default function BitcoinDockBanner() {
  const popped = useSyncExternalStore(
    subscribeBitcoinDockPopout,
    isBitcoinDockPoppedOut,
    () => false,
  );

  if (popped) return null;

  return (
    <BitcoinChainDock
      variant="banner"
      onOpenPopout={() => {
        void openBitcoinDockPopout();
      }}
    />
  );
}
