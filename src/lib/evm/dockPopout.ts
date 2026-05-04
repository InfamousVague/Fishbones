/// Popout-window plumbing for the ChainDock — opens the dock in
/// its own OS window so the learner can park it on a second monitor
/// while their tests run in the main editor. Mirrors the pattern in
/// `phonePopout.ts` (Tauri's WebviewWindow on desktop, plain
/// `window.open` fallback on the web build).
///
/// The popped window re-loads the app at `?evmDock=1` and `main.tsx`
/// routes to a tiny `EvmDockPopoutView` that mounts only the dock
/// in popout variant. State is shared via the `evm/chainService`
/// singleton — both windows see the same chain because the runtime
/// chain instance lives in a module-scope variable inside
/// `evm/chainService.ts`.
///
/// Caveat: the SAME-singleton story works only when both windows are
/// in the same WebKit process. In Tauri each WebviewWindow gets its
/// own JS realm, so the popout actually has its own chain singleton
/// — this is fine because the popout only DISPLAYS state; it never
/// drives transactions. The main window owns the chain; the popout
/// reads it via the chainSyncBus that mirrors the snapshot across
/// windows on every snapshot change.
///
/// Lifecycle events: callers (notably `EvmDockBanner`) want to know
/// when the popout opens and closes so they can hide the embedded
/// dock while the secondary window is alive — otherwise we'd render
/// the same chain UI twice. We track that with a tiny in-process
/// listener registry plus per-environment close detection:
///   - Tauri: subscribe to `tauri://destroyed` on the WebviewWindow
///   - Web:   poll `window.closed` on the `window.open()` return value

function isTauri(): boolean {
  return (
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== "undefined"
  );
}

const POPOUT_LABEL = "evm-dock";
const POPOUT_TITLE = "Fishbones — Local Chain";

type StateListener = (popped: boolean) => void;
const listeners = new Set<StateListener>();
let isPopped = false;

function setPopped(next: boolean) {
  if (isPopped === next) return;
  isPopped = next;
  for (const l of listeners) {
    try {
      l(next);
    } catch (e) {
      console.warn("[evmDock] popout listener threw:", e);
    }
  }
}

/// Subscribe to popout open/close. Returns an unsubscribe handle.
/// Callbacks receive `true` when the popout is open, `false` when
/// it has closed. Fires immediately with the current state.
export function subscribeEvmDockPopout(listener: StateListener): () => void {
  listeners.add(listener);
  // Fire current state right away so subscribers don't miss the
  // initial value (matches the `useSyncExternalStore` contract).
  try {
    listener(isPopped);
  } catch (e) {
    console.warn("[evmDock] popout listener threw on subscribe:", e);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function isEvmDockPoppedOut(): boolean {
  return isPopped;
}

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
        // If we already had it open and the listener registry was
        // re-mounted (e.g. after HMR), reaffirm the popped state.
        setPopped(true);
        return;
      }
      const win = new WebviewWindow(POPOUT_LABEL, {
        url,
        title: POPOUT_TITLE,
        width: 720,
        height: 520,
        minWidth: 520,
        minHeight: 380,
        resizable: true,
        decorations: true,
      });
      setPopped(true);
      // Tauri fires `tauri://destroyed` after the OS window has been
      // torn down; this is the right hook to flip our state back.
      // `once` so we don't leak the listener if the user re-pops the
      // dock and gets a fresh window.
      void win.once("tauri://destroyed", () => {
        setPopped(false);
      });
      return;
    } catch (e) {
      console.warn(
        "[evmDock] Tauri popout failed, falling back to window.open:",
        e,
      );
    }
  }

  // Web fallback — native browser window. `popup=yes` hides browser
  // chrome on Chrome/Edge. We poll `closed` because there's no
  // reliable cross-browser unload event that fires on the parent
  // when the child window dies.
  const features = "popup=yes,width=720,height=520,resizable=yes";
  const w = window.open(url, POPOUT_LABEL, features);
  if (!w) return;
  setPopped(true);
  const poll = window.setInterval(() => {
    if (w.closed) {
      window.clearInterval(poll);
      setPopped(false);
    }
  }, 600);
}

/// Close the popped EVM dock window if one is open. Symmetric with
/// `closePhonePopout` so callers (e.g. an in-app "close popout"
/// button) have a uniform API across the two popout types.
export async function closeEvmDockPopout(): Promise<void> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const win = await WebviewWindow.getByLabel(POPOUT_LABEL);
      if (win) await win.close();
    } catch (e) {
      console.warn("[evmDock] Tauri close failed:", e);
    }
  }
  // Browser fallback: window.open() returns a handle, but we don't
  // hold it across calls. Best effort — the user can close the OS
  // window manually. The poll loop set up at open time will flip
  // the popped state back on its own.
  setPopped(false);
}
