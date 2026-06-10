import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { SkeletonText } from "../Shared/Skeleton";
import LessonPopover, { type PopoverContent } from "./LessonPopover";
import AskAiSelectionPopover from "./AskAiSelectionPopover";
import InlineSandbox from "./InlineSandbox";
import TTSButton from "./TTSButton";
import { estimateReadingMinutes } from "./readingTime";
import { stopLessonAudio, useLessonAudio } from "../../hooks/useLessonAudio";
import { openDocsWindow } from "../../lib/docsPopout";
import { useLessonReadCursor } from "../../hooks/useLessonReadCursor";
import DeviceAction from "../Ledger/DeviceAction";
import { useT } from "../../i18n/i18n";
import LedgerStatusPill from "../Ledger/LedgerStatusPill";
import "./LessonReader.css";

interface Props {
  /// Course this lesson belongs to — threaded into the audio hook so
  /// narration resolves by `courseId/lessonId` (Exercism tracks all
  /// reuse canonical lesson slugs, so the bare id is ambiguous).
  courseId: string;
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
  /// When set, the parent course needs a hardware wallet — render a
  /// LedgerStatusPill at the top of the reading pane so the learner
  /// can connect / see the device state without scrolling. Currently
  /// only "ledger" is supported; other values render nothing.
  requiresDevice?: "ledger";
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

/// The top half of a lesson pane: prose rendered from the lesson's markdown
/// body, with fenced code blocks highlighted by Shiki. Also drives the
/// progress bar, objectives card, inline-sandbox hydration, popover
/// overlays, and glossary side panel.
export default function LessonReader({
  courseId,
  lesson,
  footer,
  onRetryLesson,
  requiresDevice,
}: Props) {
  const t = useT();
  const [html, setHtml] = useState<string>("");
  // Flips true once the first markdown render for this reader has
  // resolved. Gates the loading skeleton so (a) the placeholder only
  // covers the initial render, not every state tick, and (b) a
  // genuinely empty body never shows a perpetual skeleton —
  // renderMarkdown("") still resolves and marks ready.
  const [bodyReady, setBodyReady] = useState(false);

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
      if (!cancelled) {
        setHtml(rendered);
        setBodyReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lesson.body, enrichment, demotedReason, lesson.title]);

  // --- Scroll progress tracking ---------------------------------------

  // `scrollRef` keeps the imperative-access pattern the existing
  // scroll-progress effect uses; `scrollEl` (state below) feeds the
  // TTS cursor hook reactively. The callback ref keeps both in sync
  // on every mount/unmount.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0); // 0..1

  // ── TTS narration cursor ─────────────────────────────────────────
  // Walks the rendered article's `data-tts-block` annotations (added
  // by markdown.ts step 6), maps the audio's progress fraction to a
  // current block index, and applies the `.libre-tts-current` class on
  // the matching DOM element. The hook keys boundary recomputation
  // and class re-application off the `html` string identity rather
  // than a MutationObserver — the v1 design used MOs and froze the
  // app on lesson entry due to interaction with React-mounted
  // descendants (InlineSandbox, popover wiring, "Ask Libre"
  // badges) that mutate the article's subtree.
  // Drive the cursor off the ElevenLabs CDN narration's progress.
  // No on-device TTS fallback — lessons without a manifest entry
  // simply render the static "X min read" chip and the cursor stays
  // put. Adding a Web Speech / Siri fallback is what gave the
  // listener Siri's voice when CDN audio didn't load; we want the
  // CDN voice or nothing.
  const audio = useLessonAudio(courseId, lesson.id);
  const audioProgress = audio.available ? audio.progress : 0;
  const audioPlaying = audio.available ? audio.isPlaying : false;
  // Section anchoring inputs for the read-cursor hook. Sourced from
  // the audio manifest's per-section metadata (`blockStart` /
  // `blockEnd` + per-section duration), surfaced through
  // useLessonAudio. The cursor uses these to re-anchor the char-
  // weighting math at every heading transition instead of trying to
  // map cumulative cross-section progress onto a single weighted
  // table — that earlier approach drifted noticeably on lessons
  // with mixed pacing.
  const sectionBlockStart = audio.available ? audio.sectionBlockStart : null;
  const sectionBlockEnd = audio.available ? audio.sectionBlockEnd : null;
  const sectionCurrentSec = audio.available ? audio.sectionCurrentSec : 0;
  const sectionDurationSec = audio.available ? audio.sectionDurationSec : 0;
  // Article + scroll refs are state-backed so the cursor hook
  // reactively re-runs when the underlying DOM nodes mount /
  // remount. Plain `useRef` would capture `null` on first render
  // and never re-trigger the hook's boundary computation.
  const [articleEl, setArticleEl] = useState<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  useLessonReadCursor({
    scrollContainer: scrollEl,
    article: articleEl,
    html,
    progress: audioProgress,
    sectionBlockStart,
    sectionBlockEnd,
    sectionCurrentSec,
    sectionDurationSec,
    isPlaying: audioPlaying,
  });

  // Imperatively set the article's innerHTML on html change. We
  // don't use `dangerouslySetInnerHTML` because React (19 at least)
  // appears to rebuild the children on every render the prop is
  // present — even when the inner __html string is identical — and
  // that detaches the TTS cursor's highlight + every hydrated
  // sub-component on every audio timeupdate.
  // useLayoutEffect (not useEffect) so the children are populated
  // synchronously after commit, before the browser paints — without
  // it the first render would briefly show an empty article.
  useLayoutEffect(() => {
    if (!articleEl) return;
    if (articleEl.innerHTML !== html) {
      articleEl.innerHTML = html;
    }
  }, [articleEl, html]);

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
  //   - `.libre-inline-sandbox` → mount an <InlineSandbox/> React tree
  //   - `.libre-inline-symbol` + `.libre-inline-term` → wire
  //     mouseenter/leave to drive popover state

  const rootsRef = useRef<Root[]>([]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // 1) Inline sandbox hydration — replace marker divs with a real
    //    React subtree using createRoot. We keep handles so we can
    //    unmount them cleanly on lesson change.
    const sandboxes = Array.from(
      container.querySelectorAll<HTMLDivElement>(".libre-inline-sandbox"),
    );
    const localRoots: Root[] = [];
    for (const el of sandboxes) {
      const lang = (el.dataset.libreLang || primaryLang) as
        | typeof primaryLang
        | string;
      const b64 = el.dataset.libreSrc ?? "";
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

    // 1.5) Device-action hydration — for the Learning Ledger course
    //      (and any other course flagged as device-required). Each
    //      marker decodes a JSON config from its data-attr and
    //      mounts a small <DeviceAction> button that talks to the
    //      singleton Ledger transport.
    const deviceActions = Array.from(
      container.querySelectorAll<HTMLDivElement>(".libre-device-action"),
    );
    for (const el of deviceActions) {
      const b64 = el.dataset.libreConfig ?? "";
      let config: import("../Ledger/DeviceAction").DeviceActionConfig | null = null;
      try {
        const raw = decodeB64(b64);
        config = JSON.parse(raw) as import("../Ledger/DeviceAction").DeviceActionConfig;
      } catch (err) {
        // Bad fence → render an inert marker so the lesson still
        // displays. Devs reading the console see the parse error.
        // eslint-disable-next-line no-console
        console.error("[device-action] bad config JSON:", err);
        el.textContent = "(invalid device-action config)";
        continue;
      }
      el.innerHTML = "";
      const root = createRoot(el);
      localRoots.push(root);
      root.render(<DeviceAction config={config} />);
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
      if (el.classList.contains("libre-inline-symbol")) {
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
      } else if (el.classList.contains("libre-inline-term")) {
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
        ".libre-inline-symbol, .libre-inline-term",
      ) as HTMLElement | null;
      if (target) show(target, e.clientX, e.clientY);
    };
    const onOut = (e: MouseEvent) => {
      // `relatedTarget` is the element the cursor entered. If it's
      // another trigger OR the popover itself, don't schedule a hide.
      const related = (e.relatedTarget as HTMLElement | null)?.closest?.(
        ".libre-inline-symbol, .libre-inline-term, .libre-popover",
      );
      const target = (e.target as HTMLElement | null)?.closest?.(
        ".libre-inline-symbol, .libre-inline-term",
      );
      if (target && !related) scheduleHide();
    };

    // 3) "Ask Libre" badges on code blocks. Click → fire a
    //    `libre:ask-ai` custom event up to the AiAssistant root
    //    listener. We use event delegation on the container so the
    //    handler count stays at 1 regardless of how many code blocks
    //    are in the prose. The badge carries the snippet as a
    //    base64-encoded data attribute (set by the markdown pipeline).
    const onAskClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.(
        ".libre-code-block-ask",
      ) as HTMLElement | null;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const code = decodeB64(target.dataset.libreAskCode ?? "");
      const lang = target.dataset.libreAskLang ?? "";
      window.dispatchEvent(
        new CustomEvent("libre:ask-ai", {
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

  // --- Section completion badges --------------------------------------
  //
  // markdown.ts step 7 (`annotateSectionHeadings`) stamps every h2/h3
  // in the rendered body with a `data-libre-section` attribute + an
  // inert `<span class="libre-section-check">` slot. This effect
  // watches each heading with an IntersectionObserver rooted on the
  // scroll container; once a heading has fully scrolled above the top
  // of the visible reader region, we flip an `is-completed` class on
  // it. The badge stays on once set — re-scrolling back up doesn't
  // un-complete a section (matches the reading-progress mental model
  // where "I've seen this part already" is monotonic).
  //
  // Re-runs when `html` changes (new lesson, or enrichment re-render)
  // because the previous observer's `target` nodes are detached the
  // moment innerHTML is reassigned. `scrollEl` is the dependency that
  // ensures we wait until the scroll container is mounted before
  // wiring up the observer — otherwise the IO root would be null and
  // it would fall back to the document viewport, which here always
  // overlaps the entire article and reports every heading as
  // "visible" forever.
  // Bottom-of-page completion (Notion issue #a403f5d281ea4ca2).
  // Earlier builds painted a check badge on every h2 in the
  // prose as it scrolled past the viewport top. The canonical
  // ask is one badge — on the LESSON TITLE — that lights up
  // when (a) the lesson is already marked complete OR (b) the
  // user has scrolled to the bottom of the reader. Tracked
  // here as a state flag the title can read; the badge itself
  // mounts inside the `<h1 className="libre-reader-title">`
  // below.
  //
  // The 24px slack accounts for sub-pixel rounding, scrollbar
  // gutter, and the lesson nav footer overlay so a learner who
  // scrolls *almost* to the bottom still trips the trigger.
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  useEffect(() => {
    if (!scrollEl) return;
    const check = () => {
      const remaining =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (remaining <= 24) setScrolledToBottom(true);
    };
    check();
    scrollEl.addEventListener("scroll", check, { passive: true });
    return () => scrollEl.removeEventListener("scroll", check);
  }, [scrollEl, html]);
  // Reset the bottom-of-page flag whenever the rendered html
  // changes — that's our signal that we've navigated to a fresh
  // lesson and the old "you scrolled to the bottom" state
  // shouldn't bleed into the new one.
  useEffect(() => {
    setScrolledToBottom(false);
  }, [html]);
  // The badge trigger is "scrolled to bottom of the lesson body".
  // That doubles as the completion signal — short lessons that
  // fit in the viewport flip the badge on mount (the check fires
  // when `remaining <= 24px`), longer prose flips it once the
  // learner has actually read to the end. Wiring an additional
  // `isCompleted` prop would require LessonView → LessonReader
  // threading; if a future PR adds it, OR it together with this
  // flag here.
  const titleComplete = scrolledToBottom;

  // Stop the singleton TTS player when the user navigates to a
  // different lesson or unmounts the reader entirely. Without this
  // the narration of the previous lesson keeps playing while the
  // new one's prose is on screen — disorienting.
  useEffect(() => {
    return () => {
      stopLessonAudio();
    };
  }, [lesson.id]);

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
      if (t.closest(".libre-popover")) return;
      // Click on a trigger is handled by the hover flow — don't
      // interfere.
      if (t.closest(".libre-inline-symbol, .libre-inline-term")) {
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
    <section className="libre-reader">
      {/* Progress rail pinned to the top of the reader. Stays visible
          while the prose scrolls underneath. */}
      <div className="libre-reader-progress" aria-hidden>
        <div
          className="libre-reader-progress-fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div
        className="libre-reader-scroll"
        ref={(el) => {
          // Dual ref: imperative access for the legacy scroll-
          // progress effect AND a state-backed reference for the
          // TTS cursor hook (which needs a reactive value to
          // recompute boundaries after mount).
          scrollRef.current = el;
          setScrollEl(el);
        }}
      >
        <div className="libre-reader-inner">
          {/* Lesson title rendered above everything else so the learner
              always knows where they are — markdown bodies often repeat
              it as an h1 too, which we strip during render to avoid
              duplication. The `.libre-section-check` slot to the right
              fades in once `titleComplete` flips (= the learner has
              scrolled to the bottom of the lesson body) — Notion
              issue #a403f5d281ea4ca2. The check uses the same
              `.libre-section-check` class the body headings used to
              wear; the existing CSS animates the fade + slide in. */}
          <h1
            className={
              "libre-reader-title libre-section-heading" +
              (titleComplete ? " is-completed" : "")
            }
          >
            <span className="libre-section-heading-text">{lesson.title}</span>
            <span
              className="libre-section-check"
              aria-hidden
              dangerouslySetInnerHTML={{
                __html:
                  '<svg class="icon icon--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
              }}
            />
          </h1>

          {/* Top chip row: time-to-read + optional glossary toggle. Both
              live in the same row so the eye catches the meta info
              without eating much vertical space. */}
          <div className="libre-reader-meta">
            {/* Combined narration + reading-time pill. When pre-
                generated audio exists for this lesson it shows
                play/pause + a circular progress ring + remaining
                audio time. When no audio is available it falls back
                to a static "X min read" chip so the meta row still
                has one element instead of empty space. The audio
                survives across LessonReader mount cycles via the
                singleton player in `useLessonAudio`; the unmount
                effect below stops it when the lesson changes.
                See scripts/generate-lesson-audio.mjs for the pipeline
                that fills the manifest. */}
            <TTSButton
              courseId={courseId}
              lessonId={lesson.id}
              estimatedReadMinutes={
                progress < 0.05
                  ? readingMinutes
                  : minutesRemaining > 0
                    ? minutesRemaining
                    : 0
              }
            />
            {/* Hardware-wallet chip — only mounts when the parent
                course is flagged `requiresDevice`. Sits inline with
                the time-to-read chip so a learner can see + act on
                connection status without leaving the lesson scroll. */}
            {requiresDevice === "ledger" && <LedgerStatusPill />}
            {/* Floating docs window — official reference docs for
                this lesson's language, re-rendered in the app theme,
                opened beside the cursor. Reading-only lessons fall
                back to the default booklet (primaryLang is
                "plaintext" there). */}
            <button
              type="button"
              className="libre-reader-meta-glossary"
              onClick={(e) =>
                void openDocsWindow({
                  language: primaryLang === "plaintext" ? undefined : primaryLang,
                  screenX: e.screenX,
                  screenY: e.screenY,
                })
              }
              title={t("docsViewer.open")}
            >
              <span className="libre-reader-meta-glossary-icon" aria-hidden>
                <Icon icon={bookOpen} size="xs" color="currentColor" />
              </span>
              {t("docsViewer.title")}
            </button>
            {hasGlossary && (
              <button
                type="button"
                className={`libre-reader-meta-glossary ${
                  glossaryOpen ? "libre-reader-meta-glossary--open" : ""
                }`}
                onClick={() => setGlossaryOpen((v) => !v)}
              >
                <span className="libre-reader-meta-glossary-icon" aria-hidden>
                  <Icon icon={bookOpen} size="xs" color="currentColor" />
                </span>
                {t("lesson.glossary")}
                <span className="libre-reader-meta-glossary-count">
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
            <div className="libre-reader-retry" role="note">
              <div className="libre-reader-retry-head">
                <span className="libre-reader-retry-label">
                  {t("lesson.exerciseNeedsAnotherPass")}
                </span>
              </div>
              <div className="libre-reader-retry-body">
                {t("lesson.exerciseDemotedBody")}
              </div>
              <div className="libre-reader-retry-reason" title={demotedReason}>
                <span className="libre-reader-retry-reason-label">
                  {t("lesson.firstFailure")}
                </span>
                <span className="libre-reader-retry-reason-text">
                  {demotedReason.length > 160
                    ? demotedReason.slice(0, 160) + "…"
                    : demotedReason}
                </span>
              </div>
              <button
                type="button"
                className="libre-reader-retry-btn"
                onClick={() => onRetryLesson(lesson.id)}
              >
                {t("lesson.retryExercise")}
              </button>
            </div>
          )}

          {/* Objectives — shown only when the generator supplied them. */}
          {objectives && objectives.length > 0 && (
            <div className="libre-reader-objectives" role="note">
              <div className="libre-reader-objectives-label">{t("lesson.youWillLearn")}</div>
              <ul className="libre-reader-objectives-list">
                {objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {!bodyReady && (
            <SkeletonText lines={7} className="libre-reader-body-skeleton" />
          )}
          <div
            ref={setArticleEl}
            className="libre-reader-body"
            // innerHTML is set imperatively below in a `[articleEl, html]`
            // useEffect — using `dangerouslySetInnerHTML` here would
            // pass a fresh object literal on every render, and React
            // (at least 19) treats that as "DOM update needed" and
            // rebuilds the article's children every tick. That detaches
            // the TTS cursor's highlighted paragraph (along with every
            // hydrated InlineSandbox / popover handler) on every audio
            // timeupdate. The imperative path runs once per html
            // identity change and leaves the children alone otherwise.
          />
          {/* Inline Ask AI — floating chip over text selections in
              the body above. Fixed-position, so mounting here has
              no layout effect; it needs the lesson coordinates to
              stamp the libre:ask-ai event with course context. */}
          <AskAiSelectionPopover
            courseId={courseId}
            lessonId={lesson.id}
            lessonTitle={lesson.title}
          />
          {footer}
        </div>
      </div>

      {/* Glossary side sheet. Conditionally rendered so it doesn't eat
          DOM weight when the feature isn't in play. */}
      {hasGlossary && glossaryOpen && (
        <aside className="libre-reader-glossary" role="dialog" aria-label={t("lesson.glossary")}>
          <div className="libre-reader-glossary-head">
            <span>{t("lesson.glossary")}</span>
            <button
              type="button"
              className="libre-reader-glossary-close"
              onClick={() => setGlossaryOpen(false)}
              aria-label={t("lesson.closeGlossary")}
            >
              <Icon icon={xIcon} size="xs" color="currentColor" />
            </button>
          </div>
          <div className="libre-reader-glossary-body">
            {enrichment!.glossary!.map((g, i) => (
              <div key={i} className="libre-reader-glossary-entry">
                <div className="libre-reader-glossary-term">{g.term}</div>
                <div className="libre-reader-glossary-def">{g.definition}</div>
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
