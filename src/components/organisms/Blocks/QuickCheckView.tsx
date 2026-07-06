/// Quick-check render modes for a blocks exercise — CLOZE (fill the
/// one gap) and BUG HUNT (tap the line that's wrong). Both derive
/// entirely from the lesson's existing authored `BlocksData`; no new
/// content pipeline:
///
///   - **cloze**: every slot except one is pre-filled with its
///     canonical block; the learner picks the missing block from a
///     small choice row (the expected block + decoys / other-slot
///     blocks, deterministically shuffled).
///   - **bug**: every slot is filled, but ONE got a decoy instead of
///     its canonical block. The learner taps the line that's wrong;
///     a correct tap swaps the decoy out for the fix.
///
/// Why: mechanic variety. Every high-completion mobile learning app
/// (Mimo, Sololearn, DataCamp, Duolingo) rotates several interaction
/// types per session; a steady diet of full block assembly reads as
/// grind. `pickExerciseMode` rotates lessons deterministically (by
/// lesson-id hash) across whichever modes the lesson's data supports,
/// so a given lesson always renders the same mode — no sync or
/// memorisation weirdness — but a chapter's exercises vary.
///
/// Grading: answer-key structural check (chip id / slot id match),
/// NOT the compile+test pipeline full BlocksView runs. These are
/// deliberately quick checks — the full assembly mode remains the
/// place where synthesised source actually executes. Completion
/// stays with the lesson's bottom Next nav (same contract as
/// MobileQuiz / the reader): solving shows the confirmation state,
/// Next marks complete + advances.

import { useEffect, useMemo, useState } from "react";
import type {
  BlocksData,
  ExerciseLesson,
  LanguageId,
  MixedLesson,
} from "@/data/types";
import { fireHaptic } from "@/lib/haptics";
import { useT } from "@/i18n/i18n";
import {
  highlightChip,
  highlightTemplate,
  type RenderedLine,
  type RenderedToken,
} from "./highlight";
import "./BlocksView.css";
import "./QuickCheckView.css";

export type QuickCheckMode = "cloze" | "bug";
export type ExerciseRenderMode = "blocks" | QuickCheckMode;

/// Tiny FNV-1a — stable across sessions/devices so a lesson always
/// renders the same mode and the same derived puzzle.
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/// Deterministic in-place-ish shuffle (returns a new array).
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function blocksOf(lesson: ExerciseLesson | MixedLesson): BlocksData | undefined {
  return lesson.blocks;
}

/// Which render mode a lesson's exercise should use. Deterministic by
/// lesson id, restricted to the modes the authored data can support:
///   - cloze needs ≥1 slot and ≥2 pool blocks (a gap plus at least
///     one distractor choice),
///   - bug needs ≥1 slot and ≥1 decoy (swapping in another slot's
///     canonical block could accidentally still be valid; decoys are
///     authored to be plausible-but-wrong).
/// Full assembly stays in the rotation so it remains the most common
/// mode (it's the only compile-verified one).
export function pickExerciseMode(
  lesson: ExerciseLesson | MixedLesson,
): ExerciseRenderMode {
  const data = blocksOf(lesson);
  if (!data || data.slots.length === 0 || data.pool.length === 0) {
    return "blocks";
  }
  const eligible: ExerciseRenderMode[] = ["blocks"];
  if (data.slots.length >= 1 && data.pool.length >= 2) eligible.push("cloze");
  if (data.pool.some((b) => b.decoy)) eligible.push("bug");
  if (eligible.length === 1) return "blocks";
  // Weight assembly double so roughly half of a chapter's exercises
  // stay full-assembly: [blocks, blocks, cloze, bug] style ring.
  const ring: ExerciseRenderMode[] = ["blocks", ...eligible.slice(1), "blocks"];
  return ring[hashString(lesson.id) % ring.length];
}

export interface ClozePuzzle {
  targetSlotId: string;
  /// blockId → code for every NON-target slot (pre-filled context).
  fills: Record<string, string>;
  /// Choice blocks, shuffled; exactly one has id === expectedId.
  choices: { id: string; code: string }[];
  expectedId: string;
}

export function deriveCloze(data: BlocksData, seed: number): ClozePuzzle {
  const target = data.slots[seed % data.slots.length];
  const blockById = new Map(data.pool.map((b) => [b.id, b]));
  const fills: Record<string, string> = {};
  for (const slot of data.slots) {
    if (slot.id === target.id) continue;
    fills[slot.id] = blockById.get(slot.expectedBlockId)?.code ?? "";
  }
  const expected = blockById.get(target.expectedBlockId);
  // Distractors: decoys first (authored to look plausible), then other
  // slots' canonical blocks. Cap the row at 4 choices — phone width.
  const others = data.pool.filter(
    (b) => b.id !== target.expectedBlockId && (b.decoy || b.code !== expected?.code),
  );
  const distractors = seededShuffle(others, seed ^ 0x9e3779b9)
    .sort((a, b) => Number(!!b.decoy) - Number(!!a.decoy))
    .slice(0, 3);
  const choices = seededShuffle(
    [
      { id: target.expectedBlockId, code: expected?.code ?? "" },
      ...distractors.map((b) => ({ id: b.id, code: b.code })),
    ],
    seed,
  );
  return {
    targetSlotId: target.id,
    fills,
    choices,
    expectedId: target.expectedBlockId,
  };
}

export interface BugPuzzle {
  /// Slot that got the decoy.
  targetSlotId: string;
  /// slotId → code for EVERY slot (target holds the decoy's code).
  fills: Record<string, string>;
  /// The canonical code that fixes the target slot.
  fixCode: string;
}

export function deriveBug(data: BlocksData, seed: number): BugPuzzle | null {
  const decoys = data.pool.filter((b) => b.decoy);
  if (decoys.length === 0 || data.slots.length === 0) return null;
  const target = data.slots[seed % data.slots.length];
  const decoy = decoys[(seed >>> 8) % decoys.length];
  const blockById = new Map(data.pool.map((b) => [b.id, b]));
  const fills: Record<string, string> = {};
  for (const slot of data.slots) {
    fills[slot.id] =
      slot.id === target.id
        ? decoy.code
        : blockById.get(slot.expectedBlockId)?.code ?? "";
  }
  return {
    targetSlotId: target.id,
    fills,
    fixCode: blockById.get(target.expectedBlockId)?.code ?? "",
  };
}

/// Line-split fallback identical in shape to highlightTemplate's
/// output, used until Shiki resolves so layout never reflows.
function plainLines(template: string): RenderedLine[] {
  return template.split("\n").map((rawLine) => {
    const line: RenderedToken[] = [];
    const re = /__SLOT_([A-Za-z0-9_-]+)__/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawLine)) !== null) {
      if (m.index > last) line.push({ kind: "text", content: rawLine.slice(last, m.index) });
      line.push({ kind: "slot", slotId: m[1] });
      last = m.index + m[0].length;
    }
    if (last < rawLine.length) line.push({ kind: "text", content: rawLine.slice(last) });
    return line;
  });
}

interface Props {
  lesson: ExerciseLesson | MixedLesson;
  mode: QuickCheckMode;
  /// Kept for prop-shape parity with BlocksView; the bottom Next nav
  /// owns completion (see module docstring), so this is unused today.
  onComplete?: () => void;
}

export default function QuickCheckView({ lesson, mode }: Props) {
  const t = useT();
  const data = blocksOf(lesson);
  const language = lesson.language as LanguageId;
  const seed = useMemo(() => hashString(lesson.id), [lesson.id]);

  const cloze = useMemo(
    () => (data && mode === "cloze" ? deriveCloze(data, seed) : null),
    [data, mode, seed],
  );
  const bug = useMemo(
    () => (data && mode === "bug" ? deriveBug(data, seed) : null),
    [data, mode, seed],
  );

  const [lines, setLines] = useState<RenderedLine[]>(() =>
    data ? plainLines(data.template) : [],
  );
  const [chipTokens, setChipTokens] = useState<Map<string, RenderedToken[]>>(
    new Map(),
  );
  const [solved, setSolved] = useState(false);
  const [wrongIds, setWrongIds] = useState<Set<string>>(new Set());

  // Shiki highlight — template + every code fragment we render
  // (fills, choices, the bug fix), same pipeline BlocksView uses.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    void highlightTemplate(data.template, language).then((ls) => {
      if (!cancelled) setLines(ls);
    });
    const fragments = new Set<string>();
    if (cloze) {
      Object.values(cloze.fills).forEach((c) => fragments.add(c));
      cloze.choices.forEach((c) => fragments.add(c.code));
    }
    if (bug) {
      Object.values(bug.fills).forEach((c) => fragments.add(c));
      fragments.add(bug.fixCode);
    }
    void Promise.all(
      Array.from(fragments).map(async (code) => {
        const tokens = await highlightChip(code, language);
        return [code, tokens] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setChipTokens(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [data, language, cloze, bug]);

  if (!data || (mode === "bug" && !bug) || (mode === "cloze" && !cloze)) {
    return null;
  }

  const renderCode = (code: string) => {
    const tokens = chipTokens.get(code);
    if (!tokens) return <>{code}</>;
    return (
      <>
        {tokens.map((t, i) =>
          t.kind === "text" ? (
            <span key={i} style={t.color ? { color: t.color } : undefined}>
              {t.content}
            </span>
          ) : null,
        )}
      </>
    );
  };

  /// A slot token rendered as a static, pre-filled chip.
  const FilledChip = ({ code, state }: { code: string; state?: "wrong" | "fixed" }) => (
    <span
      className={
        "libre-blocks__chip libre-blocks__chip--placed libre-qc__chip" +
        (state === "wrong" ? " libre-qc__chip--bugged" : "") +
        (state === "fixed" ? " libre-qc__chip--fixed" : "")
      }
    >
      <code>{renderCode(code)}</code>
    </span>
  );

  // ── CLOZE ──────────────────────────────────────────────────────────
  if (mode === "cloze" && cloze) {
    const pickChoice = (id: string) => {
      if (solved) return;
      if (id === cloze.expectedId) {
        setSolved(true);
        fireHaptic("notification-success");
      } else {
        setWrongIds((prev) => new Set(prev).add(id));
        fireHaptic("impact-light");
      }
    };
    return (
      <div className="libre-qc">
        <p className="libre-blocks__prompt">
          {data.prompt ?? t("lesson.qcFillMissing")}
        </p>
        <pre className="libre-blocks__template libre-qc__template">
          <code>
            {lines.map((line, li) => (
              <span key={li} className="libre-blocks__line">
                {line.map((t, ti) => {
                  if (t.kind === "text") {
                    return (
                      <span key={ti} style={t.color ? { color: t.color } : undefined}>
                        {t.content}
                      </span>
                    );
                  }
                  if (t.slotId === cloze.targetSlotId) {
                    return solved ? (
                      <FilledChip key={ti} code={cloze.choices.find((c) => c.id === cloze.expectedId)?.code ?? ""} state="fixed" />
                    ) : (
                      <span key={ti} className="libre-blocks__slot libre-qc__gap">
                        <span className="libre-blocks__slot-placeholder">?</span>
                      </span>
                    );
                  }
                  return <FilledChip key={ti} code={cloze.fills[t.slotId] ?? ""} />;
                })}
                {"\n"}
              </span>
            ))}
          </code>
        </pre>
        <div
          className="libre-qc__choices"
          role="group"
          aria-label={t("lesson.qcChoices")}
        >
          {cloze.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={solved || wrongIds.has(c.id)}
              className={
                "libre-blocks__chip libre-qc__choice" +
                (wrongIds.has(c.id) ? " libre-qc__choice--wrong" : "") +
                (solved && c.id === cloze.expectedId ? " libre-qc__choice--right" : "")
              }
              onClick={() => pickChoice(c.id)}
            >
              <code>{renderCode(c.code)}</code>
            </button>
          ))}
        </div>
        {solved && (
          <p className="libre-qc__done" role="status">
            {t("lesson.qcCorrectNext")}
          </p>
        )}
      </div>
    );
  }

  // ── BUG HUNT ───────────────────────────────────────────────────────
  if (mode === "bug" && bug) {
    // Which rendered line contains the corrupted slot?
    const bugLineIdx = lines.findIndex((line) =>
      line.some((t) => t.kind === "slot" && t.slotId === bug.targetSlotId),
    );
    const tapLine = (li: number) => {
      if (solved) return;
      // Only lines that contain a slot are candidates — tapping
      // scaffolding shouldn't burn an attempt.
      const hasSlot = lines[li].some((t) => t.kind === "slot");
      if (!hasSlot) return;
      if (li === bugLineIdx) {
        setSolved(true);
        fireHaptic("notification-success");
      } else {
        setWrongIds((prev) => new Set(prev).add(String(li)));
        fireHaptic("impact-light");
      }
    };
    return (
      <div className="libre-qc">
        <p className="libre-blocks__prompt">
          {t("lesson.qcBugPrompt")}
        </p>
        <pre className="libre-blocks__template libre-qc__template">
          <code>
            {lines.map((line, li) => {
              const tappable = !solved && line.some((t) => t.kind === "slot");
              return (
                <span
                  key={li}
                  className={
                    "libre-blocks__line libre-qc__line" +
                    (tappable ? " libre-qc__line--tappable" : "") +
                    (wrongIds.has(String(li)) ? " libre-qc__line--miss" : "") +
                    (solved && li === bugLineIdx ? " libre-qc__line--fixed" : "")
                  }
                  onClick={() => tapLine(li)}
                >
                  {line.map((t, ti) => {
                    if (t.kind === "text") {
                      return (
                        <span key={ti} style={t.color ? { color: t.color } : undefined}>
                          {t.content}
                        </span>
                      );
                    }
                    const isTarget = t.slotId === bug.targetSlotId;
                    return (
                      <FilledChip
                        key={ti}
                        code={
                          isTarget && solved
                            ? bug.fixCode
                            : bug.fills[t.slotId] ?? ""
                        }
                        // NEVER mark the bugged chip before it's found —
                        // a distinct style would hand over the answer.
                        state={isTarget && solved ? "fixed" : undefined}
                      />
                    );
                  })}
                  {"\n"}
                </span>
              );
            })}
          </code>
        </pre>
        {solved && (
          <p className="libre-qc__done" role="status">
            {t("lesson.qcFixedNext")}
          </p>
        )}
      </div>
    );
  }

  return null;
}
