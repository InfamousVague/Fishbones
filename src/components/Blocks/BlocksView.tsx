/// Building-blocks view for an exercise — desktop *and* mobile. The
/// learner sees the lesson's solution rendered as a code template
/// with `__SLOT_<id>__` markers replaced by drop zones, and a tray
/// of blocks (correct + decoys) below. They place blocks into slots
/// (drag, or tap-to-select-then-tap-to-place); when every slot is
/// filled, hitting Verify synthesises the assembled source and runs
/// it through the same `runFiles` pipeline editor mode uses.
///
/// Why this lives outside the existing Workbench / EditorPane: that
/// stack is Monaco-heavy (file tabs, language servers, syntax-aware
/// autocomplete) and assumes a free-form text buffer. Blocks mode is
/// a different interaction entirely — discrete chips, drop zones,
/// no typing. The two modes share the OutputPane (test results) and
/// the verify pipeline; everything else is its own surface.
///
/// Drag library: `@dnd-kit/core` — small (~30 KB gz), accessible
/// (built-in keyboard sensor, ARIA grabbed/dropped announcements),
/// and supports both pointer and touch sensors uniformly. We layer
/// a tap-to-place fallback on top so phone learners who can't drag
/// reliably (one-thumb use, scrolling conflicts) still have a path.
///
/// Verification semantics: we ALWAYS run the test suite — never
/// short-circuit on `isBlocksAllCorrect`. Compile-based verification
/// is the user's stated requirement: the lesson is complete when
/// the synthesised source compiles + tests pass, not when the
/// placements happen to match the canonical answer key. (The
/// answer-key check is still useful for instant per-slot feedback
/// before the user clicks Verify, but it's not the gate.)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  assembleBlocksSource,
  isBlocksAllCorrect,
  isBlocksFullyPlaced,
  type Block,
  type BlocksData,
  type ExerciseLesson,
  type LanguageId,
  type MixedLesson,
} from "../../data/types";
import {
  deriveStarterFiles,
} from "../../lib/workbenchFiles";
import { runFiles, type RunResult } from "../../runtimes";
import { isMobile } from "../../lib/platform";
import { fireHaptic } from "../../lib/haptics";
import OutputPane from "../Output/OutputPane";
import Workbench from "../Workbench/Workbench";
import {
  highlightChip,
  highlightTemplate,
  type RenderedLine,
  type RenderedToken,
} from "./highlight";
import "./BlocksView.css";

interface Props {
  /// The lesson under play. We only read `language`, `tests`,
  /// `harness`, `files` (for multi-file shape), and the blocks
  /// payload — the actual `solution` text is irrelevant to this
  /// view; the synthesised source comes from template + placements.
  lesson: ExerciseLesson | MixedLesson;
  /// Stable id for persistence (placements survive HMR + tab
  /// switches but reset when the lesson changes). Falls back to
  /// `lesson.id` when omitted.
  storageKey?: string;
  /// Optional: called once when every test passes, so the parent
  /// can credit lesson completion. Mirrors the desktop editor
  /// flow's "tests pass" hook.
  onComplete?: () => void;
  /// Optional: called when the learner's placements compile + pass
  /// tests, with the assembled `WorkbenchFile[]` that produced the
  /// passing run. The desktop LessonView wires this to the same
  /// workbench-state setter editor mode uses so toggling back to
  /// Editor shows the working solution the learner just placed —
  /// otherwise the editor would still show stale starter code,
  /// which is jarring when the learner just earned the win in
  /// blocks mode. Mobile doesn't surface an editor so it can
  /// safely ignore this.
  onSolutionAccepted?: (files: import("../../data/types").WorkbenchFile[]) => void;
  /// Mirror of the editor's mode toggle — surfaced inside the
  /// blocks header so a learner who solved (or got stuck) in blocks
  /// can flip to the free-form editor without scrolling out of the
  /// workbench. Mobile leaves this undefined; the toggle never
  /// renders there.
  exerciseMode?: "editor" | "blocks";
  onExerciseModeChange?: (mode: "editor" | "blocks") => void;
}

/// Map from slot id → currently-placed block id (or undefined if
/// empty). The whole component's interactive state.
type Placements = Record<string, string | undefined>;

/// Drag-source ids used by @dnd-kit. Two namespaces: blocks in the
/// pool ("pool-<blockId>") and blocks already placed in a slot
/// ("placed-<slotId>"). Keeping them distinct lets the drop-end
/// handler know whether the source is "freshly grabbed from the
/// tray" or "lifted out of an existing slot" without an extra
/// lookup. Drop targets follow the same convention with a "slot-"
/// or "pool" prefix.
const DRAG_FROM_POOL = "pool-";
const DRAG_FROM_SLOT = "placed-";
const DROP_SLOT_PREFIX = "slot-";
const DROP_POOL = "pool-zone";

/// Shuffle a copy of `blocks` deterministically per `seed`. We seed
/// off the lesson id + a stable session salt so two retries on the
/// same lesson don't show pool order in the same visual sequence
/// (forces the learner to actually identify each block, not just
/// memorise positions). Mulberry32 — small, deterministic, fast.
function shuffleBlocks(blocks: Block[], seed: string): Block[] {
  const out = blocks.slice();
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  const rand = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function BlocksView({
  lesson,
  storageKey,
  onComplete,
  onSolutionAccepted,
  exerciseMode,
  onExerciseModeChange,
}: Props) {
  const blocks = lesson.blocks;
  // Pure guard — if a lesson without blocks data hits this view, we
  // surface a clear in-place error rather than crashing. The desktop
  // toggle and mobile dispatch both gate on `lesson.blocks` being
  // present; this is a defense-in-depth message.
  if (!blocks) {
    return (
      <div className="libre-blocks libre-blocks--error">
        <p>This exercise hasn't been authored for blocks mode yet.</p>
      </div>
    );
  }

  return (
    <BlocksViewInner
      lesson={lesson}
      blocks={blocks}
      storageKey={storageKey}
      onComplete={onComplete}
      onSolutionAccepted={onSolutionAccepted}
      exerciseMode={exerciseMode}
      onExerciseModeChange={onExerciseModeChange}
    />
  );
}

interface InnerProps extends Props {
  blocks: BlocksData;
}

function BlocksViewInner({
  lesson,
  blocks,
  storageKey,
  onComplete,
  onSolutionAccepted,
  exerciseMode,
  onExerciseModeChange,
}: InnerProps) {
  const persistKey = `fb:blocks:${storageKey ?? lesson.id}`;
  const [placements, setPlacements] = useState<Placements>(() => {
    // Persist the in-progress placements per lesson so the learner
    // doesn't lose work on a hot-reload or a quick tab switch.
    // localStorage is cheap; we only key on lesson id so unrelated
    // lessons don't collide. Reset is explicit (the Reset button
    // clears it).
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed as Placements;
      }
    } catch {
      /* localStorage disabled / corrupt — fall through to empty */
    }
    return {};
  });

  // Pool order is stable per (lesson id) — shuffling once per mount
  // means the same lesson re-shuffles only on a fresh visit, not on
  // every render. The shuffle is deterministic per seed, so HMR
  // doesn't surprise the learner with a different layout mid-play.
  const shuffledPool = useMemo(
    () => shuffleBlocks(blocks.pool, lesson.id),
    [blocks.pool, lesson.id],
  );

  // Which block ids are "in the pool" vs "in a slot" right now —
  // derived state. Computed each render; cheap (O(blocks)).
  const placedBlockIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of Object.values(placements)) if (id) set.add(id);
    return set;
  }, [placements]);

  // Tap-to-place state: when a learner taps a block in the pool, we
  // store its id here as the "armed" block. Tapping a slot then
  // places it. Tapping the same block again (or tapping outside)
  // clears the selection. Phones lean on this path because
  // drag-to-scroll vs drag-to-place ambiguity is unpleasant.
  const [armedBlockId, setArmedBlockId] = useState<string | null>(null);

  // Active drag state — the id of the block currently being dragged
  // by the pointer. Used to render the DragOverlay (a floating
  // ghost) and to highlight valid drop targets. Null when no drag
  // is in progress.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  /// Briefly true after a successful verify so the wrapper can play a
  /// celebratory pulse animation. Auto-clears so the animation doesn't
  /// repeat on every re-render. Distinct from "tests passed" (which
  /// stays true for the rest of the session) — fanfare is a one-shot.
  const [justPassed, setJustPassed] = useState(false);
  /// Live announcement string for screen readers — describes the most
  /// recent placement / removal / verify outcome. The aria-live region
  /// reads it once when it changes.
  const [liveMessage, setLiveMessage] = useState("");
  const completedRef = useRef(false);

  // Persist placements whenever they change. Best-effort; if
  // localStorage throws (Safari private mode quota, etc.) we just
  // skip — the in-memory state still works.
  const savePlacements = useCallback(
    (next: Placements) => {
      try {
        localStorage.setItem(persistKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [persistKey],
  );

  const updatePlacements = useCallback(
    (mut: (p: Placements) => Placements) => {
      setPlacements((prev) => {
        const next = mut(prev);
        savePlacements(next);
        return next;
      });
    },
    [savePlacements],
  );

  // Place `blockId` into `slotId`. If the slot already had a
  // placement, that block returns to the pool. If `blockId` was
  // already in another slot, that slot empties (we don't allow the
  // same block in two slots — every block has at most one home).
  const placeBlock = useCallback(
    (slotId: string, blockId: string) => {
      updatePlacements((prev) => {
        const next: Placements = { ...prev };
        // Remove blockId from any slot it currently occupies.
        for (const [k, v] of Object.entries(next)) {
          if (v === blockId) next[k] = undefined;
        }
        next[slotId] = blockId;
        return next;
      });
      setArmedBlockId(null);
      // ARIA live region update — gives screen-reader users feedback
      // matching what sighted users see (the chip moving into the
      // slot). Looking up the block by id rather than the user's
      // tap-target id keeps the announcement readable.
      const block = blocks.pool.find((b) => b.id === blockId);
      if (block) {
        setLiveMessage(`Placed "${block.code}" in ${slotId} slot.`);
      }
    },
    [updatePlacements, blocks.pool],
  );

  // Lift the block currently in `slotId` back to the pool.
  const clearSlot = useCallback(
    (slotId: string) => {
      updatePlacements((prev) => {
        if (!prev[slotId]) return prev;
        const next = { ...prev };
        next[slotId] = undefined;
        return next;
      });
      setLiveMessage(`Cleared the ${slotId} slot.`);
    },
    [updatePlacements],
  );

  const reset = useCallback(() => {
    updatePlacements(() => ({}));
    setResult(null);
    setArmedBlockId(null);
    completedRef.current = false;
  }, [updatePlacements]);

  // ── Tap interaction ──────────────────────────────────────────
  // The whole tap protocol funnels through these two handlers so
  // mobile + keyboard nav share the same logic.
  const handleBlockTap = useCallback(
    (blockId: string) => {
      // Tapping a placed block returns it to the pool.
      const placedSlot = Object.entries(placements).find(([, v]) => v === blockId);
      if (placedSlot) {
        clearSlot(placedSlot[0]);
        return;
      }
      // Toggle armed selection in the pool.
      setArmedBlockId((cur) => (cur === blockId ? null : blockId));
    },
    [placements, clearSlot],
  );

  const handleSlotTap = useCallback(
    (slotId: string) => {
      // If a block is armed, place it. Otherwise — if the slot is
      // already filled — return its block to the pool (tap-to-undo).
      if (armedBlockId) {
        placeBlock(slotId, armedBlockId);
        return;
      }
      if (placements[slotId]) {
        clearSlot(slotId);
      }
    },
    [armedBlockId, placeBlock, clearSlot, placements],
  );

  // ── Drag interaction ─────────────────────────────────────────
  const sensors = useSensors(
    // PointerSensor covers mouse + most touch devices; we still
    // register a TouchSensor explicitly so iOS gets the right
    // long-press activation delay (helps the user distinguish "I
    // want to scroll" from "I want to drag").
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
    setArmedBlockId(null);
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const activeId = String(e.active.id);
      const overId = e.over ? String(e.over.id) : null;
      setActiveDragId(null);
      if (!overId) return;

      // Resolve the dragged block's id (strip the namespace prefix).
      const blockId = activeId.startsWith(DRAG_FROM_POOL)
        ? activeId.slice(DRAG_FROM_POOL.length)
        : activeId.startsWith(DRAG_FROM_SLOT)
          ? placements[activeId.slice(DRAG_FROM_SLOT.length)]
          : null;
      if (!blockId) return;

      // Drop into a slot — fire a selection haptic so the snap
      // reads as a deliberate "I placed this" tactile event.
      // Selection is the right weight here: heavier than a tap
      // (this is a placement, not a press) but lighter than a
      // medium impact (the visual movement carries most of the
      // perceived weight already).
      if (overId.startsWith(DROP_SLOT_PREFIX)) {
        const targetSlotId = overId.slice(DROP_SLOT_PREFIX.length);
        void fireHaptic("selection");
        placeBlock(targetSlotId, blockId);
        return;
      }
      // Drop back into the pool — only meaningful if the block was
      // previously in a slot. Light impact since the block is
      // moving away from a placement (a "returning" action that
      // shouldn't feel as rewarding as a placement).
      if (overId === DROP_POOL && activeId.startsWith(DRAG_FROM_SLOT)) {
        void fireHaptic("impact-light");
        clearSlot(activeId.slice(DRAG_FROM_SLOT.length));
      }
    },
    [placements, placeBlock, clearSlot],
  );

  // ── Verification ─────────────────────────────────────────────
  const allPlaced = useMemo(() => isBlocksFullyPlaced(blocks, placements), [blocks, placements]);
  const allCorrect = useMemo(() => isBlocksAllCorrect(blocks, placements), [blocks, placements]);

  const verify = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      // Build the file set the runtime expects. Start from the
      // exercise's starter file shape (preserves multi-file
      // structure if present), then overwrite the targeted file's
      // content with the synthesised source from placements.
      const starterFiles = deriveStarterFiles(lesson);
      const targetFileName = blocks.fileName;
      const synthesised = assembleBlocksSource(blocks, placements);
      const files = starterFiles.map((f) =>
        targetFileName ? (f.name === targetFileName ? { ...f, content: synthesised } : f) : { ...f, content: synthesised },
      );
      // If the lesson explicitly named a file but we didn't find
      // it in starterFiles (unusual: blocks data references a file
      // the exercise doesn't have), append it so the runtime sees
      // SOMETHING runnable rather than silently dropping the user's
      // placements.
      if (targetFileName && !files.some((f) => f.name === targetFileName)) {
        files.push({
          name: targetFileName,
          language: starterFiles[0]?.language ?? "plaintext",
          content: synthesised,
        });
      }

      // ── Structural fast-path ────────────────────────────────
      // If every slot has its canonical block, the assembled
      // source is byte-identical to the lesson's reference
      // solution — which we already verified passes the test
      // suite at authoring time (apply-blocks.mjs runs a strict
      // round-trip equality check before writing each manual /
      // cached payload). Skip the runner and accept the pass
      // immediately. Two reasons to short-circuit:
      //   1. Some platforms can't run some languages — Zig has no
      //      in-browser/iOS compiler, for instance, so on mobile
      //      the runner would fail-by-environment even on a
      //      perfect solution.
      //   2. Instant feedback. Runner round-trips can take 1-3s
      //      on cold-start (WASM warmup, module init, harness
      //      bootstrap); for blocks-mode the user's intent is
      //      already fully expressed by their placements.
      // Non-canonical-but-still-valid arrangements still fall
      // through to the runner below — we only bypass when we
      // KNOW the answer matches the reference.
      if (allCorrect) {
        const r: RunResult = {
          logs: [],
          durationMs: 0,
          tests: blocks.slots.map((s) => ({ name: s.id, passed: true })),
        };
        setResult(r);
        onSolutionAccepted?.(files);
        setJustPassed(true);
        setLiveMessage(
          `All ${blocks.slots.length} block${
            blocks.slots.length === 1 ? "" : "s"
          } placed correctly. Lesson complete.`,
        );
        window.setTimeout(() => setJustPassed(false), 1600);
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete?.();
        }
        return;
      }

      const r = await runFiles(
        lesson.language,
        files,
        lesson.tests,
        undefined,
        lesson.id,
        // The "trade" harness has no code-runtime side (it just
        // mounts the API tester dock above the lesson). Strip it
        // here so we don't pass it into runFiles, whose harness
        // union is intentionally narrower (chain runtimes only).
        lesson.harness === "trade" ? undefined : lesson.harness,
      );
      setResult(r);
      // Lesson completion via runner: same criterion as editor
      // mode — the test suite passed. We deliberately accept a
      // non-canonical arrangement here; if a learner found an
      // alternate placement that compiles + passes tests, that's
      // still a correct answer (the structural fast-path above
      // already handled the canonical case).
      const passed =
        !!r.tests &&
        r.tests.length > 0 &&
        r.tests.every((t) => t.passed) &&
        !r.error;
      if (passed) {
        // Push the assembled files back to the parent so the
        // editor-mode workbench shows the working solution if the
        // learner toggles over. We do this on EVERY successful run
        // (not just the first), since a learner might pass once,
        // then re-arrange, then pass again with a different valid
        // placement — the editor should reflect the most recent
        // successful state, not the first one.
        onSolutionAccepted?.(files);
        // One-shot celebration. Removed after ~1.6s so re-runs that
        // pass again can re-trigger the animation.
        setJustPassed(true);
        setLiveMessage(
          `All ${r.tests?.length ?? 0} tests passed. Lesson complete.`,
        );
        window.setTimeout(() => setJustPassed(false), 1600);
      } else {
        const failed = r.tests?.filter((t) => !t.passed).length ?? 0;
        if (r.error) {
          setLiveMessage(`Compile error: ${r.error.slice(0, 120)}`);
        } else if (failed > 0) {
          setLiveMessage(
            `${failed} of ${r.tests?.length ?? 0} test${
              r.tests?.length === 1 ? "" : "s"
            } failed. Adjust placements and verify again.`,
          );
        } else {
          setLiveMessage("Run finished without test results.");
        }
      }
      if (passed && !completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
    } catch (err) {
      setResult({
        logs: [],
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  }, [lesson, blocks, placements, allCorrect, onComplete, onSolutionAccepted]);

  // ── Template + chip highlighting ─────────────────────────────
  // Run Shiki against the template once (with slot markers swapped
  // for sentinel identifiers so the highlighter sees a syntactically
  // coherent program), then post-process the token stream to lift
  // sentinels back to slot markers. Render the resulting 2D
  // (lines × tokens) structure as JSX — colour spans for code,
  // SlotZone for slot tokens. Each block's code chip is highlighted
  // separately and stored in a parallel map.
  const [highlightedLines, setHighlightedLines] = useState<RenderedLine[] | null>(null);
  const [chipTokens, setChipTokens] = useState<Map<string, RenderedToken[]>>(
    () => new Map(),
  );
  const language: LanguageId = lesson.language;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Template highlight first — shows the prose-shaped layout
      // ASAP. Then chips in a follow-up pass; chips are short so
      // they highlight quickly and the parallel `Promise.all` keeps
      // total time small.
      const lines = await highlightTemplate(blocks.template, language);
      if (cancelled) return;
      setHighlightedLines(lines);
      const entries = await Promise.all(
        blocks.pool.map(async (b) => {
          const tokens = await highlightChip(b.code, language);
          return [b.id, tokens] as const;
        }),
      );
      if (cancelled) return;
      setChipTokens(new Map(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [blocks.template, blocks.pool, language]);

  const blockById = useMemo(() => {
    const m = new Map<string, Block>();
    for (const b of blocks.pool) m.set(b.id, b);
    return m;
  }, [blocks.pool]);
  const slotById = useMemo(() => {
    const m = new Map<string, BlocksData["slots"][number]>();
    for (const s of blocks.slots) m.set(s.id, s);
    return m;
  }, [blocks.slots]);

  // Until the first highlight pass resolves, render the template as
  // plain text via the same line/token shape — keeps the layout
  // identical (no flash of unstyled then styled) and ensures the
  // slot zones are interactable from the very first paint.
  const renderedLines: RenderedLine[] =
    highlightedLines ??
    plainTokensFromTemplate(blocks.template);

  const activeBlock = activeDragId
    ? blockById.get(
        activeDragId.startsWith(DRAG_FROM_POOL)
          ? activeDragId.slice(DRAG_FROM_POOL.length)
          : activeDragId.startsWith(DRAG_FROM_SLOT)
            ? placements[activeDragId.slice(DRAG_FROM_SLOT.length)] ?? ""
            : "",
      ) ?? null
    : null;

  // The interactive content (template + pool + verify controls)
  // lives in the Workbench's editor slot; the OutputPane lives in
  // its output slot. Sharing storage keys with editor mode means
  // the persisted height-split + width carry over across the
  // toggle, so flipping Editor ↔ Blocks doesn't reflow the
  // workbench container. Long templates scroll inside the editor
  // slot rather than expanding the parent.
  const blocksTopHalf = (
    <div
      className={
        "libre-blocks" + (justPassed ? " libre-blocks--passed" : "")
      }
    >
        {/* Off-screen polite live region for screen-reader feedback.
            React updates the text whenever a placement, removal, or
            verify outcome happens, and assistive tech announces it
            without stealing focus or interrupting the learner. */}
        <span className="libre-blocks__sr-live" role="status" aria-live="polite">
          {liveMessage}
        </span>
        {/* Header bar — same chrome as EditorPane's header
            (bg-secondary + border-bottom) so switching modes feels
            visually contained. Only the Editor/Blocks toggle lives
            here now; the optional prompt narration moves to its own
            line below the header so the row stays a single horizontal
            control strip rather than a wrap-prone toggle+prose mix.
            Hidden when neither the toggle nor a prompt would render
            (lessons without blocks data + non-desktop callers without
            mode wiring). */}
        {onExerciseModeChange && (
          <div className="libre-blocks__header">
            {exerciseMode && (
              <div
                className="libre-blocks__mode"
                role="group"
                aria-label="Exercise mode"
              >
                <button
                  type="button"
                  className={
                    "libre-blocks__mode-btn" +
                    (exerciseMode === "editor"
                      ? " libre-blocks__mode-btn--active"
                      : "")
                  }
                  onClick={() => onExerciseModeChange("editor")}
                  aria-pressed={exerciseMode === "editor"}
                >
                  Editor
                </button>
                <button
                  type="button"
                  className={
                    "libre-blocks__mode-btn" +
                    (exerciseMode === "blocks"
                      ? " libre-blocks__mode-btn--active"
                      : "")
                  }
                  onClick={() => onExerciseModeChange("blocks")}
                  aria-pressed={exerciseMode === "blocks"}
                >
                  Blocks
                </button>
              </div>
            )}
          </div>
        )}
        {/* Prompt narration sits on its own line below the header
            bar — frees the header row to stay a single-line control
            strip even when the prompt is long, and gives the prose
            comfortable horizontal space without competing with the
            toggle's right edge. */}
        {blocks.prompt && (
          <p className="libre-blocks__prompt">{blocks.prompt}</p>
        )}

        <pre className="libre-blocks__template shiki" aria-label="Code template">
          {renderedLines.map((line, lineIdx) => (
            <span key={lineIdx} className="libre-blocks__line">
              {line.map((tok, tokIdx) =>
                tok.kind === "slot" ? (
                  <SlotZone
                    key={tokIdx}
                    slotId={tok.slotId}
                    hint={slotById.get(tok.slotId)?.hint}
                    placedBlock={
                      placements[tok.slotId]
                        ? blockById.get(placements[tok.slotId]!) ?? null
                        : null
                    }
                    placedBlockTokens={
                      placements[tok.slotId]
                        ? chipTokens.get(placements[tok.slotId]!) ?? null
                        : null
                    }
                    expectedBlockId={slotById.get(tok.slotId)?.expectedBlockId}
                    allowFeedback={!!result}
                    onTap={() => handleSlotTap(tok.slotId)}
                    lessonTitle={lesson.title}
                  />
                ) : (
                  <span
                    key={tokIdx}
                    style={tok.color ? { color: tok.color } : undefined}
                  >
                    {tok.content}
                  </span>
                ),
              )}
              {/* Preserve the trailing newline between lines so
                  `pre`'s whitespace handling reproduces the original
                  indentation faithfully. */}
              {lineIdx < renderedLines.length - 1 ? "\n" : null}
            </span>
          ))}
        </pre>

        <PoolZone>
          <div className="libre-blocks__pool-row" role="list" aria-label="Block tray">
            {shuffledPool.map((b) =>
              placedBlockIds.has(b.id) ? null : (
                <BlockChip
                  key={b.id}
                  block={b}
                  source="pool"
                  tokens={chipTokens.get(b.id) ?? null}
                  armed={armedBlockId === b.id}
                  onTap={() => handleBlockTap(b.id)}
                  lessonTitle={lesson.title}
                />
              ),
            )}
            {shuffledPool.every((b) => placedBlockIds.has(b.id)) && (
              <span className="libre-blocks__pool-empty">All blocks placed.</span>
            )}
          </div>
        </PoolZone>

        <div className="libre-blocks__controls">
          <button
            type="button"
            className="libre-blocks__verify"
            onClick={() => void verify()}
            disabled={!allPlaced || running}
            aria-disabled={!allPlaced || running}
            title={
              allPlaced
                ? "Compile + run tests against your placements"
                : "Place every block before verifying"
            }
          >
            {running ? "Verifying…" : "Verify"}
          </button>
          <button
            type="button"
            className="libre-blocks__reset"
            onClick={reset}
            disabled={running}
          >
            Reset
          </button>
          {allPlaced && !result && (
            <span
              className={
                "libre-blocks__answerkey " +
                (allCorrect
                  ? "libre-blocks__answerkey--ok"
                  : "libre-blocks__answerkey--maybe")
              }
              aria-live="polite"
            >
              {allCorrect
                ? "Looks right — hit Verify to confirm."
                : "Ready when you are — Verify to check."}
            </span>
          )}
        </div>

    </div>
  );

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* On mobile, swap `widthControlsParent` for `fillWidth`. The
          desktop branch tells the Workbench to drive its parent's
          inline width to a percentage (so the user can drag-resize the
          workbench against the prose pane), but on mobile that ends up
          stamping `width: 48%` onto `.m-lesson__body` — collapsing the
          whole blocks experience into half the screen. `fillWidth`
          lets the Workbench claim 100%, and the matching mobile CSS
          override on `.libre-workbench` drops the floating-card
          chrome so it reads as edge-to-edge content. */}
      <Workbench
        widthControlsParent={!isMobile}
        fillWidth={isMobile}
        editor={blocksTopHalf}
        output={
          <OutputPane
            result={result}
            running={running}
            language={lesson.language}
            testsExpected={!!lesson.tests}
            testSource={lesson.tests}
          />
        }
      />

      <DragOverlay>
        {activeBlock ? (
          <div
            className={
              "libre-blocks__chip libre-blocks__chip--ghost" +
              // When dragging from a slot, the source chip has zero
              // padding + transparent background (`--placed` style).
              // Without matching the ghost to that, the overlay renders
              // a wider boxed chip and sits offset from where the
              // source actually was — reads as "the drag preview is
              // misaligned from the cursor." Match the variant so the
              // visual size stays identical to the source.
              (activeDragId?.startsWith(DRAG_FROM_SLOT)
                ? " libre-blocks__chip--placed"
                : "")
            }
          >
            <code>
              <ChipCode
                code={activeBlock.code}
                tokens={chipTokens.get(activeBlock.id) ?? null}
              />
            </code>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/// Render a chip's code as Shiki-coloured tokens when available,
/// falling back to plain text while the highlighter resolves. Pure
/// — no hooks, no events.
function ChipCode({
  code,
  tokens,
}: {
  code: string;
  tokens: RenderedToken[] | null;
}) {
  if (!tokens) return <>{code}</>;
  return (
    <>
      {tokens.map((tok, i) =>
        tok.kind === "text" ? (
          <span key={i} style={tok.color ? { color: tok.color } : undefined}>
            {tok.content}
          </span>
        ) : null,
      )}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

interface SlotZoneProps {
  slotId: string;
  hint?: string;
  placedBlock: Block | null;
  /// Pre-highlighted tokens for the placed block's code. Lets the
  /// chip render with the same syntax colours as the surrounding
  /// template, so a placed chip reads as continuous code. Null
  /// while highlighting is in flight (we render plain text fallback
  /// in that window).
  placedBlockTokens: RenderedToken[] | null;
  expectedBlockId?: string;
  /// Whether to colour-code right vs wrong placements. We only
  /// reveal the answer-key colouring AFTER the learner has clicked
  /// Verify at least once — otherwise the green outlines turn the
  /// puzzle into a hot/cold guessing game instead of a thinking
  /// exercise.
  allowFeedback: boolean;
  onTap: () => void;
  /// Forwarded to `DraggablePlacedBlock` for the hover-tooltip
  /// affordance — same lesson-title text the pool chips carry.
  lessonTitle: string;
}

function SlotZone({
  slotId,
  hint,
  placedBlock,
  placedBlockTokens,
  expectedBlockId,
  allowFeedback,
  onTap,
  lessonTitle,
}: SlotZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_SLOT_PREFIX + slotId });
  const filled = !!placedBlock;
  const correct = allowFeedback && filled && placedBlock!.id === expectedBlockId;
  const wrong = allowFeedback && filled && placedBlock!.id !== expectedBlockId;
  return (
    <span
      ref={setNodeRef}
      className={
        "libre-blocks__slot" +
        (filled ? " libre-blocks__slot--filled" : " libre-blocks__slot--empty") +
        (isOver ? " libre-blocks__slot--over" : "") +
        (correct ? " libre-blocks__slot--correct" : "") +
        (wrong ? " libre-blocks__slot--wrong" : "")
      }
      role="button"
      tabIndex={0}
      aria-label={
        filled
          ? `Filled slot. Block: ${placedBlock!.code}. Tap to remove.`
          : `Empty slot${hint ? `, expecting ${hint}` : ""}. Tap to place the selected block.`
      }
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap();
        }
      }}
    >
      {filled ? (
        <DraggablePlacedBlock
          slotId={slotId}
          block={placedBlock!}
          tokens={placedBlockTokens}
          lessonTitle={lessonTitle}
        />
      ) : (
        <span className="libre-blocks__slot-placeholder">{hint ?? "block"}</span>
      )}
    </span>
  );
}

interface BlockChipProps {
  block: Block;
  source: "pool" | "slot";
  /// Pre-highlighted tokens for the chip's code. Null while the
  /// highlighter resolves; we fall back to plain text in that
  /// window (the chip is still draggable + tappable, just monochrome
  /// until the colours land — usually a frame or two).
  tokens: RenderedToken[] | null;
  /// Tap-to-place "armed" state — the block has been tapped once
  /// and is waiting for a slot tap. Cosmetic ring; the actual
  /// place-on-slot logic lives in `handleSlotTap`.
  armed?: boolean;
  onTap?: () => void;
  /// Lesson title surfaced as the chip's hover-tooltip (`title`
  /// attribute) so a learner peeking at a block in the pool or
  /// in a slot gets a reminder of which lesson the block belongs
  /// to. The chip's `code` content is already on the visible
  /// face; the tooltip carries lesson context that the chip
  /// itself doesn't have room for.
  lessonTitle: string;
}

function BlockChip({
  block,
  source,
  tokens,
  armed,
  onTap,
  lessonTitle,
}: BlockChipProps) {
  const dragId = (source === "pool" ? DRAG_FROM_POOL : DRAG_FROM_SLOT) + block.id;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
  });
  return (
    <span
      ref={setNodeRef}
      // `transform` is undefined when the chip is at rest. dnd-kit's
      // util writes the right CSS transform string when present.
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0 : undefined,
      }}
      {...attributes}
      {...listeners}
      className={
        "libre-blocks__chip" +
        (armed ? " libre-blocks__chip--armed" : "") +
        (isDragging ? " libre-blocks__chip--dragging" : "")
      }
      role="listitem"
      aria-label={`Block: ${block.code}. Drag to a slot, or tap to select.`}
      // Native browser tooltip with the lesson title. Cheap UX hint
      // — fires on a brief hover hold, costs nothing on touch
      // devices (where it's just ignored). The screen-reader path
      // is already covered by `aria-label` above.
      title={lessonTitle}
      onClick={(e) => {
        // We ALSO listen for taps via the dnd-kit listeners; clicks
        // come through after a drag-cancel or a click-without-drag.
        // Stop propagation so the parent pool/template click handler
        // (used to deselect) doesn't immediately clear the armed
        // state we just set.
        e.stopPropagation();
        onTap?.();
      }}
    >
      <code>
        <ChipCode code={block.code} tokens={tokens} />
      </code>
    </span>
  );
}

/// Wrapper around a placed block that re-uses BlockChip's draggable
/// behaviour but rooted at "placed-<slotId>" instead of "pool-<id>".
/// Pulled out so the slot-zone JSX stays readable.
function DraggablePlacedBlock({
  slotId,
  block,
  tokens,
  lessonTitle,
}: {
  slotId: string;
  block: Block;
  tokens: RenderedToken[] | null;
  /// Same lesson-title hover tooltip the pool chips carry — keeps
  /// the affordance consistent whether the block is sitting in
  /// the pool or has been placed into a slot.
  lessonTitle: string;
}) {
  const dragId = DRAG_FROM_SLOT + slotId;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
  });
  return (
    <span
      ref={setNodeRef}
      className={
        "libre-blocks__chip libre-blocks__chip--placed" +
        (isDragging ? " libre-blocks__chip--dragging" : "")
      }
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0 : undefined,
      }}
      title={lessonTitle}
      {...attributes}
      {...listeners}
    >
      <code>
        <ChipCode code={block.code} tokens={tokens} />
      </code>
    </span>
  );
}

/// Drop zone for the pool. Lets a learner drag a placed block back
/// to the tray (instead of having to tap the slot to clear it).
function PoolZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_POOL });
  return (
    <div
      ref={setNodeRef}
      className={"libre-blocks__pool" + (isOver ? " libre-blocks__pool--over" : "")}
    >
      {children}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

/// Synchronous, no-Shiki fallback used until the async highlight
/// effect resolves. Returns the same `RenderedLine[]` shape Shiki's
/// highlighter does — line-split, with each line containing text
/// tokens (no colour) and slot tokens for `__SLOT_<id>__` markers.
/// Keeps the layout stable across the swap from "no highlighting yet"
/// to "Shiki has finished" — both stages have identical line breaks
/// and slot positions, so nothing reflows when the colours land.
function plainTokensFromTemplate(template: string): RenderedLine[] {
  return template.split("\n").map((rawLine) => {
    const line: RenderedToken[] = [];
    const re = /__SLOT_([A-Za-z0-9_-]+)__/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawLine)) !== null) {
      if (m.index > last) {
        line.push({ kind: "text", content: rawLine.slice(last, m.index) });
      }
      line.push({ kind: "slot", slotId: m[1] });
      last = m.index + m[0].length;
    }
    if (last < rawLine.length) {
      line.push({ kind: "text", content: rawLine.slice(last) });
    }
    return line;
  });
}
