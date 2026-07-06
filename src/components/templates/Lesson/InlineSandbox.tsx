// Side-effect import: configures `@monaco-editor/react`'s loader to use
// the locally-bundled Monaco instance + wires `self.MonacoEnvironment`
// for worker spawning. Same import EditorPane uses; the file's
// side-effects are idempotent so importing it from both places is safe
// (modules are evaluated once per graph). See lib/monaco/setup.ts.
import "@/lib/monaco/setup";
import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { runCode, type RunResult } from "@/runtimes/index";
import { useActiveTheme } from "@/theme/useActiveTheme";
import { MONACO_THEME_BY_APP_THEME } from "@/theme/monaco-themes/index";
import type { LanguageId } from "@/data/types";
import { useT } from "@/i18n/i18n";
import "./InlineSandbox.css";

interface Props {
  /// Primary language the snippet runs in. Matches the fenced code
  /// block's info string (e.g. ```rust playground → language="rust").
  language: LanguageId;
  /// Starter code (already decoded from the base64 payload in the
  /// markdown renderer). The editor seeds with this value on mount
  /// and tracks local edits; there's no persistence — each inline
  /// sandbox resets to the starter on lesson re-render.
  initialCode: string;
}

const VALID_LANGS: readonly LanguageId[] = [
  "javascript",
  "typescript",
  "python",
  "rust",
  "swift",
  "go",
];

/// Small Monaco + Run button + output strip embedded in prose. Meant for
/// "try it" snippets — no tests, no solution, no state persisted. When
/// the lesson re-renders the sandbox re-mounts and loses its edits,
/// which is the right trade-off: the whole point is a scratch sandbox,
/// not a workspace.
export default function InlineSandbox({ language, initialCode }: Props) {
  const t = useT();
  const [code, setCode] = useState<string>(initialCode);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const activeTheme = useActiveTheme();
  const monacoTheme = MONACO_THEME_BY_APP_THEME[activeTheme];

  // Defensively coerce unexpected languages to plaintext-ish run. The
  // markdown renderer already filters to known infostrings but this is
  // a thin extra guard before invoking the runtime dispatcher.
  const safeLang: LanguageId = useMemo(
    () => (VALID_LANGS.includes(language) ? language : "javascript"),
    [language],
  );

  async function handleRun() {
    setRunning(true);
    setResult(null);
    try {
      const r = await runCode(safeLang, code);
      setResult(r);
    } finally {
      setRunning(false);
    }
  }

  function handleReset() {
    setCode(initialCode);
    setResult(null);
  }

  // Line count drives the editor height so we don't leave a giant empty
  // box for a 3-line snippet. Cap so a 20-line "try it" still scrolls
  // rather than pushing the prose below it off-screen. The trailing
  // `+ 24` pixels accounts for the editor's vertical padding (10 top
  // + 10 bottom set in `padding` below, plus a small fudge) so the
  // last line never gets clipped against the bottom border.
  const lineCount = Math.max(3, Math.min(code.split("\n").length, 12));
  const editorHeight = `${lineCount * 18 + 24}px`;

  return (
    <div className="libre-inline-sandbox-root">
      <div className="libre-inline-sandbox-header">
        <span className="libre-inline-sandbox-lang">{safeLang}</span>
        <span className="libre-inline-sandbox-label">{t("sandbox.tryIt")}</span>
        <div className="libre-inline-sandbox-actions">
          <button
            type="button"
            className="libre-inline-sandbox-btn"
            onClick={handleReset}
          >
            {t("sandbox.resetLower")}
          </button>
          <button
            type="button"
            className="libre-inline-sandbox-btn libre-inline-sandbox-btn--run"
            onClick={handleRun}
            disabled={running}
          >
            {running ? t("sandbox.runningLower") : t("editor.run")}
          </button>
        </div>
      </div>
      <div
        className="libre-inline-sandbox-editor"
        style={{ height: editorHeight }}
      >
        <Editor
          height="100%"
          language={safeLang}
          value={code}
          theme={monacoTheme}
          onChange={(v) => setCode(v ?? "")}
          options={{
            minimap: { enabled: false },
            fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
            fontSize: 12.5,
            scrollBeyondLastLine: false,
            lineNumbers: "off",
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            // Monaco's `padding` option is vertical-only. Horizontal
            // breathing room comes from the parent's CSS padding so
            // long lines have a visible gutter against the panel
            // border. Bumped vertical padding too — the original 6px
            // sat the first line right against the header divider.
            padding: { top: 10, bottom: 10 },
            renderLineHighlight: "none",
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: { vertical: "auto", horizontal: "auto" },
          }}
        />
      </div>
      {(result || running) && (
        <div className="libre-inline-sandbox-output">
          {running && (
            <div className="libre-inline-sandbox-out-hint">
              {t("sandbox.runningLower")}
            </div>
          )}
          {result && (
            <>
              {result.error && (
                <div className="libre-inline-sandbox-out-error">
                  {result.error}
                </div>
              )}
              {result.logs.map((line, i) => (
                <div
                  key={i}
                  className={`libre-inline-sandbox-out-line libre-inline-sandbox-out-line--${line.level}`}
                >
                  {line.text}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
