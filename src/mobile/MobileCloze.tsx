/// Mobile cloze (fill-in-the-blank) renderer. The user sees the
/// canonical solution code with key tokens replaced by tappable
/// chips; tapping a chip pops a sheet of options to choose from.
/// Once every chip has a correct pick, the lesson auto-completes.
///
/// This is the contextual-fill-in answer to the "puzzles either give
/// us one-liners or huge wall-of-code blocks" complaint: instead of
/// arranging chunks, the learner reads the solution AS code and
/// drills on the specific tokens that matter (function names, key
/// keywords, the line that does the work).

import { useEffect, useMemo, useState } from "react";
import type { ClozeSlot } from "../data/types";
import "./MobileCloze.css";

interface Props {
  /// Canonical code with `__SLOT_<id>__` markers. The renderer walks
  /// this top-to-bottom, splitting at each marker, and inlines a
  /// chip in the gap.
  template: string;
  slots: ClozeSlot[];
  /// Optional intro narration. Falls back to a neutral default.
  prompt?: string;
  /// Whether the lesson is already complete from a previous session.
  /// Used to pre-fill every slot with its answer + show the celebrate
  /// state immediately, so a re-visit reads as "you nailed this".
  isCompleted?: boolean;
  /// Retained for prop-shape compatibility with the dispatch but no
  /// longer auto-fired — the lesson's bottom Next nav owns "mark
  /// complete + advance" across every kind. Underscored to silence
  /// the unused-prop lint without changing the public type.
  onComplete?: () => void;
}

interface SlotPick {
  /// Currently selected option (`null` = unfilled). Comparison is by
  /// exact string equality against `ClozeSlot.answer`.
  picked: string | null;
}

const SLOT_RE = /__SLOT_([A-Za-z0-9_-]+)__/g;

export default function MobileCloze({
  template,
  slots,
  prompt,
  isCompleted,
}: Props) {
  // Per-slot pick state. Pre-filled with the answer when the lesson
  // is already complete so a re-visit shows the solved state at a
  // glance — same pattern MobilePuzzle uses for completed puzzles.
  const [picks, setPicks] = useState<Record<string, SlotPick>>(() => {
    const init: Record<string, SlotPick> = {};
    for (const s of slots) {
      init[s.id] = { picked: isCompleted ? s.answer : null };
    }
    return init;
  });
  // The slot-id whose option sheet is currently open. `null` = no
  // sheet visible. Only one sheet at a time keeps the UI calm and
  // avoids stacking overlays.
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<boolean>(Boolean(isCompleted));
  const [fired, setFired] = useState<boolean>(Boolean(isCompleted));

  // Stable per-slot shuffled option order. Computed once per (slot.id,
  // options) so the sheet doesn't re-shuffle every time the user
  // re-opens it — that would feel like the answers are moving
  // mid-decision, which is disorienting.
  const optionOrder = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const s of slots) {
      out[s.id] = shuffle(s.options);
    }
    return out;
    // We intentionally don't depend on `slots` reference identity
    // since hydration may rebuild the array — depend on the joined
    // option strings instead so we re-shuffle only when the actual
    // option set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots.map((s) => s.id + ":" + s.options.join("|")).join("\n")]);

  // Walk the template once into a sequence of {kind: 'text', text}
  // and {kind: 'slot', id} segments so the renderer is a flat map.
  const segments = useMemo(() => parseTemplate(template), [template]);

  // Reveal celebration the first time every slot is correct. We
  // intentionally do NOT call onComplete here — the lesson's bottom
  // Next nav owns "mark complete + advance" across every kind. This
  // effect only flips the visual reveal state so the chips brighten
  // up and the learner sees they've nailed it.
  useEffect(() => {
    if (fired) return;
    if (slots.length === 0) return;
    for (const s of slots) {
      if (picks[s.id]?.picked !== s.answer) return;
    }
    setRevealed(true);
    setFired(true);
  }, [picks, slots, fired]);

  const filledCount = slots.filter(
    (s) => picks[s.id]?.picked === s.answer,
  ).length;

  return (
    <section className="m-cloze" aria-label="Fill in the blanks">
      <p className="m-cloze__prompt">
        {prompt ?? "Fill in the blanks."}
      </p>

      <pre className="m-cloze__code">
        <code>
          {segments.map((seg, idx) =>
            seg.kind === "text" ? (
              <span key={`t${idx}`} className="m-cloze__text">
                {seg.text}
              </span>
            ) : (
              <ChipSpan
                key={`s${seg.id}-${idx}`}
                slotId={seg.id}
                slot={slots.find((s) => s.id === seg.id)}
                pick={picks[seg.id]?.picked ?? null}
                isCorrect={
                  picks[seg.id]?.picked ===
                  slots.find((s) => s.id === seg.id)?.answer
                }
                revealed={revealed}
                onTap={() => setOpenSlot(seg.id)}
              />
            ),
          )}
        </code>
      </pre>

      <p className="m-cloze__progress" aria-live="polite">
        {filledCount}/{slots.length} blanks filled
      </p>

      {openSlot && (
        <OptionSheet
          slot={slots.find((s) => s.id === openSlot)!}
          options={optionOrder[openSlot] ?? []}
          currentPick={picks[openSlot]?.picked ?? null}
          onPick={(value) => {
            setPicks((prev) => ({
              ...prev,
              [openSlot]: { picked: value },
            }));
            setOpenSlot(null);
          }}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </section>
  );
}

/// One inline chip rendered where a slot lives in the template.
function ChipSpan({
  slotId,
  slot,
  pick,
  isCorrect,
  revealed,
  onTap,
}: {
  slotId: string;
  slot?: ClozeSlot;
  pick: string | null;
  isCorrect: boolean;
  revealed: boolean;
  onTap: () => void;
}) {
  // Slot referenced by template but missing from the slots array.
  // Shouldn't happen in well-formed lessons but render a placeholder
  // rather than crashing — easier to spot the data bug.
  if (!slot) {
    return <span className="m-cloze__chip m-cloze__chip--missing">?</span>;
  }
  const isWrong = pick !== null && !isCorrect;
  const cls =
    "m-cloze__chip" +
    (pick === null ? " m-cloze__chip--empty" : "") +
    (isCorrect ? " m-cloze__chip--correct" : "") +
    (isWrong ? " m-cloze__chip--wrong" : "") +
    (revealed && isCorrect ? " m-cloze__chip--revealed" : "");
  const label = pick ?? `pick ${slot.hint ?? "answer"}`;
  return (
    <button
      type="button"
      className={cls}
      onClick={onTap}
      data-slot={slotId}
      aria-label={
        pick
          ? `Slot ${slotId}, picked: ${pick}. Tap to change.`
          : `Slot ${slotId}, empty. Tap to fill.`
      }
    >
      {label}
    </button>
  );
}

/// Bottom-sheet of option chips. Mirrors MobileOutline's sheet
/// pattern (slide up, tap-backdrop-to-dismiss) so cloze + outline
/// share visual vocabulary.
function OptionSheet({
  slot,
  options,
  currentPick,
  onPick,
  onClose,
}: {
  slot: ClozeSlot;
  options: string[];
  currentPick: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="m-cloze-sheet-backdrop" onClick={onClose}>
      <div
        className="m-cloze-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Pick a value${slot.hint ? ` (${slot.hint})` : ""}`}
      >
        <div className="m-cloze-sheet__grip" aria-hidden />
        <div className="m-cloze-sheet__head">
          {slot.hint ? `Pick a ${slot.hint}` : "Pick a value"}
        </div>
        <ul className="m-cloze-sheet__list">
          {options.map((opt) => {
            const active = opt === currentPick;
            return (
              <li key={opt}>
                <button
                  type="button"
                  className={
                    "m-cloze-sheet__opt" +
                    (active ? " m-cloze-sheet__opt--active" : "")
                  }
                  onClick={() => onPick(opt)}
                >
                  <code>{opt}</code>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/// Walk a cloze template into alternating text / slot segments.
/// Exported indirectly via the renderer; unit-testable in isolation.
function parseTemplate(
  template: string,
): Array<{ kind: "text"; text: string } | { kind: "slot"; id: string }> {
  const out: Array<
    { kind: "text"; text: string } | { kind: "slot"; id: string }
  > = [];
  let last = 0;
  // The regex has the `g` flag — reset lastIndex so multiple
  // calls (template change + re-render) start from the top.
  SLOT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLOT_RE.exec(template)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", text: template.slice(last, m.index) });
    }
    out.push({ kind: "slot", id: m[1] });
    last = m.index + m[0].length;
  }
  if (last < template.length) {
    out.push({ kind: "text", text: template.slice(last) });
  }
  return out;
}

/// Fisher-Yates shuffle, returning a new array. Used for the option
/// order on each slot — see comment in MobileCloze.
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
