import { useEffect, useState } from "react";

/// Lesson workbench layout preferences.
///
/// `SplitOrientation` controls how the article and the editor/console
/// workbench are arranged within an exercise lesson:
///   - "horizontal" (default) — side by side: article on the left, the
///     workbench on the right, with a draggable column divider.
///   - "vertical" — stacked: article on top, workbench below, with a
///     draggable row divider.
/// The editor↔console split *inside* the workbench is always vertical and
/// is unaffected by this preference.
export type SplitOrientation = "horizontal" | "vertical";

const KEY = "libre:lesson-split-orientation";
/// Same-tab listeners don't receive the `storage` event (that only fires
/// in *other* tabs/windows), so writes also dispatch this custom event for
/// in-tab subscribers. The cross-window `storage` event keeps a popped-out
/// editor window in sync with the main window.
const EVENT = "libre:split-orientation-changed";

export function readSplitOrientation(): SplitOrientation {
  if (typeof localStorage === "undefined") return "horizontal";
  return localStorage.getItem(KEY) === "vertical" ? "vertical" : "horizontal";
}

export function writeSplitOrientation(next: SplitOrientation): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/// Flip the orientation and persist it. Returns the new value (handy for
/// callers that want to react immediately without a re-read).
export function toggleSplitOrientation(): SplitOrientation {
  const next: SplitOrientation =
    readSplitOrientation() === "horizontal" ? "vertical" : "horizontal";
  writeSplitOrientation(next);
  return next;
}

/// Subscribe to the split-orientation preference. Re-renders the caller on
/// change — both same-tab toggles (via the custom event) and cross-window
/// updates (via the `storage` event, so a popped-out editor stays synced).
export function useSplitOrientation(): SplitOrientation {
  const [orientation, setOrientation] = useState<SplitOrientation>(
    readSplitOrientation,
  );
  useEffect(() => {
    const sync = () => setOrientation(readSplitOrientation());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return orientation;
}
