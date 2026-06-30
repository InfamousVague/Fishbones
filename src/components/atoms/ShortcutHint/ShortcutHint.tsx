/// Small inline binding label rendered next to a button so the
/// learner discovers the keyboard shortcut without having to dig
/// through Settings → Shortcuts.
///
/// Two ways to surface a binding:
///
///   1. `<ShortcutHint actionId="lesson.run" />` — renders a
///      <kbd> chip ("⌘R" / "Ctrl+R") inline. Use inside or right
///      after a labelled button. The chip subscribes to runtime
///      override changes, so rebinding a shortcut updates every
///      visible hint immediately without prop-drilling.
///
///   2. `formatShortcutForTitle("Run", "lesson.run")` — returns
///      the string `"Run (⌘R)"` for icon-only buttons that surface
///      their label through the native `title` attribute. The
///      chip approach doesn't help on icon buttons because the
///      kbd glyph would crowd the icon visually.
///
/// Both helpers return `null` / unmodified label when the action
/// is unbound (a custom override may set an empty-string key as a
/// "this action has no binding" sentinel — we don't want to render
/// a blank chip in that case).

import { useEffect, useState } from "react";
import {
  formatBinding,
  getBinding,
  subscribeBindings,
} from "@/lib/keybindings/registry";
import "./ShortcutHint.css";

interface Props {
  actionId: string;
  /// Visual variant. "inline" sits flush in a button label; "muted"
  /// is the same but with lower contrast for use on already-busy
  /// surfaces (toolbars with lots of colour).
  variant?: "inline" | "muted";
  /// Extra className passthrough for callers that need to tweak
  /// spacing or alignment.
  className?: string;
}

export function ShortcutHint({ actionId, variant = "inline", className }: Props) {
  // Subscribe to override changes so this hint updates the moment
  // the user rebinds the action in Settings. The state itself is
  // just a tick counter — the real lookup happens via `getBinding`
  // every render so we always read the live cache.
  const [, setTick] = useState(0);
  useEffect(() => subscribeBindings(() => setTick((n) => n + 1)), []);

  const combo = getBinding(actionId);
  // Sentinel "unbound" marker — see registry's `findConflict` flow.
  if (!combo || combo.key === "") return null;

  const label = formatBinding(combo);
  const classes = [
    "libre-shortcut-hint",
    variant === "muted" && "libre-shortcut-hint--muted",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <kbd className={classes} aria-hidden="true">
      {label}
    </kbd>
  );
}

/// Compose a button title that surfaces both the human label and
/// the bound chord, so an icon-only button's native tooltip teaches
/// the shortcut.
///
///   formatShortcutForTitle("Open settings", "app.settings")
///     → "Open settings (⌘,)"   // mac
///     → "Open settings (Ctrl+,)" // win/linux
///
/// Returns the bare label when the action is unbound, so callers
/// can pass the result straight to `title` without conditional
/// glue.
export function formatShortcutForTitle(
  label: string,
  actionId: string,
): string {
  const combo = getBinding(actionId);
  if (!combo || combo.key === "") return label;
  return `${label} (${formatBinding(combo)})`;
}
