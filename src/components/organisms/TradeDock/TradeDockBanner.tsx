/// Banner-mode TradeDock. Same shape as EvmDockBanner — App.tsx
/// mounts this above lessons that opt into the Trade harness;
/// the dock owns its own state via singletons in TradeDock.tsx
/// so this wrapper is just the mount point.
///
/// Future: a popout window (parallel to evm/dockPopout.ts) would
/// let the dock float over the editor on a second monitor; for v1
/// it lives inline above the lesson body like the chain docks.

import { TradeDock } from "./TradeDock";

export default function TradeDockBanner() {
  return <TradeDock variant="banner" />;
}
