/// Mobile-only free-form code sandbox. A stripped-down sibling of
/// the desktop PlaygroundView (src/components/Playground/) tuned for
/// phone-shaped screens:
///
///   - One language picker (a native `<select>` so it gets the iOS
///     wheel picker UI for free)
///   - One textarea editor (not Monaco — Monaco's IME / keyboard
///     handling fights the PartnerKeyboard's insertion hooks)
///   - Run button → output panel below
///   - PartnerKeyboard portal-rendered above the system keyboard
///
/// The desktop Playground's chain banners, phone simulator, AI
/// generation, view-mode toggles, and floating-phone popout are all
/// dropped — none of them fit on a phone screen and the partner-
/// keyboard experiment is what this surface is here to validate.
/// Once the keyboard feels right we can layer richer features back
/// in; for now the goal is "can a learner write + run JS on their
/// phone without dropping into blocks mode?"
///
/// File state persists per-language via `usePlaygroundFiles` — the
/// same hook the desktop Playground uses — so switching languages
/// preserves drafts and a returning visitor lands on what they were
/// last editing.

import { useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { play as playIcon } from "@base/primitives/icon/icons/play";
import { rotateCcw } from "@base/primitives/icon/icons/rotate-ccw";
import "@base/primitives/icon/icon.css";

import type { LanguageId } from "@/data/types";
import { usePlaygroundFiles } from "@/hooks/usePlaygroundFiles";
import { runFiles, type RunResult } from "@/runtimes/index";
import PartnerKeyboard from "@/components/organisms/PartnerKeyboard/PartnerKeyboard";

import "./MobilePlayground.css";

/// Languages exposed in the mobile picker. Smaller roster than the
/// desktop playground because some runtimes (Tauri, EVM dock,
/// Solana SVM, Three.js, Svelte 5) need desktop-only toolchains
/// that don't exist in the web/iOS build. Sticking to languages
/// that run end-to-end on every platform keeps the picker honest —
/// no "you need to be on macOS to try this" surprises mid-tap.
const LANGUAGES: Array<{ id: LanguageId; label: string }> = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "ruby", label: "Ruby" },
  { id: "lua", label: "Lua" },
  { id: "sql", label: "SQL" },
  { id: "web", label: "Web (HTML + CSS + JS)" },
  { id: "react", label: "React (JSX + CSS)" },
];

export default function MobilePlayground() {
  const { language, setLanguage, files, setFiles, resetToTemplate } =
    usePlaygroundFiles("javascript");

  // Single-file model on mobile. The hook can return multi-file
  // templates (Web, React) — we just edit the first file for v1.
  // A future pass can add a tab strip for files[1..n], but the
  // partner keyboard experiment doesn't need it.
  const fileIdx = 0;
  const file = files[fileIdx];

  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);

  /// Textarea handle is what PartnerKeyboard binds to. The strip
  /// listens to focus on this element and routes insertions
  /// through its `setRangeText` flow.
  const editorRef = useRef<HTMLTextAreaElement>(null);

  async function handleRun() {
    setRunning(true);
    setResult(null);
    try {
      const r = await runFiles(language, files);
      setResult(r);
    } catch (e) {
      setResult({
        logs: [
          {
            level: "error",
            text: e instanceof Error ? e.message : String(e),
          },
        ],
        error: e instanceof Error ? e.message : String(e),
        durationMs: 0,
      });
    } finally {
      setRunning(false);
    }
  }

  function handleFileChange(next: string) {
    if (!file) return;
    const copy = files.slice();
    copy[fileIdx] = { ...file, content: next };
    setFiles(copy);
  }

  return (
    <div className="m-pg">
      <header className="m-pg__head">
        <select
          className="m-pg__lang"
          value={language}
          onChange={(e) => setLanguage(e.target.value as LanguageId)}
          aria-label="Playground language"
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <div className="m-pg__head-actions">
          <button
            type="button"
            className="m-pg__btn m-pg__btn--ghost"
            onClick={resetToTemplate}
            aria-label="Reset to template"
            title="Reset to template"
          >
            <Icon icon={rotateCcw} size="sm" color="currentColor" />
          </button>
          <button
            type="button"
            className="m-pg__btn m-pg__btn--primary"
            onClick={handleRun}
            disabled={running || !file}
          >
            {running ? (
              "Running…"
            ) : (
              <>
                <Icon icon={playIcon} size="sm" color="currentColor" />
                <span>Run</span>
              </>
            )}
          </button>
        </div>
      </header>

      <div className="m-pg__editor-wrap">
        <textarea
          ref={editorRef}
          className="m-pg__editor"
          value={file?.content ?? ""}
          onChange={(e) => handleFileChange(e.target.value)}
          placeholder="// tap here to start coding…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          // Same hygiene attributes the partner-keyboard prototype
          // uses — keeps iOS from showing autocorrect suggestions on
          // top of code, and from auto-uppercasing the first char of
          // every "sentence" (every line in code is a "sentence" to
          // iOS).
          inputMode="text"
          enterKeyHint="enter"
        />
      </div>

      {(result || running) && (
        <section className="m-pg__output" aria-live="polite">
          <div className="m-pg__output-head">
            <span>output</span>
            {result && (
              <span className="m-pg__output-meta">
                {result.durationMs}ms
              </span>
            )}
          </div>
          <div className="m-pg__output-body">
            {running && !result && (
              <div className="m-pg__output-running">Running…</div>
            )}
            {result?.error && (
              <div className="m-pg__output-error">{result.error}</div>
            )}
            {result?.logs?.map((line, i) => (
              <div
                key={i}
                className={`m-pg__output-line m-pg__output-line--${line.level}`}
              >
                {line.text}
              </div>
            ))}
            {result && !result.error && (!result.logs || result.logs.length === 0) && (
              <div className="m-pg__output-empty">
                (ran in {result.durationMs}ms with no output)
              </div>
            )}
          </div>
        </section>
      )}

      {/* Partner keyboard portal-renders into document.body and
          shows itself whenever the textarea has focus. Pinned above
          the system keyboard via visualViewport math + the
          interactive-widget=resizes-content viewport directive
          (see index.html). */}
      <PartnerKeyboard targetRef={editorRef} />
    </div>
  );
}
