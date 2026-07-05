/// Fill-the-Gap (cloze) — one meaningful token is blanked out of the
/// solution and the learner picks what completes it from four
/// same-class candidates. Pure recognition, one tap: the blank is a
/// gap decoration punched into REAL code, the options are large tap
/// targets below. Correct → the gap fills with the token; wrong →
/// the learner's pick is flagged and the correct option + filled gap
/// are revealed anyway (the reveal IS the teaching).
///
/// The code renders in a read-only Monaco editor — the same engine
/// the Workbench uses — so the snippet is genuinely syntax-
/// highlighted in the app's editor theme and the gap reads as a hole
/// in native code rather than a styled <span> in fake code. Monaco
/// loads lazily (it's already in the bundle graph for the Workbench /
/// Monkey's Paw); until it mounts we render the previous plain-text
/// markup as the loading fallback so slow connections still get an
/// instantly usable card.
///
/// Mirrors the spotbug/parsons card contract (committed / result /
/// onResult) so the session runner + SRS drive it uniformly. The
/// option order arrives pre-shuffled (seeded in `makeClozePuzzle`),
/// so re-renders never reshuffle mid-attempt.

import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { useT } from "@/i18n/i18n";
import { useActiveTheme } from "@/theme/useActiveTheme";
import { MONACO_THEME_BY_APP_THEME } from "@/theme/monaco-themes/index";
import type { LanguageId } from "@/data/types";
import type { PracticeItem } from "./types";
import "@base/primitives/icon/icon.css";
import "./PracticeCloze.css";

interface Props {
  /// The cloze payload off the harvested `PracticeItem`. `blankStart`
  /// / `blankLen` index into the ORIGINAL text of `lines[blankLine]`.
  cloze: NonNullable<PracticeItem["cloze"]>;
  /// Course language — drives Monaco's tokenizer. Optional; falls
  /// back to plaintext (still native chrome, just uncoloured).
  language?: LanguageId;
  committed: boolean;
  result?: "correct" | "wrong";
  onResult: (correct: boolean) => void;
}

/// LanguageId → Monaco language id. Monaco ships most of these
/// built in; the hand-rolled Monarch grammars (svelte / solidity)
/// are registered by lib/monaco/setup. Anything unknown renders
/// as plaintext rather than throwing.
const MONACO_LANG: Partial<Record<LanguageId, string>> = {
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
  ruby: "ruby",
  lua: "lua",
  dart: "dart",
  sql: "sql",
  scala: "scala",
  elixir: "elixir",
  clojure: "clojure",
  fsharp: "fsharp",
  assembly: "mips",
  solidity: "solidity",
  svelte: "svelte",
  vyper: "python",
  bun: "typescript",
  tauri: "typescript",
  web: "html",
  htmx: "html",
  react: "javascript",
  reactnative: "typescript",
  solid: "javascript",
  threejs: "javascript",
  astro: "html",
  zig: "rust",
  move: "rust",
  cairo: "rust",
  sway: "rust",
};

const LINE_HEIGHT = 20;
const V_PADDING = 12;

export default function PracticeCloze({
  cloze,
  language,
  committed,
  onResult,
}: Props) {
  const t = useT();
  const { lines, blankLine, blankStart, blankLen, answer, options, category } =
    cloze;
  const [picked, setPicked] = useState<string | null>(null);
  const activeTheme = useActiveTheme();
  const monacoTheme = MONACO_THEME_BY_APP_THEME[activeTheme];
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const [mounted, setMounted] = useState(false);
  // Monaco's loader wiring (bundled instance + workers) lives in
  // @/lib/monaco/setup. Imported LAZILY: its `?worker` URL imports
  // are vite-only syntax that vitest's resolver rejects, so a static
  // import would break every suite that renders this card. In jsdom
  // the dynamic import rejects (caught) and the card permanently
  // renders the plain fallback — which is exactly what UI tests
  // assert against. In the app it resolves from cache instantly.
  const [setupReady, setSetupReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/monaco/setup")
      .then(() => {
        if (!cancelled) setSetupReady(true);
      })
      .catch(() => {
        /* test env / failed chunk — plain fallback stays up */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function pick(opt: string) {
    if (committed) return;
    setPicked(opt);
    onResult(opt === answer);
  }

  // Editor text: the solution with the blank either punched out
  // (underscores sized to the hidden token) or, once committed,
  // restored — Monaco re-tokenizes the filled line so the reveal
  // gets real highlighting too.
  const gapText = "_".repeat(Math.max(4, blankLen));
  const value = useMemo(() => {
    const out = [...lines];
    const line = out[blankLine] ?? "";
    out[blankLine] =
      line.slice(0, blankStart) +
      (committed ? answer : gapText) +
      line.slice(blankStart + blankLen);
    return out.join("\n");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, blankLine, blankStart, blankLen, committed, answer]);

  // Gap decoration — dashed amber chip while open, green fill on the
  // revealed answer. Re-applied whenever the value flips.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !mounted) return;
    const len = committed ? answer.length : gapText.length;
    const range = new monaco.Range(
      blankLine + 1,
      blankStart + 1,
      blankLine + 1,
      blankStart + 1 + len,
    );
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
      {
        range,
        options: {
          inlineClassName: committed
            ? "libre-cloze-deco--filled"
            : "libre-cloze-deco--gap",
          stickiness: 1,
        },
      },
    ]);
  }, [mounted, committed, value, blankLine, blankStart, answer, gapText]);

  // Height: one row per line plus an allowance for soft-wrapped rows
  // (wordWrap is on so long println! lines never clip the gap off
  // screen on a phone). ~34 chars fit per row at this font size on
  // the narrowest supported viewport.
  const wrapRows = lines.reduce(
    (n, l) => n + Math.max(0, Math.ceil(l.length / 34) - 1),
    0,
  );
  const height = (lines.length + wrapRows) * LINE_HEIGHT + V_PADDING * 2;

  /// Pre-Monaco fallback — the previous plain renderer, kept so the
  /// card is readable + answerable the instant it appears.
  const plainFallback = (
    <ol className="libre-cloze__list" aria-hidden>
      {lines.map((line, i) => (
        <li
          key={i}
          className={"libre-cloze__line" + (i === blankLine ? " is-gap" : "")}
        >
          <span className="libre-cloze__num">{i + 1}</span>
          {i === blankLine ? (
            <code className="libre-cloze__code">
              {line.slice(0, blankStart)}
              <span
                className={
                  "libre-cloze__blank" + (committed ? " is-filled" : "")
                }
                style={{ minWidth: `${Math.max(3, blankLen)}ch` }}
              >
                {committed ? answer : ""}
              </span>
              {line.slice(blankStart + blankLen)}
            </code>
          ) : (
            <code className="libre-cloze__code">{line}</code>
          )}
        </li>
      ))}
    </ol>
  );

  return (
    <div className="libre-cloze">
      <div className="libre-cloze__hint">{t("practice.clozePrompt")}</div>
      <div className="libre-cloze__editor" style={{ height: `${height}px` }}>
        {!setupReady ? (
          plainFallback
        ) : (
        <Editor
          height="100%"
          language={
            (language && MONACO_LANG[language]) || "plaintext"
          }
          value={value}
          theme={monacoTheme}
          loading={plainFallback}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            setMounted(true);
          }}
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
            fontSize: 13,
            lineHeight: LINE_HEIGHT,
            padding: { top: V_PADDING, bottom: V_PADDING },
            scrollBeyondLastLine: false,
            scrollbar: {
              vertical: "hidden",
              horizontal: "auto",
              handleMouseWheel: false,
              alwaysConsumeMouseWheel: false,
            },
            lineNumbers: "on",
            lineNumbersMinChars: 2,
            glyphMargin: false,
            folding: false,
            renderLineHighlight: "none",
            occurrencesHighlight: "off",
            selectionHighlight: false,
            contextmenu: false,
            links: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            wordWrap: "on",
            automaticLayout: true,
          }}
        />
        )}
      </div>
      <div className="libre-cloze__options">
        {options.map((opt) => {
          const isAnswer = opt === answer;
          const isMissedPick = committed && opt === picked && !isAnswer;
          const klass = [
            "libre-cloze__option",
            committed && isAnswer ? "is-correct" : "",
            isMissedPick ? "is-wrong" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={opt}
              type="button"
              className={klass}
              onClick={() => pick(opt)}
              disabled={committed}
            >
              <code>{opt}</code>
              {committed && isAnswer && (
                <span className="libre-cloze__mark libre-cloze__mark--right">
                  <Icon icon={checkIcon} size="xs" color="currentColor" />
                </span>
              )}
              {isMissedPick && (
                <span className="libre-cloze__mark libre-cloze__mark--miss">
                  <Icon icon={xIcon} size="xs" color="currentColor" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {committed && (
        <div className="libre-cloze__reveal">
          <span className="libre-cloze__reveal-icon" aria-hidden>
            <Icon icon={checkIcon} size="xs" color="currentColor" />
          </span>
          {t("practice.clozeReveal", { answer, category })}
        </div>
      )}
    </div>
  );
}
