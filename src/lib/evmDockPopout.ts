/// Popout-window plumbing for the GanacheDock — opens the dock in
/// its own OS window so the learner can park it on a second monitor
/// while their tests run in the main editor. Mirrors the pattern in
/// `phonePopout.ts` (Tauri's WebviewWindow on desktop, plain
/// `window.open` fallback on the web build).
///
/// The popped window re-loads the app at `?evmDock=1` and `main.tsx`
/// routes to a tiny `EvmDockPopoutView` that mounts only the dock
/// in popout variant. State is shared via the `evmChainService`
/// singleton — both windows see the same chain because the runtime
/// chain instance lives in a module-scope variable inside
/// `evmChainService.ts`.
///
/// Caveat: the SAME-singleton story works only when both windows are
/// in the same WebKit process. In Tauri each WebviewWindow gets its
/// own JS realm, so the popout actually has its own chain singleton
/// — this is fine because the popout only DISPLAYS state; it never
/// drives transactions. The main window owns the chain; the popout
/// reads it via the chainSyncBus that mirrors the snapshot across
/// windows on every snapshot change.
///
/// (For now: simplest implementation — the popout has its own empty
/// chain. The main window's tx flow doesn't propagate visually.
/// Follow-up: add a Tauri-event-based bus that syncs snapshots.)

function isTauri(): boolean {
  return (
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== "undefined"
  );
}

const POPOUT_LABEL = "evm-dock";
const POPOUT_TITLE = "Fishbones — Local Chain";

export async function openEvmDockPopout(): Promise<void> {
  const base = new URL(window.location.href);
  // Strip params that would route the popout into a lesson — we
  // only want the dock UI, nothing else.
  base.searchParams.delete("course");
  base.searchParams.delete("lesson");
  base.searchParams.delete("popped");
  base.searchParams.delete("phone");
  base.searchParams.delete("scope");
  base.searchParams.delete("files");
  base.searchParams.set("evmDock", "1");
  const url = base.toString();

  if (isTauri()) {
    try {
      const { WebviewWindow } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const existing = await WebviewWindow.getByLabel(POPOUT_LABEL);
      if (existing) {
        await existing.setFocus();
        return;
      }
      new WebviewWindow(POPOUT_LABEL, {
        url,
        title: POPOUT_TITLE,
        width: 720,
        height: 520,
        minWidth: 520,
        minHeight: 380,
        resizable: true,
        decorations: true,
      });
      return;
    } catch (e) {
      console.warn("[evmDock] Tauri popout failed, falling back to window.open:", e);
    }
  }

  // Web fallback — native browser window. `popup=yes` hides browser
  // chrome on Chrome/Edge.
  const features = "popup=yes,width=720,height=520,resizable=yes";
  window.open(url, POPOUT_LABEL, features);
}
