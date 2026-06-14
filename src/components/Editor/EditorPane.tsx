// Side-effect import: wires `self.MonacoEnvironment` and points
// `@monaco-editor/react`'s loader at our bundled Monaco instance. MUST come
// before the `@monaco-editor/react` import below so the loader is
// configured before any Editor component mounts. See lib/monaco/setup.ts
// for the full rationale (signed-production CDN-load issue).
import "../../lib/monaco/setup";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Editor from "@monaco-editor/react";
import { Icon } from "@base/primitives/icon";
import { arrowLeft } from "@base/primitives/icon/icons/arrow-left";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import { rotateCcw } from "@base/primitives/icon/icons/rotate-ccw";
import { eye } from "@base/primitives/icon/icons/eye";
import { layoutPanelLeft } from "@base/primitives/icon/icons/layout-panel-left";
import { layoutPanelTop } from "@base/primitives/icon/icons/layout-panel-top";
import "@base/primitives/icon/icon.css";
import { ShortcutHint } from "../ShortcutHint/ShortcutHint";
import { useT } from "../../i18n/i18n";
import type { FileLanguage, LanguageId, WorkbenchFile } from "../../data/types";
import { useActiveTheme } from "../../theme/useActiveTheme";
import { MONACO_THEME_BY_APP_THEME, registerMonacoThemes } from "../../theme/monaco-themes";
import { attachTodoHints } from "../../lib/monaco/todoHints";
import "./EditorPane.css";

// Themes + ambient CommonJS decls are still applied per-mount via
// `beforeMount` below — `defineTheme` and `addExtraLib` are idempotent
// keyed by name, so the duplicate calls are cheap and ensure our
// customizations are in place before the first paint.
//
// We declare CommonJS globals (`module`, `exports`, `require`) as an
// ambient type-lib so Monaco's TypeScript language service stops flagging
// `module.exports = { ... }` in exercise starters. Libre' JS/TS
// lessons use the CommonJS module pattern (the test harness does
// `require('./user')` against the learner's exports), but Monaco's
// default TS config has no Node globals — it was rendering every
// `module.exports` underline-red with "Cannot find name 'module'".
// Declaring them as `any` here tells the language service they exist
// without forcing us to pull in `@types/node` (which would bring hundreds
// of other globals the lessons shouldn't care about).

const COMMONJS_AMBIENT = `
// Libre ambient declarations — keeps the learner's CommonJS-style
// starter (module.exports = { ... }, const x = require('./user')) from
// showing bogus "Cannot find name 'module'" squiggles in Monaco. The
// runtime handles the actual module plumbing; the editor just needs to
// know the globals exist.
declare const module: { exports: any };
declare const exports: any;
declare function require(name: string): any;
declare const __dirname: string;
declare const __filename: string;
declare const process: { env: Record<string, string | undefined> };
`;

function addCommonJsAmbientDecls(monaco: typeof import("monaco-editor")) {
  try {
    // Add to both TS and JS language services — Monaco checks them
    // independently, and some lessons may use the `.js` extension.
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      COMMONJS_AMBIENT,
      "file:///libre-commonjs.d.ts",
    );
    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      COMMONJS_AMBIENT,
      "file:///libre-commonjs.d.ts",
    );
  } catch {
    // If Monaco's API shape ever changes or the typescript worker isn't
    // loaded yet, we'd rather the editor keep working than crash. The
    // underline remains visible but everything else is unaffected.
  }
}

interface Props {
  /// Primary lesson language — displayed as the toolbar badge and kept for
  /// tooltip purposes. Individual files carry their own Monaco language.
  language: LanguageId;
  /// Open files, in display order. Array length >= 1. Legacy single-file
  /// lessons pass a one-element array synthesized from `starter`.
  files: WorkbenchFile[];
  /// Index into `files` of the currently-edited file. The editor mounts a
  /// fresh Monaco model when this changes so the scroll/selection state is
  /// per-file rather than shared.
  activeIndex: number;
  /// File tab click. Parent updates its activeIndex state.
  onActiveIndexChange: (index: number) => void;
  /// Per-file edit handler. Parent replaces the content of `files[index]`.
  onChange: (index: number, nextContent: string) => void;
  onRun: () => void;
  /// Optional hints, revealed progressively. Parent doesn't need to track
  /// the revealed count — EditorPane owns that state because App-level
  /// LessonView is already keyed by lessonId, so this component remounts
  /// and resets on every lesson change.
  hints?: string[];
  /// Restore the exercise's starter code. Disabled if omitted.
  onReset?: () => void;
  /// Overwrite the editor with the reference solution. Shown behind a
  /// confirmation because it's destructive to the user's in-progress code.
  onRevealSolution?: () => void;
  /// Open the editor + console in a detached window. Disabled if omitted
  /// (e.g. when the EditorPane is already rendered inside the popped-out
  /// window).
  onPopOut?: () => void;
  /// Hand the current lesson off to the Libre VSCode extension. When
  /// supplied, renders a small button next to `onPopOut` that fires a
  /// `vscode://libre-academy.libre/open?course=…&lesson=…` URL —
  /// VSCode picks it up (if installed) and opens the lesson in its
  /// own UI with the same shared progress.sqlite this app writes to.
  /// Omit on surfaces where the handoff doesn't make sense (e.g. the
  /// popped-out workbench window, where you're already detached).
  onOpenInVSCode?: () => void;
  /// Outer split orientation + toggle. When both are supplied, the editor
  /// header renders a layout button that flips the article↔workbench split
  /// between side-by-side ("horizontal") and stacked ("vertical"). Omitted
  /// on surfaces with no article to split against (e.g. the popped-out
  /// workbench window).
  splitOrientation?: "horizontal" | "vertical";
  onToggleSplit?: () => void;
  /// Exercise render-mode toggle, surfaced inline in the editor header
  /// when the lesson ships authored blocks data. When omitted, no
  /// toggle renders. The toggle replaces the previous language label
  /// in the header — it's the more useful affordance for learners
  /// switching between editor + blocks during a lesson.
  exerciseMode?: "editor" | "blocks";
  onExerciseModeChange?: (mode: "editor" | "blocks") => void;
}

const MONACO_LANGUAGES: Record<FileLanguage, string> = {
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  rust: "rust",
  swift: "swift",
  go: "go",
  c: "c",
  cpp: "cpp",
  java: "java",
  kotlin: "kotlin",
  csharp: "csharp",
  // Monaco doesn't ship a generic `assembly` language — use its
  // built-in `mips` colourer, which highlights mnemonics + registers
  // well enough for most snippets. A proper arm64/x86_64 Monarch
  // tokenizer would be nicer long-term; this keeps the pane from
  // falling back to plain-text in the meantime.
  assembly: "mips",
  html: "html",
  css: "css",
  json: "json",
  // Svelte uses our hand-rolled Monarch grammar (lib/monaco/svelte.ts)
  // registered via lib/monaco/setup.ts. The id matches what
  // setMonarchTokensProvider was registered against — without this
  // mapping `.svelte` files render as plaintext even though the
  // grammar exists.
  svelte: "svelte",
  // Solidity uses a hand-rolled Monarch grammar (lib/monaco/solidity.ts)
  // registered via lib/monaco/setup.ts. Monaco doesn't ship a Solidity
  // language built in, so without this mapping `.sol` files would
  // render as plaintext.
  solidity: "solidity",
  // Vyper has Python-like syntax — Monaco's built-in Python tokenizer
  // gets us indentation, strings, decorators, and number literals
  // for free. Not perfect (Vyper-specific keywords like `external`
  // and `payable` won't get the special tint they deserve) but a
  // sensible default until someone hand-writes a Vyper Monarch.
  vyper: "python",
  // ── 2026 expansion ───────────────────────────────────────────
  // Monaco's built-in language ids; for the chain-specific languages
  // (move / cairo / sway) Monaco has no native grammar, so we alias
  // them to the closest syntactic neighbour. A proper Monarch
  // tokenizer per language is a follow-up; this gets us readable
  // colouring on day one.
  // 2026 expansion — first six pull Monaco's bundled grammars, last
  // five use the hand-rolled Monarchs in src/lib/monaco/{lang}.ts.
  // All registered eagerly in lib/monaco/setup.ts so production Tauri
  // webviews don't lose them to lazy-chunk resolution failures.
  ruby: "ruby",
  lua: "lua",
  dart: "dart",
  scala: "scala",
  sql: "sql",
  elixir: "elixir",
  haskell: "haskell",
  zig: "zig",
  move: "move",
  cairo: "cairo",
  sway: "sway",
  // Koans-only additions. Monaco doesn't bundle a clojure grammar, so
  // alias to scheme (close-enough s-expression colouring). F# has
  // a bundled grammar.
  clojure: "scheme",
  fsharp: "fsharp",
  // Monaco's built-in markdown is fine for lesson-body fragments
  // (.md files in mixed-lesson file sets) — wire it up so the
  // editor doesn't fall through to plaintext on those.
  markdown: "markdown",
  plaintext: "plaintext",
};

/// Left half of the workbench. Wraps Monaco with a small header
/// (Editor/Blocks toggle when blocks data exists, plus a Help split-
/// button + Pop-out + Run cluster) and a collapsible hint panel that
/// shows progressively as the learner asks for help.
export default function EditorPane({
  language,
  files,
  activeIndex,
  onActiveIndexChange,
  onChange,
  onRun,
  hints,
  onReset,
  onRevealSolution,
  onPopOut,
  onOpenInVSCode,
  splitOrientation,
  onToggleSplit,
  exerciseMode,
  onExerciseModeChange,
}: Props) {
  const t = useT();
  // `language` no longer renders as a header label (the slot is now
  // the Editor/Blocks toggle when present). Kept as a prop for
  // tooltip purposes + future use; reference the variable here so
  // TS doesn't flag it as unused.
  void language;
  // Guard: activeIndex can briefly be out-of-range during file-list swaps
  // (e.g. reveal-solution replacing the whole array). Clamp to a valid
  // position so Monaco doesn't receive an undefined value.
  const safeIndex = Math.max(0, Math.min(activeIndex, files.length - 1));
  const active = files[safeIndex];
  const hasHints = !!hints && hints.length > 0;
  // `revealed` — how many hints the learner has unlocked so far (0..N).
  // `currentIdx` — which revealed hint is currently displayed in the panel.
  // `open` — whether the panel is visible. Closing with X hides without
  // losing progress, so clicking Hint again reopens at the same spot.
  const [revealed, setRevealed] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [confirmingReveal, setConfirmingReveal] = useState(false);
  // Help split-button dropdown — when open, exposes Reset + Reveal
  // solution. Click-outside + Escape dismiss the menu (mirrors the
  // pattern in components/Library/AddCourseButton.tsx).
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement | null>(null);
  // Portaled menu position. The dropdown lives in `document.body`
  // (so it isn't clipped by any ancestor `overflow: hidden` —
  // notably `.libre-sandbox` and the sandbox-view scroll container
  // both clip absolute children), with `position: fixed` coords
  // measured from the help trigger's bounding rect on each open.
  const helpMenuRef = useRef<HTMLDivElement | null>(null);
  const [helpMenuPos, setHelpMenuPos] = useState<{
    top: number;
    right: number;
  } | null>(null);
  useEffect(() => {
    if (!helpMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      // Clicks inside the trigger keep the menu open (the chevron
      // handler toggles it itself; we don't want this listener to
      // race-close it on the same event).
      if (helpRef.current?.contains(t)) return;
      // Clicks inside the portaled menu also keep it open — they
      // hit a menu item which is responsible for closing the menu
      // after running its action.
      if (helpMenuRef.current?.contains(t)) return;
      setHelpMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelpMenuOpen(false);
    };
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [helpMenuOpen]);
  // Measure the trigger and compute the portaled menu's `top` +
  // `right` (viewport coordinates). Re-runs on open, on window
  // resize, and on scroll-at-capture so the menu tracks the
  // editor scrolling underneath it. `useLayoutEffect` so the
  // measurement happens before paint and the menu doesn't flash
  // at (0, 0) before snapping into position.
  useLayoutEffect(() => {
    if (!helpMenuOpen) {
      setHelpMenuPos(null);
      return;
    }
    const measure = () => {
      const trigger = helpRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setHelpMenuPos({
        top: rect.bottom + 4,
        // `right` = distance from the trigger's right edge to the
        // viewport's right edge. Mirrors the prior `right: 0`
        // anchoring (menu's right edge sits on the trigger's right
        // edge) but in viewport space so `position: fixed` works.
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    measure();
    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [helpMenuOpen]);
  const activeTheme = useActiveTheme();
  const monacoTheme = MONACO_THEME_BY_APP_THEME[activeTheme];

  /// Toolbar Hint button behavior: if there are still unrevealed hints,
  /// reveal the next one AND jump to it. If everything is already revealed,
  /// just re-open the panel at the last position the learner was viewing.
  function onHintClick() {
    if (!hasHints) return;
    if (revealed < hints!.length) {
      const next = revealed + 1;
      setRevealed(next);
      setCurrentIdx(next - 1);
    } else {
      setCurrentIdx(hints!.length - 1);
    }
    setOpen(true);
  }

  function prevHint() {
    setCurrentIdx((i) => Math.max(0, i - 1));
  }

  /// Panel-level Next: if we're at the end of the revealed set but more
  /// exist, unlock one; otherwise just advance through already-seen hints.
  function nextHint() {
    if (!hasHints) return;
    if (currentIdx < revealed - 1) {
      setCurrentIdx((i) => i + 1);
    } else if (revealed < hints!.length) {
      const next = revealed + 1;
      setRevealed(next);
      setCurrentIdx(next - 1);
    }
  }

  function confirmReveal() {
    if (!onRevealSolution) return;
    onRevealSolution();
    setConfirmingReveal(false);
  }

  const multiFile = files.length > 1;

  // The help cluster collapses Hint/Reset/Solution into one
  // split-button: Hint is the primary face (the most-used learning
  // affordance), the chevron opens a dropdown with Reset + Reveal
  // solution. Mirrors the AddCourseButton pattern in the library
  // header. Renders only when at least one of the three is
  // available; the chevron-only fallback (no hints, only reset /
  // solution) keeps the menu reachable via "More" labelling.
  const showHelpCluster = hasHints || !!onReset || !!onRevealSolution;
  const hasMenuItems = !!onReset || !!onRevealSolution;

  return (
    <div className="libre-editor">
      <div className="libre-editor-header">
        {/* Left side: Editor / Blocks mode toggle when the lesson
            ships authored blocks data. Replaces the previous static
            language label — the toggle is more useful in-context. */}
        {exerciseMode && onExerciseModeChange ? (
          <div className="libre-editor-mode" role="group" aria-label={t("editor.ariaExerciseMode")}>
            <button
              type="button"
              className={
                "libre-editor-mode-btn" +
                (exerciseMode === "editor"
                  ? " libre-editor-mode-btn--active"
                  : "")
              }
              onClick={() => onExerciseModeChange("editor")}
              aria-pressed={exerciseMode === "editor"}
            >
              {t("editor.modeEditor")}
            </button>
            <button
              type="button"
              className={
                "libre-editor-mode-btn" +
                (exerciseMode === "blocks"
                  ? " libre-editor-mode-btn--active"
                  : "")
              }
              onClick={() => onExerciseModeChange("blocks")}
              aria-pressed={exerciseMode === "blocks"}
            >
              {t("editor.modeBlocks")}
            </button>
          </div>
        ) : (
          // Empty placeholder so the header's flex layout still
          // anchors the action cluster on the right when no mode
          // toggle shows on the left.
          <span aria-hidden />
        )}
        <div className="libre-editor-actions">
          {showHelpCluster && (
            <div className="libre-editor-help" ref={helpRef}>
              <div className="libre-editor-help-split">
                <button
                  type="button"
                  className="libre-editor-help-main"
                  onClick={hasHints ? onHintClick : undefined}
                  disabled={!hasHints}
                  title={
                    hasHints
                      ? t("editorHints.tooltipNext")
                      : hasMenuItems
                        ? t("editorHints.tooltipNoneWithMenu")
                        : t("editorHints.tooltipNoneNoMenu")
                  }
                >
                  {hasHints ? t("lesson.hintProgress", { current: revealed, total: hints!.length }) : t("lesson.help")}
                </button>
                {hasMenuItems && (
                  <button
                    type="button"
                    className="libre-editor-help-caret"
                    onClick={() => setHelpMenuOpen((v) => !v)}
                    aria-expanded={helpMenuOpen}
                    aria-haspopup="menu"
                    aria-label={t("editor.ariaHelpOptions")}
                    title={t("editor.ariaHelpOptions")}
                  >
                    {/* One scale up (xs→sm) — the toolbar icon row
                        was reading too small / cramped against the
                        editor pane. See sibling bumps on the
                        pop-out + VSCode buttons. */}
                    <Icon icon={chevronDown} size="sm" color="currentColor" />
                  </button>
                )}
              </div>
              {helpMenuOpen &&
                hasMenuItems &&
                helpMenuPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={helpMenuRef}
                    className="libre-editor-help-menu libre-editor-help-menu--portaled"
                    role="menu"
                    aria-label={t("editor.ariaHelpOptions")}
                    style={{
                      position: "fixed",
                      top: `${helpMenuPos.top}px`,
                      right: `${helpMenuPos.right}px`,
                    }}
                  >
                    {onReset && (
                      <button
                        type="button"
                        role="menuitem"
                        className="libre-editor-help-item"
                        onClick={() => {
                          setHelpMenuOpen(false);
                          onReset();
                        }}
                      >
                        <Icon
                          icon={rotateCcw}
                          size="xs"
                          color="currentColor"
                        />
                        <span className="libre-editor-help-item-body">
                          <span className="libre-editor-help-item-title">
                            {t("lesson.reset")}
                          </span>
                          <span className="libre-editor-help-item-hint">
                            {t("lesson.resetStarter")}
                          </span>
                        </span>
                      </button>
                    )}
                    {onRevealSolution && (
                      <button
                        type="button"
                        role="menuitem"
                        className="libre-editor-help-item libre-editor-help-item--danger"
                        onClick={() => {
                          setHelpMenuOpen(false);
                          setConfirmingReveal(true);
                        }}
                      >
                        <Icon icon={eye} size="xs" color="currentColor" />
                        <span className="libre-editor-help-item-body">
                          <span className="libre-editor-help-item-title">
                            {t("lesson.revealSolution")}
                          </span>
                          <span className="libre-editor-help-item-hint">
                            {t("lesson.revealSolutionHint")}
                          </span>
                        </span>
                      </button>
                    )}
                  </div>,
                  document.body,
                )}
            </div>
          )}
          {onToggleSplit && splitOrientation && (
            <button
              type="button"
              className="libre-editor-button libre-editor-button--glyph"
              onClick={onToggleSplit}
              title={
                splitOrientation === "vertical"
                  ? t("editor.splitSideBySide")
                  : t("editor.splitTopBottom")
              }
              aria-label={
                splitOrientation === "vertical"
                  ? t("editor.splitSideBySide")
                  : t("editor.splitTopBottom")
              }
            >
              <Icon
                icon={
                  splitOrientation === "vertical" ? layoutPanelLeft : layoutPanelTop
                }
                size="xs"
                color="currentColor"
              />
            </button>
          )}
          {onPopOut && (
            <button
              type="button"
              className="libre-editor-button libre-editor-button--glyph"
              onClick={onPopOut}
              title={t("editor.popOut")}
            >
              ⇱
            </button>
          )}
          {onOpenInVSCode && (
            <button
              type="button"
              className="libre-editor-button"
              onClick={onOpenInVSCode}
              title={t("editor.openInVSCode")}
              aria-label={t("editor.openInVSCode")}
            >
              {/* Official VSCode brand logo (Notion issue
                  #b07aeebf23206a8d "Use new VSCode Icon" — links
                  the canonical asset). Three prior glyph attempts
                  (custom slab+chevron SVG, external-link,
                  code-square) all read poorly or rendered
                  partially at toolbar size. Now an <img> of the
                  real full-colour VSCode mark, bundled at
                  `public/vscode.png` (downscaled from the 1024²
                  brand PNG to 64²). The colour variant is
                  theme-safe — the saturated blue ribbon reads on
                  both light and dark toolbar backgrounds, which
                  is what the original "broken in dark and light
                  mode" report needed. `import.meta.env.BASE_URL`
                  prefix so the path resolves under the web
                  build's `/learn/` sub-path too. */}
              <img
                src={`${import.meta.env.BASE_URL}vscode.png`}
                alt=""
                width={16}
                height={16}
                draggable={false}
                style={{ display: "block" }}
              />
            </button>
          )}
          <button
            type="button"
            className="libre-editor-button libre-editor-run"
            onClick={onRun}
          >
            {/* Holographic foil retired — the rainbow snake-sparkle
                treatment is now scoped to certificates + the AI
                button so the cert moment stays special and the
                primary-CTA buttons read as quiet flat surfaces. */}
            <span className="libre-editor-run__label">{t("editor.run")}</span>
            <ShortcutHint actionId="lesson.run" className="libre-shortcut-hint--gap" />
          </button>
        </div>
      </div>

      {/* File tabs on their OWN row beneath the action/run header, so
          file names get full width and aren't squeezed against the
          Hint/run cluster. Horizontally scrollable; only shown for
          multi-file projects (nothing to switch in a single file). */}
      {multiFile && (
        <div
          className="libre-editor-tabs-row"
          role="tablist"
          aria-label={t("editor.tabsAriaLabel")}
        >
          {files.map((f, i) => (
            <button
              key={f.name}
              role="tab"
              aria-selected={i === safeIndex}
              className={`libre-editor-tab ${
                i === safeIndex ? "libre-editor-tab--active" : ""
              } ${f.readOnly ? "libre-editor-tab--readonly" : ""}`}
              onClick={() => onActiveIndexChange(i)}
              title={f.readOnly ? `${f.name} ${t("editor.readOnlyBadge")}` : f.name}
            >
              <span className="libre-editor-tab-name">{f.name}</span>
              {f.readOnly && (
                <span className="libre-editor-tab-badge" aria-hidden>
                  🔒
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {hasHints && open && revealed > 0 && (
        <div className="libre-editor-hints">
          <div className="libre-editor-hints-header">
            <span className="libre-editor-hints-label">
              {t("editorHints.label", { current: currentIdx + 1, total: hints!.length })}
              {revealed < hints!.length && (
                <span className="libre-editor-hints-locked">
                  {" "}
                  {t("editorHints.locked", { count: hints!.length - revealed })}
                </span>
              )}
            </span>
            <button
              className="libre-editor-hints-close"
              onClick={() => setOpen(false)}
              title={t("editorHints.close")}
              aria-label={t("editorHints.close")}
            >
              ×
            </button>
          </div>

          <div className="libre-editor-hints-body">{hints![currentIdx]}</div>

          <div className="libre-editor-hints-nav">
            <button
              className="libre-editor-hints-nav-btn"
              onClick={prevHint}
              disabled={currentIdx === 0}
              aria-label={t("editorHints.previous")}
            >
              <Icon icon={arrowLeft} size="xs" color="currentColor" />
              prev
            </button>
            <div className="libre-editor-hints-pips" aria-hidden>
              {hints!.map((_, i) => (
                <span
                  key={i}
                  className={
                    "libre-editor-hints-pip" +
                    (i === currentIdx ? " libre-editor-hints-pip--current" : "") +
                    (i >= revealed ? " libre-editor-hints-pip--locked" : "")
                  }
                />
              ))}
            </div>
            <button
              className="libre-editor-hints-nav-btn"
              onClick={nextHint}
              disabled={
                currentIdx === revealed - 1 && revealed === hints!.length
              }
              aria-label={
                currentIdx < revealed - 1 ? t("editorHints.next") : t("editorHints.unlockNext")
              }
            >
              {currentIdx < revealed - 1 ? "next" : "reveal next"}
              <Icon icon={arrowRight} size="xs" color="currentColor" />
            </button>
          </div>
        </div>
      )}

      <div className="libre-editor-host">
        {active && (
          <Editor
            height="100%"
            // `path` gives each file its own Monaco model, so undo history,
            // cursor position, and scroll state are preserved per-tab. The
            // `key` prevents model leakage when the file list is swapped
            // wholesale (e.g. reveal-solution replacing everything).
            key={active.name}
            path={active.name}
            language={MONACO_LANGUAGES[active.language] ?? "plaintext"}
            value={active.content}
            theme={monacoTheme}
            beforeMount={(monaco) => {
              // Re-register on every mount as a safety net — Monaco's theme
              // cache is per-instance and defineTheme is idempotent by name,
              // so repeated calls are cheap and guarantee our themes exist
              // before the first paint even if loader.init resolved late.
              registerMonacoThemes(monaco);
              // Same idempotent safety net for the CommonJS ambient decls:
              // `addExtraLib` replaces any earlier registration under the
              // same virtual filename, so re-calling it mid-mount is a
              // no-op once the globals are already declared.
              addCommonJsAmbientDecls(monaco);
            }}
            onMount={(editor, monaco) => {
              // AI TODO hints — "✨ help" CodeLens over TODO/FIXME
              // comments + ghost-text suggestions (see todoHints.ts).
              // Keyed remounts per file mean one attach per model;
              // the attachment self-detaches on editor dispose.
              // Skipped for read-only files (tests) where hints make
              // no sense.
              if (!active.readOnly) {
                attachTodoHints(monaco, editor, {
                  language: active.language,
                  fileName: active.name,
                });
              }
            }}
            onChange={(v) => onChange(safeIndex, v ?? "")}
            options={{
              fontSize: 13,
              fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbersMinChars: 3,
              tabSize: 2,
              automaticLayout: true,
              renderLineHighlight: "gutter",
              readOnly: !!active.readOnly,
            }}
          />
        )}
      </div>

      {confirmingReveal && (
        <div className="libre-editor-modal-backdrop" onClick={() => setConfirmingReveal(false)}>
          <div className="libre-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="libre-editor-modal-title">{t("editorHints.confirmTitle")}</div>
            <p className="libre-editor-modal-body">
              {t("editorHints.confirmBody")}
            </p>
            <div className="libre-editor-modal-actions">
              <button
                className="libre-editor-button"
                onClick={() => setConfirmingReveal(false)}
              >
                {t("common.cancel").toLowerCase()}
              </button>
              <button
                className="libre-editor-button libre-editor-button--danger"
                onClick={confirmReveal}
              >
                {t("editorHints.confirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
