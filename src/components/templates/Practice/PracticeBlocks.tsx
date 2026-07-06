/// Lightweight blocks-grading widget for Practice sessions.
///
/// Reuses the same `@dnd-kit` drag pipeline AND Shiki highlighter
/// the lesson `<BlocksView>` uses, so a learner reviewing a blocks
/// puzzle in Practice gets the SAME interaction model + visual
/// chrome they had in the lesson workbench:
///
///   - Drag a chip from the pool tray into a slot in the template.
///   - Drag a placed chip back to the pool to clear that slot.
///   - Drag a chip directly from one slot to another to swap.
///   - Tap-to-arm + tap-to-place still works as a fallback for
///     cases where drag is awkward (e.g. trackpad-less iPad).
///   - Coloured tokens via Shiki's github-dark theme; chips and
///     template share the canonical `#0d1117` canvas.
///
/// What's smaller than `<BlocksView>`:
///   - No compile/run pipeline. Practice grades structurally via
///     `isBlocksAllCorrect` (every slot got its expected block).
///     The lesson view's "compile + run tests" step is too slow
///     for review-mode and unavailable on mobile for some langs.
///   - No multi-file workbench tabs. One template, one pool.
///   - No keyboard sensor / live region — review mode keeps the
///     a11y surface minimal; the lesson view is the canonical
///     "place blocks via keyboard" surface.
///
/// Drag id namespace (mirrors BlocksView):
///   pool-<blockId>     — chip lifted from the pool tray
///   placed-<slotId>    — chip lifted out of an existing slot
///   slot-<slotId>      — drop target for the named slot
///   pool-zone          — drop target for "back to the tray"

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
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
  type Block,
  type BlocksData,
  type LanguageId,
  isBlocksAllCorrect,
  isBlocksFullyPlaced,
} from "@/data/types";
import {
  highlightChip,
  highlightTemplate,
  type RenderedLine,
  type RenderedToken,
} from "@/components/organisms/Blocks/highlight";
import { useT } from "@/i18n/i18n";
import "./PracticeBlocks.css";

interface Props {
  /// The blocks payload. Comes off the harvested `PracticeItem`.
  blocks: BlocksData;
  /// Language for syntax highlighting. Falls back to plain text
  /// when undefined (legacy items / docs-only courses).
  language?: LanguageId;
  /// Stable id used for the deterministic pool shuffle AND for
  /// keying child components — guarantees a fresh component tree
  /// on item navigation, so placements from the previous item
  /// don't leak.
  itemId: string;
  /// Whether the parent has already committed the answer (we lock
  /// the UI after a check so the learner can study what they did).
  committed?: boolean;
  /// Pre-committed result so the parent's "next item" preview can
  /// render the locked state before hand-off. Optional.
  result?: "correct" | "wrong";
  /// Called once when the learner clicks Check. The parent runs
  /// this through the scheduler and updates session state.
  onResult: (correct: boolean) => void;
}

type Placements = Record<string, string | undefined>;

const DRAG_FROM_POOL = "pool-";
const DRAG_FROM_SLOT = "placed-";
const DROP_SLOT_PREFIX = "slot-";
const DROP_POOL = "pool-zone";

export default function PracticeBlocks({
  blocks,
  language,
  itemId,
  committed = false,
  result,
  onResult,
}: Props) {
  const t = useT();
  // Slot id → block id (or undefined if empty).
  const [placements, setPlacements] = useState<Placements>({});
  // Tap-to-place "armed" block id. Cleared on drag start.
  const [armed, setArmed] = useState<string | null>(null);
  // Currently-dragging draggable id (null when nothing is in
  // flight). Drives the `<DragOverlay>` floating chip.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Highlighted template + per-chip token streams. Both are async
  // (Shiki has to load the grammar). Until they resolve we render a
  // plain-text fallback so the puzzle is still playable. Keyed off
  // `itemId` so navigating between items forces a fresh pass.
  const [highlightedLines, setHighlightedLines] = useState<
    RenderedLine[] | null
  >(null);
  const [chipTokens, setChipTokens] = useState<Map<string, RenderedToken[]>>(
    () => new Map(),
  );

  useEffect(() => {
    setPlacements({});
    setArmed(null);
    setActiveDragId(null);
  }, [itemId]);

  useEffect(() => {
    let cancelled = false;
    if (!language) {
      setHighlightedLines(plainTokensFromTemplate(blocks.template));
      setChipTokens(
        new Map(
          blocks.pool.map((b) => [
            b.id,
            [{ kind: "text" as const, content: b.code }],
          ]),
        ),
      );
      return;
    }
    void (async () => {
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

  // Deterministic pool shuffle keyed by item id — predictable
  // visual order across re-mounts, same convention as BlocksView.
  const shuffledPool = useMemo(
    () => shuffle(blocks.pool, itemId),
    [blocks.pool, itemId],
  );

  // ---------- Pure mutators (used by both drag + tap paths) ---------

  function placeBlockInSlot(slotId: string, blockId: string) {
    setPlacements((prev) => {
      const next = { ...prev };
      // A block can only live in one slot — clear any existing
      // home for this block before assigning the new slot.
      for (const [sid, bid] of Object.entries(next)) {
        if (bid === blockId) next[sid] = undefined;
      }
      next[slotId] = blockId;
      return next;
    });
    setArmed(null);
  }

  function clearSlot(slotId: string) {
    setPlacements((prev) => {
      if (!prev[slotId]) return prev;
      const next = { ...prev };
      next[slotId] = undefined;
      return next;
    });
  }

  // ---------- DnD wiring ----------

  const sensors = useSensors(
    // PointerSensor with a small distance threshold lets clicks
    // through (so tap-to-arm still works) but starts a drag once
    // the user actually moves the cursor.
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    // TouchSensor with a delay distinguishes "I want to scroll"
    // from "I want to drag" on iOS — same numbers BlocksView ships.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
  );

  function onDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
    setArmed(null);
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    setActiveDragId(null);
    if (!overId) return;

    // Resolve the dragged block's id (strip the namespace prefix).
    let blockId: string | undefined;
    if (activeId.startsWith(DRAG_FROM_POOL)) {
      blockId = activeId.slice(DRAG_FROM_POOL.length);
    } else if (activeId.startsWith(DRAG_FROM_SLOT)) {
      blockId = placements[activeId.slice(DRAG_FROM_SLOT.length)];
    }
    if (!blockId) return;

    // Drop into a slot.
    if (overId.startsWith(DROP_SLOT_PREFIX)) {
      const targetSlotId = overId.slice(DROP_SLOT_PREFIX.length);
      placeBlockInSlot(targetSlotId, blockId);
      return;
    }
    // Drop into the pool zone — only meaningful if the chip came
    // FROM a slot (it's already in the pool otherwise).
    if (overId === DROP_POOL && activeId.startsWith(DRAG_FROM_SLOT)) {
      clearSlot(activeId.slice(DRAG_FROM_SLOT.length));
    }
  }

  // ---------- Tap-to-place fallback ----------

  function handleSlotTap(slotId: string) {
    if (committed) return;
    if (armed) {
      placeBlockInSlot(slotId, armed);
      return;
    }
    if (placements[slotId]) {
      // Tap a filled slot with nothing armed → clear.
      clearSlot(slotId);
    }
  }

  function handlePoolTap(blockId: string) {
    if (committed) return;
    if (placedBlockIds.has(blockId)) {
      // Tap a placed block → return to pool.
      setPlacements((prev) => {
        const next = { ...prev };
        for (const [sid, bid] of Object.entries(next)) {
          if (bid === blockId) next[sid] = undefined;
        }
        return next;
      });
      setArmed(null);
      return;
    }
    setArmed((cur) => (cur === blockId ? null : blockId));
  }

  // ---------- Derived state ----------

  const placedBlockIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of Object.values(placements)) if (b) s.add(b);
    return s;
  }, [placements]);

  const blockById = useMemo(
    () => new Map(blocks.pool.map((b) => [b.id, b])),
    [blocks.pool],
  );

  const slotById = useMemo(
    () => new Map(blocks.slots.map((s) => [s.id, s])),
    [blocks.slots],
  );

  const allPlaced = isBlocksFullyPlaced(blocks, placements);

  function check() {
    if (!allPlaced || committed) return;
    onResult(isBlocksAllCorrect(blocks, placements));
  }

  // Plain-text fallback while highlighting resolves — keeps the
  // layout stable so slots are interactable from the first paint.
  const renderedLines: RenderedLine[] =
    highlightedLines ?? plainTokensFromTemplate(blocks.template);

  // Resolve the chip currently being dragged so DragOverlay can
  // render the floating ghost.
  const activeBlock: Block | null = activeDragId
    ? blockById.get(
        activeDragId.startsWith(DRAG_FROM_POOL)
          ? activeDragId.slice(DRAG_FROM_POOL.length)
          : activeDragId.startsWith(DRAG_FROM_SLOT)
            ? placements[activeDragId.slice(DRAG_FROM_SLOT.length)] ?? ""
            : "",
      ) ?? null
    : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div
        className={"libre-practice-blocks" + (committed ? " is-committed" : "")}
      >
        {blocks.prompt && (
          <p className="libre-practice-blocks__prompt">{blocks.prompt}</p>
        )}

        <pre className="libre-practice-blocks__template">
          {renderedLines.map((line, lineIdx) => (
            <span key={lineIdx} className="libre-practice-blocks__line">
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
                    expectedBlockId={
                      slotById.get(tok.slotId)?.expectedBlockId
                    }
                    allowFeedback={committed}
                    disabled={committed}
                    onTap={() => handleSlotTap(tok.slotId)}
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
              {/* Preserve newline between lines so `pre`'s whitespace
                  handling reproduces the original indentation. */}
              {lineIdx < renderedLines.length - 1 ? "\n" : null}
            </span>
          ))}
        </pre>

        <PoolZone>
          {shuffledPool.map((b) =>
            placedBlockIds.has(b.id) ? null : (
              <BlockChip
                key={b.id}
                block={b}
                source="pool"
                tokens={chipTokens.get(b.id) ?? null}
                armed={armed === b.id}
                disabled={committed}
                onTap={() => handlePoolTap(b.id)}
              />
            ),
          )}
          {shuffledPool.every((b) => placedBlockIds.has(b.id)) && (
            <span className="libre-practice-blocks__pool-empty">
              {t("practice.allBlocksPlaced")}
            </span>
          )}
        </PoolZone>

        <div className="libre-practice-blocks__actions">
          <button
            type="button"
            className="libre-practice-blocks__check"
            onClick={check}
            disabled={!allPlaced || committed}
          >
            {committed
              ? result === "correct"
                ? t("practice.correct")
                : t("practice.notQuite")
              : allPlaced
                ? t("practice.check")
                : t("practice.fillEverySlot")}
          </button>
        </div>
      </div>

      <DragOverlay>
        {activeBlock ? (
          <div
            className={
              "libre-practice-blocks__chip libre-practice-blocks__chip--ghost" +
              (activeDragId?.startsWith(DRAG_FROM_SLOT)
                ? " libre-practice-blocks__chip--placed"
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

// ---------------------------------------------------------------------------
// SlotZone — inline drop target. Wraps the placed chip (if any) so a
// drag can ALSO start from the placed block via DraggablePlacedBlock.

interface SlotZoneProps {
  slotId: string;
  hint?: string;
  placedBlock: Block | null;
  placedBlockTokens: RenderedToken[] | null;
  expectedBlockId?: string;
  /// Reveal correct/wrong outline colours. Only true after the
  /// learner clicks Check; otherwise the puzzle degenerates into
  /// hot/cold guessing.
  allowFeedback: boolean;
  disabled: boolean;
  onTap: () => void;
}

function SlotZone({
  slotId,
  hint,
  placedBlock,
  placedBlockTokens,
  expectedBlockId,
  allowFeedback,
  disabled,
  onTap,
}: SlotZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: DROP_SLOT_PREFIX + slotId,
  });
  const filled = !!placedBlock;
  const correct =
    allowFeedback && filled && placedBlock!.id === expectedBlockId;
  const wrong =
    allowFeedback && filled && placedBlock!.id !== expectedBlockId;
  return (
    <span
      ref={setNodeRef}
      className={
        "libre-practice-blocks__slot" +
        (filled
          ? " libre-practice-blocks__slot--filled"
          : " libre-practice-blocks__slot--empty") +
        (isOver ? " libre-practice-blocks__slot--over" : "") +
        (correct ? " libre-practice-blocks__slot--correct" : "") +
        (wrong ? " libre-practice-blocks__slot--wrong" : "")
      }
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={
        filled
          ? `Filled slot. Block: ${placedBlock!.code}. Tap to remove.`
          : `Empty slot${hint ? `, expecting ${hint}` : ""}. Drag a chip here or tap to place the armed block.`
      }
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        onTap();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
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
          disabled={disabled}
        />
      ) : (
        <span className="libre-practice-blocks__slot-placeholder">
          {hint ?? "·"}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PoolZone — wraps the pool chip row in a droppable so a chip lifted
// from a slot can be dropped back to clear the slot. The droppable is
// the entire pool surface.

function PoolZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_POOL });
  return (
    <div
      ref={setNodeRef}
      className={
        "libre-practice-blocks__pool" +
        (isOver ? " libre-practice-blocks__pool--over" : "")
      }
      role="list"
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BlockChip — pool item. Draggable (`pool-<id>`) and tappable.

function BlockChip({
  block,
  source,
  tokens,
  armed,
  disabled,
  onTap,
}: {
  block: Block;
  source: "pool" | "slot";
  tokens: RenderedToken[] | null;
  armed: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  const dragId =
    (source === "pool" ? DRAG_FROM_POOL : DRAG_FROM_SLOT) + block.id;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: dragId, disabled });
  return (
    <span
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0 : undefined,
      }}
      {...attributes}
      {...listeners}
      className={
        "libre-practice-blocks__chip" +
        (armed ? " libre-practice-blocks__chip--armed" : "") +
        (isDragging ? " libre-practice-blocks__chip--dragging" : "") +
        (disabled ? " is-disabled" : "")
      }
      role="listitem"
      aria-label={`Block: ${block.code}. Drag to a slot, or tap to select.`}
      onClick={(e) => {
        // Tap-to-arm fallback. dnd-kit's PointerSensor activation
        // distance lets clicks-without-drag through; we stop
        // propagation so a parent click handler doesn't immediately
        // un-arm the block we just selected.
        e.stopPropagation();
        if (disabled) return;
        onTap();
      }}
    >
      <code>
        <ChipCode code={block.code} tokens={tokens} />
      </code>
    </span>
  );
}

// ---------------------------------------------------------------------------
// DraggablePlacedBlock — chip rendered inside a filled slot. Re-uses
// BlockChip's draggable behaviour but rooted at "placed-<slotId>" so
// onDragEnd can resolve the source slot.

function DraggablePlacedBlock({
  slotId,
  block,
  tokens,
  disabled,
}: {
  slotId: string;
  block: Block;
  tokens: RenderedToken[] | null;
  disabled: boolean;
}) {
  const dragId = DRAG_FROM_SLOT + slotId;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: dragId, disabled });
  return (
    <span
      ref={setNodeRef}
      className={
        "libre-practice-blocks__chip libre-practice-blocks__chip--placed" +
        (isDragging ? " libre-practice-blocks__chip--dragging" : "")
      }
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0 : undefined,
      }}
      {...attributes}
      {...listeners}
    >
      <code>
        <ChipCode code={block.code} tokens={tokens} />
      </code>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ChipCode — render a chip's code as Shiki-coloured tokens when
// available, falling back to plain text. Used by both the in-slot and
// in-pool chips, plus the DragOverlay ghost.

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
          <span
            key={i}
            style={tok.color ? { color: tok.color } : undefined}
          >
            {tok.content}
          </span>
        ) : null,
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Plain-text fallback. Used while the Shiki highlighter is loading
// AND when the item has no language. Same line/token shape so the
// renderer's hot path stays uniform.

function plainTokensFromTemplate(template: string): RenderedLine[] {
  return template.split("\n").map((line) => {
    const out: RenderedLine = [];
    const re = /__SLOT_([A-Za-z0-9_-]+)__/g;
    let last = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m.index > last) {
        out.push({ kind: "text", content: line.slice(last, m.index) });
      }
      out.push({ kind: "slot", slotId: m[1] });
      last = m.index + m[0].length;
    }
    if (last < line.length) {
      out.push({ kind: "text", content: line.slice(last) });
    }
    return out;
  });
}

function shuffle<T extends { id: string }>(
  arr: readonly T[],
  seed: string,
): T[] {
  const out = arr.slice();
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
