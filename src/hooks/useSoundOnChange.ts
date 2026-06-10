/// Fire an SFX cue when a tracked numeric value changes — the sound
/// counterpart to `useHapticOnChange`. Several cues (`streak-tick`,
/// `streak-flame`) were authored but never fired because wiring sound
/// to a "value crossed a threshold" event meant hand-rolling an
/// effect each time. This makes it a one-liner.
///
/// Skips the initial mount: the value the component first renders
/// with is treated as the baseline, so a page load never fires cues
/// for already-earned state (no "level up!" jingle just for opening
/// the app at level 12).

import { useEffect, useRef } from "react";
import { playSound, type PlayOptions, type SfxName } from "../lib/sfx";

interface SoundOnChangeOptions extends PlayOptions {
  /// Only fire when the value INCREASED (e.g. streak went up, not a
  /// reset to 0). Default true.
  increaseOnly?: boolean;
  /// Optional gate — fire only when it returns true for the
  /// (prev, next) pair. Use for milestone-only cues, e.g.
  /// `when: (_p, n) => [3, 7, 30, 100].includes(n)`.
  when?: (prev: number, next: number) => boolean;
}

export function useSoundOnChange(
  value: number,
  cue: SfxName,
  options?: SoundOnChangeOptions,
): void {
  const prev = useRef(value);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (value === before) return;
    const { increaseOnly = true, when, ...playOpts } = options ?? {};
    if (increaseOnly && value <= before) return;
    if (when && !when(before, value)) return;
    playSound(cue, playOpts);
    // Intentionally keyed on `value` only — `cue`/`options` are read
    // fresh from the latest render's closure on each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
