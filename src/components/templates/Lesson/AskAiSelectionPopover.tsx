/// Inline "Ask AI" — the floating chip that appears when the
/// learner selects text inside the lesson body.
///
/// Select a sentence about borrowing in The Rust Programming
/// Language → a small "Ask AI" chip floats above the selection →
/// click → the AI panel opens with the passage as grounded
/// context (the `libre:ask-ai` event carries the selection +
/// lesson coordinates; AiAssistant adds course retrieval on top).
///
/// Mechanics:
///   - Listens to `selectionchange` (rAF-debounced — the event
///     fires per caret move).
///   - Only reacts when the selection is non-collapsed, has
///     meaningful length, and lives entirely inside
///     `.libre-reader-body` (selections in the sidebar, console,
///     or chrome shouldn't summon the chip).
///   - Positions `position: fixed` from the selection's bounding
///     rect, clamped to the viewport so it never renders
///     off-screen near the edges.
///   - Click dispatches the event and collapses the selection
///     (which also hides the chip via the next selectionchange).
///
/// Render-anywhere: the chip is fixed-position, so the component
/// mounts at the end of LessonReader without affecting layout.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import "@base/primitives/icon/icon.css";
import "./AskAiSelectionPopover.css";

interface Props {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
}

/// Selections shorter than this are almost always accidental
/// double-clicks on a single word — the chip would be noise.
const MIN_SELECTION_CHARS = 8;
/// Cap what we ship in the event — a select-all on a long chapter
/// shouldn't stuff 30k chars into the prompt pipeline (the
/// context engine would truncate anyway; trimming here keeps the
/// event payload sane).
const MAX_SELECTION_CHARS = 2_000;

export default function AskAiSelectionPopover({
  courseId,
  lessonId,
  lessonTitle,
}: Props) {
  const [chip, setChip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const evaluate = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setChip(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < MIN_SELECTION_CHARS) {
        setChip(null);
        return;
      }
      // Both endpoints must be inside the lesson body.
      const range = sel.getRangeAt(0);
      const anchorEl =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      if (!anchorEl?.closest(".libre-reader-body")) {
        setChip(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setChip(null);
        return;
      }
      // Centre above the selection; clamp into the viewport with
      // a small margin so the chip stays reachable near edges.
      const x = Math.min(
        Math.max(rect.left + rect.width / 2, 60),
        window.innerWidth - 60,
      );
      const y = Math.max(rect.top - 10, 16);
      setChip({ x, y, text: text.slice(0, MAX_SELECTION_CHARS) });
    };
    const onSelectionChange = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(evaluate);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (!chip) return null;

  return (
    <button
      type="button"
      className="libre-ask-selection-chip"
      style={{ left: chip.x, top: chip.y }}
      // mousedown (not click): fire BEFORE the browser collapses
      // the selection on mouse-up-outside-selection, and prevent
      // default so the selection survives until we've read it.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("libre:ask-ai", {
            detail: {
              kind: "selection",
              text: chip.text,
              courseId,
              lessonId,
              lessonTitle,
            },
          }),
        );
        // Collapse the selection — the next selectionchange hides
        // the chip.
        window.getSelection()?.removeAllRanges();
        setChip(null);
      }}
      aria-label={`Ask AI about the selected text from ${lessonTitle}`}
    >
      <span className="libre-ask-selection-chip-spark" aria-hidden>
        <Icon icon={sparkles} size="xs" color="currentColor" />
      </span>
      Ask AI
    </button>
  );
}
