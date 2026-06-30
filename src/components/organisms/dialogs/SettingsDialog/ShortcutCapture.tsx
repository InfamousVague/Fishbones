/// Inline rebind UX. Renders a "Press a key combination…" prompt
/// and listens for the next keydown — when the user presses a
/// valid combo, fires `onCapture(combo)`; pressing bare Escape
/// fires `onCancel()` instead.
///
/// "Valid combo" rules:
///   - A non-modifier key MUST be present (modifier-only presses
///     are ignored so the listener doesn't fire mid-Cmd-hold).
///   - For letter / digit / symbol keys, at least one modifier
///     must accompany them — binding bare "r" or "/" would fire
///     every time the user typed that character outside an input,
///     which is rarely the intent.
///   - Standalone navigation keys (Escape, Enter, Tab, Arrows)
///     are accepted without a modifier — these are the natural
///     "modal-close" / "list-navigation" bindings.
///
/// The component uses `capture: true` on the listener so it
/// receives events BEFORE any descendant handlers, and calls both
/// `preventDefault()` and `stopPropagation()` to make sure the
/// captured keystroke doesn't accidentally trigger anything else
/// while the user is rebinding.

import { useEffect, useState } from "react";
import {
  type BindingCombo,
  formatBinding,
  parseKeyEvent,
} from "@/lib/keybindings/registry";
import { useT } from "@/i18n/i18n";
import "./ShortcutCapture.css";

interface Props {
  onCapture: (combo: BindingCombo) => void;
  onCancel: () => void;
}

const STANDALONE_OK = new Set([
  "Escape",
  "Enter",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

const MODIFIER_ONLY = new Set([
  "Meta",
  "Control",
  "Shift",
  "Alt",
  "OS",
  "Hyper",
  "Super",
]);

export function ShortcutCapture({ onCapture, onCancel }: Props) {
  const t = useT();
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore raw modifier-key presses; we wait for the
      // non-modifier key that completes the combo.
      if (MODIFIER_ONLY.has(e.key)) return;

      // Standalone Escape with no modifiers = cancel. (A bare Esc
      // bound to "modal.close" still gets a chance to be set
      // explicitly by the user via the next branch — but cancel-
      // on-Esc is the more common intent, so we prioritise it.)
      if (
        e.key === "Escape" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const combo = parseKeyEvent(e);

      // Require a modifier for typeable keys so the binding can't
      // accidentally fire mid-typing in a non-input region.
      const needsModifier = !STANDALONE_OK.has(combo.key);
      if (needsModifier && combo.modifiers.length === 0) {
        setWarning(
          t("settings.shortcutNeedsModifier", { combo: formatBinding(combo) }),
        );
        return;
      }

      onCapture(combo);
    };

    // Use capture phase so we beat any other key handlers
    // currently mounted (e.g. the existing bindings the user is
    // about to override).
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onCapture, onCancel, t]);

  return (
    <div className="libre-shortcut-capture" role="status" aria-live="polite">
      <span className="libre-shortcut-capture__prompt">
        {t("settings.shortcutCapturePrompt")} <kbd>Esc</kbd>{" "}
        {t("settings.shortcutCaptureCancel")}
      </span>
      {warning && (
        <span className="libre-shortcut-capture__warning">{warning}</span>
      )}
    </div>
  );
}
