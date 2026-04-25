import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import type { Lesson, LessonEnrichment } from "../../data/types";
import { isExerciseKind } from "../../data/types";
import { Icon } from "@base/primitives/icon";
import { bookOpen } from "@base/primitives/icon/icons/book-open";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import { renderMarkdown } from "./markdown";
import LessonPopover, { type PopoverContent } from "./LessonPopover";
import InlineSandbox from "./InlineSandbox";
import "./LessonReader.css";

interface Props {
  lesson: Lesson;
  /// Rendered inside the reader's scroll column beneath the markdown body.
  /// Used to park the Prev/Next nav at the bottom of reading + exercise
  /// lessons so it participates in the same scroll surface as the prose.
  footer?: ReactNode;
  /// Kick off a single-lesson retry when the learner clicks the inline
  /// "Retry this exercise" button on a demoted lesson. Optional — if
  /// not provided, the button just doesn't render. Parent wires to
  /// `useIngestRun.startRetryLesson`.
  onRetryLesson?: (lessonId: string) => void;
}

/// Regex that detects the italic demotion note the ingest pipeline
/// appends to lessons it gave up trying to generate as exercises.
/// We use the presence of this note to render a "Retry this exercise"
/// button inline at the top of the body and — more importantly — to
/// strip the note from the rendered prose so the retry CTA stands in
/// for it instead of competing with it.
const DEMOTED_NOTE_RE =
  /\*\(This exercise was demoted to a reading lesson after[^)]*\)\*/gi;
const DEMOTED_REASON_RE =
  /\(This exercise was demoted to a reading lesson after 3 validation failures:\s*(.*?)\)/i;

/// Words-per-minute used for the "time to read" estimate. 225 is a
/// common middle-of-the-road number for skim-to-careful technical
/// reading. We round up at the end so short passages always show at
/// least "1 min read".
const READING_WPM = 225;

/// The top half of a lesson pane: prose rendered from the lesson's markdown
/// body, with fenced code blocks highlighted by Shiki. Also drives the
/// progress bar, objectives card, inline-sandbox hydration, popover
/// overlays, and glossary side panel.
export default function LessonReader({
  lesson,
  footer,
  onRetryLesson,
}: Props) {
  const [html, setHtml] = useState<string>("");

  // Detect demoted-exercise state so we can render the inline retry CTA.
  // The note appears in the body for every lesson the pipeline demoted;
  // we also extract the validation-failure reason to show in the
  // button's tooltip for context.
  const demotedReason = useMemo(() => {
    const body = lesson.body ?? "";
    const m = DEMOTED_REASON_RE.exec(body);
    if (!m) return null;
    return m[1].trim();
  }, [lesson.body]);

  // Reading metrics derived from the lesson body. Excludes code block
  // contents since they're not "reading time" in the same sense.
  const readingMinutes = useMemo(
    () => estimateReadingMinutes(lesson.body ?? ""),
    [lesson.body],
  );

  // Enrichment is optional — older lessons just don't show popovers /
  // glossary affordances.
  const enrichment: LessonEnrichment | undefined = lesson.enrichment;
  const objectives = lesson.objectives;
  const hasGlossary =
    !!enrichment?.glossary && enrichment.glossary.length > 0;

  // Primary language for inline sandboxes. Reading-only lessons fall back
  // to text (the sandbox fences shouldn't appear in reading lessons
  // anyway, but we still want a safe default for edge cases).
  const primaryLang = isExerciseKind(lesson) ? lesson.language : "plaintext";

  // Render markdown → HTML. Rerun on lesson change OR enrichment change
  // (enrichment may land after the body is rendered if the user kicks
  // off an enrich pass while the lesson is open).
  //
  // For demoted lessons we strip the italic pipeline-note from the
  // prose before rendering — the inline retry CTA replaces it. Leaving
  // the note in would just duplicate context the button already
  // communicates.
  useEffect(() => {
    let cancelled = false;
    let source = demotedReason
      ? (lesson.body ?? "").replace(DEMOTED_NOTE_RE, "").trim()
      : (lesson.body ?? "");
    // Strip a leading `# Title` that duplicates lesson.title — we render
    // the title as a dedicated header above the body. Match is tolerant
    // of minor casing / trailing-whitespace drift, not strict string
    // equality, because generator passes occasionally normalise titles.
    source = stripLeadingTitleHeading(source, lesson.title);
    renderMarkdown(source, { enrichment }).then((rendered) => {
      if (!cancelled) setHtml(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [lesson.body, enrichment, demotedReason, lesson.title]);

  // --- Scroll progress tracking ---------------------------------------

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0); // 0..1

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) {
        setProgress(1);
        return;
      }
      const p = Math.max(0, Math.min(1, el.scrollTop / max));
      setProgress(p);
    };
    handler();
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [html]);

  const minutesRemaining = Math.max(
    0,
    Math.ceil(readingMinutes * (1 - progress)),
  );

  // --- Popover anchor state -------------------------------------------
  //
  // `popoverCoords` is the (clientX, clientY) from the mouseover event
  // that first fired on a trigger. The popover renders near the cursor
  // rather than anchored to the element's bounding rect — simpler and
  // more reliable than element measurement across nested scroll parents.
  const [popoverCoords, setPopoverCoords] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [popoverContent, setPopoverContent] = useState<PopoverContent | null>(
    null,
  );
  // Shared pending-hide timer between the trigger handlers and the
  // popover's own enter/leave handlers. Hoisted out of the hydration
  // effect so the popover can cancel it when the cursor crosses from
  // trigger → popover, and re-arm it on mouseleave.
  const hideTimerRef = useRef<number | null>(null);
  // The trigger element the popover is currently attached to. We
  // consult this inside `show()` to dedupe repeated `mouseover` events
  // as the cursor moves WITHIN a trigger — `mouseover` bubbles from
  // child text nodes, so without this check each pixel of mouse
  // movement inside the trigger would re-set coords + rerender the
  // popover, producing a visible flash.
  const currentTriggerRef = useRef<HTMLElement | null>(null);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    // 140ms gives the cursor time to bridge the ~10px gap between
    // trigger and popover without the popover vanishing mid-jump. The
    // popover's own mouseenter cancels this timer; its mouseleave
    // re-arms it.
    hideTimerRef.current = window.setTimeout(() => {
      setPopoverCoords(null);
      setPopoverContent(null);
      currentTriggerRef.current = null;
      hideTimerRef.current = null;
    }, 140);
  }, [cancelHide]);

  // Lookup tables for quick hover handling. Rebuild on enrichment change.
  const symbolMap = useMemo(() => {
    const m = new Map<string, NonNullable<LessonEnrichment["symbols"]>[number]>();
    for (const s of enrichment?.symbols ?? []) {
      if (s.pattern) m.set(s.pattern, s);
    }
    return m;
  }, [enrichment]);

  const termMap = useMemo(() => {
    const m = new Map<string, NonNullable<LessonEnrichment["glossary"]>[number]>();
    for (const g of enrichment?.glossary ?? []) {
      if (g.term) m.set(g.term, g);
    }
    return m;
  }, [enrichment]);

  const openExternal = useCallback((url: string) => {
    invoke("plugin:opener|open_url", { url }).catch(() => {
      // Fallback for vite-dev / non-Tauri: plain window.open.
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* nothing we can do */
      }
    });
  }, []);

  // --- Hydration pass --------------------------------------------------
  // After dangerouslySetInnerHTML has rendered the markdown, walk the
  // produced DOM for our markers and attach behaviour:
  //   - `.fishbones-inline-sandbox` → mount an <InlineSandbox/> React tree
  //   - `.fishbones-inline-symbol` + `.fishbones-inline-term` → wire
  //     mouseenter/leave to drive popover state

  const rootsRef = useRef<Root[]>([]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // 1) Inline sandbox hydration — replace marker divs with a real
    //    React subtree using createRoot. We keep handles so we can
    //    unmount them cleanly on lesson change.
    const sandboxes = Array.from(
      container.querySelectorAll<HTMLDivElement>(".fishbones-inline-sandbox"),
    );
    const localRoots: Root[] = [];
    for (const el of sandboxes) {
      const lang = (el.dataset.fishbonesLang || primaryLang) as
        | typeof primaryLang
        | string;
      const b64 = el.dataset.fishbonesSrc ?? "";
      const src = decodeB64(b64);
      // Clear the container so we don't double-mount on fast re-renders.
      el.innerHTML = "";
      const root = createRoot(el);
      localRoots.push(root);
      // `lang` is a string from a DOM attribute — the sandbox component
      // validates it before running, so we can relax the TS cast here.
      root.render(
        <InlineSandbox
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          language={lang as any}
          initialCode={src}
        />,
      );
    }
    rootsRef.current = localRoots;

    // 2) Popover triggers — event delegation from the container so we
    //    add only one listener pair regardless of how many inline
    //    symbols / terms are in the prose. Timer + cancel/schedule
    //    helpers are hoisted on the component so the popover's own
    //    mouseenter/leave can participate.
    //
    //    Each hover captures the (clientX, clientY) from the event and
    //    feeds it into the popover as the coord to render near. No more
    //    element-rect measurement — the popover just appears next to
    //    the mouse, which is both reliable across nested scroll parents
    //    and the intuitive desktop tooltip behaviour.
    const show = (el: HTMLElement, mouseX: number, mouseY: number) => {
      cancelHide();
      // Dedup: if the mouse is still inside the same trigger as before,
      // don't re-set coords — re-rendering the popover on every pixel
      // of movement looks like a flash.
      if (currentTriggerRef.current === el) return;
      currentTriggerRef.current = el;
      if (el.classList.contains("fishbones-inline-symbol")) {
        const pattern = el.getAttribute("data-pattern") ?? "";
        const sym = symbolMap.get(pattern);
        if (!sym) return;
        setPopoverCoords({ x: mouseX, y: mouseY });
        setPopoverContent({
          kind: "symbol",
          heading: sym.pattern,
          signature: sym.signature,
          body: sym.description ?? "",
          docUrl: sym.docUrl,
        });
      } else if (el.classList.contains("fishbones-inline-term")) {
        const term = el.getAttribute("data-term") ?? "";
        const gloss = termMap.get(term);
        if (!gloss) return;
        setPopoverCoords({ x: mouseX, y: mouseY });
        setPopoverContent({
          kind: "term",
          heading: gloss.term,
          body: gloss.definition,
        });
      }
    };

    const onOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.(
        ".fishbones-inline-symbol, .fishbones-inline-term",
      ) as HTMLElement | null;
      if (target) show(target, e.clientX, e.clientY);
    };
    const onOut = (e: MouseEvent) => {
      // `relatedTarget` is the element the cursor entered. If it's
      // another trigger OR the popover itself, don't schedule a hide.
      const related = (e.relatedTarget as HTMLElement | null)?.closest?.(
        ".fishbones-inline-symbol, .fishbones-inline-term, .fishbones-popover",
      );
      const target = (e.target as HTMLElement | null)?.closest?.(
        ".fishbones-inline-symbol, .fishbones-inline-term",
      );
      if (target && !related) scheduleHide();
    };

    // 3) "Ask Fishbones" badges on code blocks. Click → fire a
    //    `fishbones:ask-ai` custom event up to the AiAssistant root
    //    listener. We use event delegation on the container so the
    //    handler count stays at 1 regardless of how many code blocks
    //    are in the prose. The badge carries the snippet as a
    //    base64-encoded data attribute (set by the markdown pipeline).
    const onAskClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.(
        ".fishbones-code-block-ask",
      ) as HTMLElement | null;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const code = decodeB64(target.dataset.fishbonesAskCode ?? "");
      const lang = target.dataset.fishbonesAskLang ?? "";
      window.dispatchEvent(
        new CustomEvent("fishbones:ask-ai", {
          detail: {
            kind: "code",
            language: lang,
            code,
            lessonTitle: lesson.title,
          },
        }),
      );
    };

    container.addEventListener("mouseover", onOver);
    container.addEventListener("mouseout", onOut);
    container.addEventListener("click", onAskClick);

    return () => {
      container.removeEventListener("mouseover", onOver);
      container.removeEventListener("mouseout", onOut);
      container.removeEventListener("click", onAskClick);
      // Unmount the sandbox React roots in a microtask so we don't
      // trigger React's "unmount during render" warning when this effect
      // runs alongside a parent render.
      const toUnmount = localRoots;
      queueMicrotask(() => {
        for (const r of toUnmount) {
          try {
            r.unmount();
          } catch {
            /* already unmounted */
          }
        }
      });
    };
  }, [html, symbolMap, termMap, primaryLang, cancelHide, scheduleHide, lesson.title]);

  // Dismiss when the lesson changes so a stale popover doesn't flash
  // on the new lesson's prose while the hover state settles.
  useEffect(() => {
    cancelHide();
    setPopoverCoords(null);
    setPopoverContent(null);
  }, [lesson.id, cancelHide]);

  // Dismiss on any scroll while the popover is open. The popover is
  // locked to its initial cursor position — if the user scrolls, the
  // trigger underneath moves but the popover doesn't, which quickly
  // reads as stale. Hide it instantly rather than waiting for the
  // 140ms debounced path.
  //
  // Also dismiss on mousedown outside the popover / trigger, so the
  // learner can click anywhere else in the app to tear it down
  // (selection in the prose, the workbench, the sidebar, etc.).
  useEffect(() => {
    if (!popoverContent) return;
    const dismiss = () => {
      cancelHide();
      setPopoverCoords(null);
      setPopoverContent(null);
      currentTriggerRef.current = null;
    };
    const onScroll = () => dismiss();
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Click inside the popover itself (e.g. on "View full docs →")
      // should NOT dismiss — that would cancel the navigation intent.
      if (t.closest(".fishbones-popover")) return;
      // Click on a trigger is handled by the hover flow — don't
      // interfere.
      if (t.closest(".fishbones-inline-symbol, .fishbones-inline-term")) {
        return;
      }
      dismiss();
    };
    // Capture:true so we catch the reader's internal scroll container
    // in addition to window-level scrolling.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [popoverContent, cancelHide]);

  // --- Glossary side panel --------------------------------------------

  const [glossaryOpen, setGlossaryOpen] = useState(false);

  return (
    <section className="fishbones-reader">
      {/* Progress rail pinned to the top of the reader. Stays visible
          while the prose scrolls underneath. */}
      <div className="fishbones-reader-progress" aria-hidden>
        <div
          className="fishbones-reader-progress-fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="fishbones-reader-scroll" ref={scrollRef}>
        <div className="fishbones-reader-inner">
          {/* Lesson title rendered above everything else so the learner
              always knows where they are — markdown bodies often repeat
              it as an h1 too, which we strip during render to avoid
              duplication. */}
          <h1 className="fishbones-reader-title">{lesson.title}</h1>

          {/* Top chip row: time-to-read + optional glossary toggle. Both
              live in the same row so the eye catches the meta info
              without eating much vertical space. */}
          <div className="fishbones-reader-meta">
            <div className="fishbones-reader-meta-time">
              {progress < 0.05
                ? `${readingMinutes} min read`
                : minutesRemaining === 0
                ? "almost done"
                : `${minutesRemaining} min left`}
            </div>
            {hasGlossary && (
              <button
                type="button"
                className={`fishbones-reader-meta-glossary ${
                  glossaryOpen ? "fishbones-reader-meta-glossary--open" : ""
                }`}
                onClick={() => setGlossaryOpen((v) => !v)}
              >
                <span className="fishbones-reader-meta-glossary-icon" aria-hidden>
                  <Icon icon={bookOpen} size="xs" color="currentColor" />
                </span>
                Glossary
                <span className="fishbones-reader-meta-glossary-count">
                  {enrichment!.glossary!.length}
                </span>
              </button>
            )}
          </div>

          {/* Demoted-exercise retry CTA. Only renders when the ingest
              pipeline gave up trying to generate this as an exercise
              (3 validation failures → demoted to a reading lesson) AND
              the parent passed an `onRetryLesson` handler. Replaces
              the italic demotion note that used to live in the body —
              we strip that out during render to avoid duplication. */}
          {demotedReason && onRetryLesson && (
            <div className="fishbones-reader-retry" role="note">
              <div className="fishbones-reader-retry-head">
                <span className="fishbones-reader-retry-label">
                  Exercise needs another pass
                </span>
              </div>
              <div className="fishbones-reader-retry-body">
                The generator couldn't build a working exercise for this
                lesson on the first run — it failed validation 3 times
                and demoted the lesson to a reading. Hit retry to run
                just this one lesson again with the latest prompt.
              </div>
              <div className="fishbones-reader-retry-reason" title={demotedReason}>
                <span className="fishbones-reader-retry-reason-label">
                  First failure
                </span>
                <span className="fishbones-reader-retry-reason-text">
                  {demotedReason.length > 160
                    ? demotedReason.slice(0, 160) + "…"
                    : demotedReason}
                </span>
              </div>
              <button
                type="button"
                className="fishbones-reader-retry-btn"
                onClick={() => onRetryLesson(lesson.id)}
              >
                Retry this exercise
              </button>
            </div>
          )}

          {/* Objectives — shown only when the generator supplied them. */}
          {objectives && objectives.length > 0 && (
            <div className="fishbones-reader-objectives" role="note">
              <div className="fishbones-reader-objectives-label">You'll learn</div>
              <ul className="fishbones-reader-objectives-list">
                {objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          <div
            className="fishbones-reader-body"
            // Markdown → HTML is rendered by our pipeline, not user-authored HTML.
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {footer}
        </div>
      </div>

      {/* Glossary side sheet. Conditionally rendered so it doesn't eat
          DOM weight when the feature isn't in play. */}
      {hasGlossary && glossaryOpen && (
        <aside className="fishbones-reader-glossary" role="dialog" aria-label="Glossary">
          <div className="fishbones-reader-glossary-head">
            <span>Glossary</span>
            <button
              type="button"
              className="fishbones-reader-glossary-close"
              onClick={() => setGlossaryOpen(false)}
              aria-label="Close glossary"
            >
              <Icon icon={xIcon} size="xs" color="currentColor" />
            </button>
          </div>
          <div className="fishbones-reader-glossary-body">
            {enrichment!.glossary!.map((g, i) => (
              <div key={i} className="fishbones-reader-glossary-entry">
                <div className="fishbones-reader-glossary-term">{g.term}</div>
                <div className="fishbones-reader-glossary-def">{g.definition}</div>
              </div>
            ))}
          </div>
        </aside>
      )}

      <LessonPopover
        coords={popoverCoords}
        content={popoverContent}
        onOpenDoc={openExternal}
        // Cursor moved from trigger onto the popover — cancel the
        // pending hide so the popover stays while the learner reads.
        onPopoverEnter={cancelHide}
        // Cursor left the popover — schedule a hide. Moving BACK onto
        // the original trigger cancels it again via the delegated
        // mouseover listener on the container.
        onPopoverLeave={scheduleHide}
      />
    </section>
  );
}

/// Drop the first `# Title` line from a markdown body when it matches the
/// lesson's title, so the dedicated title header above the body doesn't
/// double up with a duplicate h1 at the top of the prose. Tolerates
/// leading whitespace and case drift — generator passes sometimes
/// normalise the title after the body has been written.
function stripLeadingTitleHeading(body: string, title: string): string {
  if (!body) return body;
  const match = /^\s*#\s+(.+?)\s*$/m.exec(body);
  if (!match) return body;
  if (match.index !== body.search(/\S/)) return body; // not the first non-whitespace line
  const heading = match[1].trim().toLowerCase();
  const lessonTitle = title.trim().toLowerCase();
  if (heading !== lessonTitle) return body;
  return body.slice(match.index + match[0].length).replace(/^\s*\n/, "");
}

/// Cheap reading-time estimate. Strips fenced code blocks from the word
/// count since those aren't read linearly — they're scanned, or skipped
/// entirely, or copy-pasted. Rounds up so a 30-second read still shows
/// as "1 min read" rather than "0 min read".
function estimateReadingMinutes(md: string): number {
  const prose = md.replace(/```[\s\S]*?```/g, ""); // drop fenced code
  const words = prose.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 1;
  return Math.max(1, Math.ceil(words / READING_WPM));
}

function decodeB64(b64: string): string {
  if (typeof atob === "function") {
    try {
      return decodeURIComponent(escape(atob(b64)));
    } catch {
      return "";
    }
  }
  return "";
}
