import { useEffect, useRef } from "react";
import {
  comboMatches,
  getBinding,
  parseKeyEvent,
} from "@/lib/keybindings/registry";

/// Subscribe to a global `keydown` event and fire `callback` when
/// the user presses the combo currently bound to `actionId`.
///
/// Why a hook + the registry instead of an inline listener:
///   - The actual combo can change at runtime (user rebinds in
///     Settings) — `getBinding` is read on EACH event so the
///     hook always sees the latest mapping with no re-subscription.
///   - Components that want to display the bound combo (Run button
///     tooltip, command palette help text) can pull it from the
///     same source via `getAction(id).defaultCombo` or
///     `getBinding(id)`, guaranteed to match what's installed.
///   - Centralising the input-guard logic (don't fire shortcuts
///     while typing inside an input / textarea / Monaco) means
///     every binding inherits the right behaviour by default.
///
/// `enabled` lets a component conditionally turn the binding off
/// without unmounting — e.g. the lesson-run shortcut should only
/// fire when a lesson is actually open, not on the library page.
///
/// `allowInInput` opts a binding INTO firing while focus is in an
/// editable element. Most shortcuts want the default (false). Run
/// (⌘R) sets this to `true` so it works while the cursor is in
/// Monaco — running the code is exactly what the learner wants
/// from there.
export interface UseKeybindingOptions {
  /// When false, the listener is attached but no-ops on every
  /// event. Defaults to true.
  enabled?: boolean;
  /// When true, fires even when the event target is an input,
  /// textarea, contenteditable element, or Monaco editor. Use this
  /// sparingly — most shortcuts would surprise the user by
  /// hijacking a keystroke inside a text field.
  allowInInput?: boolean;
}

/// Heuristic for "user is currently typing into a text field".
/// Returns true for native form inputs, contentEditable elements,
/// and anything inside Monaco (whose editable area is a
/// contentEditable div with class `monaco-editor` on the wrapper).
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // Monaco renders the editor as a tree of <div>s with the wrapper
  // carrying class "monaco-editor". The inner textarea is
  // role="textbox", and arrow keys / typed chars all originate
  // from inside that subtree — `closest(".monaco-editor")` catches
  // every descendant.
  if (target.closest(".monaco-editor")) return true;
  return false;
}

export function useKeybinding(
  actionId: string,
  callback: (e: KeyboardEvent) => void,
  opts: UseKeybindingOptions = {},
): void {
  const { enabled = true, allowInInput = false } = opts;

  // Stash the callback in a ref so we don't re-subscribe on every
  // render. Callers commonly pass an inline arrow that closes over
  // recent state — without this ref dance, every state change
  // would tear down + re-add the listener.
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (!allowInInput && isEditableTarget(e.target)) return;
      const target = getBinding(actionId);
      if (!target) return;
      const pressed = parseKeyEvent(e);
      if (!comboMatches(target, pressed)) return;
      e.preventDefault();
      cbRef.current(e);
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [actionId, enabled, allowInInput]);
}
