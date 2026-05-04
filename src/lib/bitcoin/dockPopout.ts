/// Popout-window plumbing for the Bitcoin chain dock — clones the
/// `lib/evm/dockPopout.ts` pattern. Opens the dock in its own OS
/// window so a learner can park it on a second monitor while their
/// tests run in the main editor.
///
/// Same caveat as the EVM popout: in Tauri each WebviewWindow gets
/// its own JS realm, so the popout has its own chain singleton.
/// For v0 the popped-out dock just shows whatever the singleton it
/// holds has — most learners run lessons in the main window so the
/// main window's chain is the authoritative one. A future cross-
/// window sync bus would mirror snapshots; not needed for Phase 2.

function isTauri(): boolean {
  return (
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== "undefined"
  );
}

const POPOUT_LABEL = "btc-dock";
const POPOUT_TITLE = "Fishbones — Local Bitcoin";

type StateListener = (popped: boolean) => void;
const listeners = new Set<StateListener>();
let isPopped = false;

function setPopped(next: boolean): void {
  if (isPopped === next) return;
  isPopped = next;
  for (const l of listeners) {
    try {
      l(next);
    } catch (e) {
      console.warn("[btcDock] popout listener threw:", e);
    }
  }
}

export function subscribeBitcoinDockPopout(
  listener: StateListener,
): () => void {
  listeners.add(listener);
  try {
    listener(isPopped);
  } catch (e) {
    console.warn("[btcDock] popout listener threw on subscribe:", e);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function isBitcoinDockPoppedOut(): boolean {
  return isPopped;
}

export async function openBitcoinDockPopout(): Promise<void> {
  const base = new URL(window.location.href);
  base.searchParams.delete("course");
  base.searchParams.delete("lesson");
  base.searchParams.delete("popped");
  base.searchParams.delete("phone");
  base.searchParams.delete("scope");
  base.searchParams.delete("files");
  base.searchParams.delete("evmDock");
  base.searchParams.set("btcDock", "1");
  const url = base.toString();

  if (isTauri()) {
    try {
      const { WebviewWindow } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const existing = await WebviewWindow.getByLabel(POPOUT_LABEL);
      if (existing) {
        await existing.setFocus();
        setPopped(true);
        return;
      }
      const win = new WebviewWindow(POPOUT_LABEL, {
        url,
        title: POPOUT_TITLE,
        width: 820,
        height: 580,
        minWidth: 600,
        minHeight: 420,
        resizable: true,
        decorations: true,
      });
      setPopped(true);
      void win.once("tauri://destroyed", () => {
        setPopped(false);
      });
      return;
    } catch (e) {
      console.warn(
        "[btcDock] Tauri popout failed, falling back to window.open:",
        e,
      );
    }
  }

  const features = "popup=yes,width=820,height=580,resizable=yes";
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

export async function closeBitcoinDockPopout(): Promise<void> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const win = await WebviewWindow.getByLabel(POPOUT_LABEL);
      if (win) await win.close();
    } catch (e) {
      console.warn("[btcDock] Tauri close failed:", e);
    }
  }
  setPopped(false);
}
