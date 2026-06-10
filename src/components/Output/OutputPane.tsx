import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@base/primitives/icon";
import { check } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { externalLink } from "@base/primitives/icon/icons/external-link";
import { copy as copyIcon } from "@base/primitives/icon/icons/copy";
import { refreshCw } from "@base/primitives/icon/icons/refresh-cw";
import "@base/primitives/icon/icon.css";
import type { RunResult } from "../../runtimes";
import { testSourceByName } from "../../lib/parseTestSource";
import { highlightCode } from "../../lib/highlightCode";
import ReactNativeDevTools from "./ReactNativeDevTools";
import GearSpinner from "../Shared/GearSpinner";
import MissingToolchainBanner from "../banners/MissingToolchain/MissingToolchainBanner";
import { DesktopUpsellBanner } from "../banners/DesktopUpsell/DesktopUpsellBanner";
import { useToolchainStatus } from "../../hooks/useToolchainStatus";
import { useT } from "../../i18n/i18n";
import "./OutputPane.css";

interface Props {
  result: RunResult | null;
  running: boolean;
  /// When true, skip the missing-toolchain banner + the raw-error card
  /// that would otherwise render when a run fails with a launch_error.
  /// The lesson view sets this once it's already showing a proactive
  /// toolchain banner above the workbench — without the flag the user
  /// would see the banner twice (above + below the editor) for the
  /// same underlying problem.
  suppressToolchainBanner?: boolean;
  /// Language of the current run. Drives the progressive-status labels
  /// shown under the spinner while `running` is true
  /// ("loading kotlin…" → "compiling…" → "running…" → "checking tests…").
  /// Omitted when we don't know it yet — the spinner falls back to a
  /// generic "running…".
  language?: string;
  /// Whether the current run expects test results. Adds a "checking
  /// tests…" label at the tail of the progress sequence so a slow test
  /// harness doesn't feel stuck on "running…".
  testsExpected?: boolean;
  /// The lesson's raw test source (its `tests` string). When provided, each
  /// test result gets a "view test" button that reveals the exact code that
  /// test runs — matched to the result by NAME (async results settle out of
  /// definition order, so index matching would be wrong). Omitted for runs
  /// without tests.
  testSource?: string;
}

// Progress-label tuning. We don't have real phase events from the
// runtimes yet, so we fake them with time gates that roughly match
// each language's actual behaviour. Compiled languages earn a
// "compiling…" segment; interpreted ones skip straight to "running…"
// once the runtime has warmed up.
interface ProgressPhase {
  label: string;
  afterMs: number;
}
const COMPILED_LANGS = new Set([
  "rust",
  "go",
  "swift",
  "c",
  "cpp",
  "java",
  "kotlin",
  "assembly",
]);
function progressPhases(language?: string, testsExpected?: boolean): ProgressPhase[] {
  const langLabel = language ? languageLabel(language) : null;
  const isCompiled = language ? COMPILED_LANGS.has(language) : false;
  const phases: ProgressPhase[] = [
    { label: langLabel ? `loading ${langLabel}…` : "starting…", afterMs: 0 },
  ];
  if (isCompiled) {
    phases.push({ label: "compiling…", afterMs: 600 });
    phases.push({ label: "running…", afterMs: 4500 });
  } else {
    phases.push({ label: "running…", afterMs: 700 });
  }
  if (testsExpected) {
    phases.push({ label: "checking tests…", afterMs: isCompiled ? 7500 : 2500 });
  }
  return phases;
}
function languageLabel(id: string): string {
  switch (id) {
    case "javascript": return "JavaScript";
    case "typescript": return "TypeScript";
    case "python": return "Python";
    case "rust": return "Rust";
    case "go": return "Go";
    case "swift": return "Swift";
    case "c": return "C";
    case "cpp": return "C++";
    case "java": return "Java";
    case "kotlin": return "Kotlin";
    case "csharp": return "C#";
    case "assembly": return "Assembly";
    case "web": return "preview";
    case "threejs": return "Three.js";
    case "react": return "React";
    case "reactnative": return "React Native";
    default: return id;
  }
}

/// Bottom-right pane. Renders structured runtime output: captured
/// console logs, errors, and — when the lesson has hidden tests —
/// per-test pass/fail lines. Web-runtime results surface a "Preview"
/// card with the local URL + "Open in browser" / "Copy link" buttons;
/// the rendered page itself lives in the user's real browser so they
/// get DevTools + correct origin semantics.
export default function OutputPane({
  result,
  running,
  suppressToolchainBanner = false,
  language,
  testsExpected,
  testSource,
}: Props) {
  const t = useT();
  const passedCount = result?.tests?.filter((t) => t.passed).length ?? 0;
  const totalTests = result?.tests?.length ?? 0;
  // `allPassed` was used by the now-retired summary chip in the
  // header right; the Tests tab badge ({passed}/{total}) carries the
  // same signal. Kept counts above as plain numbers for the badge.
  const previewUrl = result?.previewUrl;
  const previewKind = result?.previewKind;

  // When the native runner reports a missing toolchain (binary not on
  // PATH, or the macOS `java` stub bailing out to java.com), hit the
  // same `probe_language_toolchain` command the Playground uses — that
  // gives us the structured install hint the banner renders. The
  // `tcRefresh` counter re-runs the probe after a successful install,
  // which clears the banner and lets the learner click Run again.
  //
  // We intentionally DON'T gate on `toolchainStatus.installed === false`
  // here — the probe only checks "does the binary exist on PATH", and
  // for Kotlin/Java it'll cheerfully report installed=true when in
  // reality the stub can't run a program (no JDK). The actual run is
  // the authoritative signal: if `missingToolchainLanguage` came back,
  // the toolchain is broken in practice. We just need the install hint
  // from the probe to populate the banner's button.
  const [tcRefresh, setTcRefresh] = useState(0);
  const missingLang = result?.missingToolchainLanguage ?? null;
  const { status: toolchainStatus } = useToolchainStatus(
    missingLang ?? "",
    tcRefresh,
  );
  const showToolchainBanner =
    !suppressToolchainBanner &&
    !!missingLang &&
    !!toolchainStatus &&
    !!toolchainStatus.install_hint;

  // Progressive status label. We don't have real phase callbacks from
  // the runtimes, so we time-gate labels off a timer that starts the
  // moment `running` flips true. The phase table per language is
  // rough-tuned: compiled langs get an explicit "compiling…" segment,
  // interpreted ones skip straight to "running…" once the runtime has
  // warmed up.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!running) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 250);
    return () => window.clearInterval(id);
  }, [running]);
  const currentPhase = (() => {
    const phases = progressPhases(language, testsExpected);
    let chosen = phases[0];
    for (const p of phases) {
      if (elapsedMs >= p.afterMs) chosen = p;
    }
    return chosen;
  })();

  // Small copy-to-clipboard affordance on the URL card. We track the
  // "just copied" flash in local state so the button can briefly swap
  // to a check mark without needing a toast system.
  const [copied, setCopied] = useState(false);
  // Cache-busting key for the iframe: incremented each time a new
  // previewUrl result arrives so the iframe reloads even though the
  // URL is stable (the server swaps the HTML under the same URL).
  // The Refresh button also bumps this for manual reloads.
  const [reloadTick, setReloadTick] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Live console output from the preview iframe. The web / react /
  // threejs / reactnative runtimes inject a CONSOLE_SHIM into their
  // HTML that intercepts `console.*` calls + window 'error' +
  // 'unhandledrejection' events and posts them to the parent
  // window via `postMessage({ __libre: true, level, text })`. We
  // listen here, accumulate the logs into a per-iframe buffer,
  // and render them in the Console tab so the user can SEE their
  // `console.log` output, runtime exceptions, syntax errors from
  // Babel/createRoot — everything that used to vanish into the
  // void because nothing was listening for these messages.
  //
  // Buffer resets on every `reloadTick` change because that's
  // when a fresh iframe mounts and we want a clean slate.
  const [liveLogs, setLiveLogs] = useState<
    Array<{ level: "log" | "info" | "warn" | "error"; text: string; ts: number }>
  >([]);
  useEffect(() => {
    setLiveLogs([]);
  }, [reloadTick, previewUrl]);
  useEffect(() => {
    if (!previewUrl) return;
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as {
        __libre?: boolean;
        level?: string;
        text?: string;
      } | null;
      if (!d || !d.__libre) return;
      const level = (
        ["log", "info", "warn", "error"].includes(d.level ?? "")
          ? d.level
          : "log"
      ) as "log" | "info" | "warn" | "error";
      setLiveLogs((prev) => [
        ...prev,
        { level, text: d.text ?? "", ts: Date.now() },
      ]);
      // Also broadcast to the rest of the app — the agent's
      // console pane subscribes to this so it can see runtime
      // errors emitted AFTER the run tool completed (createRoot
      // failures, useEffect throws, etc.). Without this the
      // agent thinks its build succeeded just because runFiles
      // returned without an error, but the iframe is actually
      // showing a red error overlay.
      window.dispatchEvent(
        new CustomEvent("libre:preview-log", {
          detail: { level, text: d.text ?? "" },
        }),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewUrl]);

  // ── Console / Tests tab split ─────────────────────────────────────
  // Two tabs in the body when the run produced both: console output
  // (logs / debug prints / error traces) and test pills. Tabs only
  // render when both buckets exist — a logs-only run (playground) or
  // tests-only run (no debug output) skips the chrome and shows the
  // single section directly.
  type OutputTab = "console" | "tests";
  const [activeTab, setActiveTab] = useState<OutputTab>("tests");

  // Per-test source, keyed by test name, so each result row can reveal the
  // exact code it runs. Parsed once per lesson (testSource changes).
  const testSourceMap = useMemo(() => testSourceByName(testSource), [testSource]);
  // Which test rows are currently showing their source. Reset when the
  // lesson's tests change so a stale index can't reveal the wrong test.
  const [openTests, setOpenTests] = useState<Set<number>>(() => new Set());
  // Lazily Shiki-highlighted test sources, keyed by the source string so
  // identical snippets share one render and re-opening a row is instant.
  const [highlightedSrc, setHighlightedSrc] = useState<Map<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    // New lesson → collapse rows + drop cached highlights.
    setOpenTests(new Set());
    setHighlightedSrc(new Map());
  }, [testSource]);
  const toggleTest = (i: number, source?: string) => {
    const willOpen = !openTests.has(i);
    setOpenTests((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    // Highlight on first open — async, so the row shows plain text until the
    // Shiki render resolves (instant after the first call warms the grammar).
    if (willOpen && source && !highlightedSrc.has(source)) {
      void highlightCode(source).then((html) => {
        if (html) setHighlightedSrc((prev) => new Map(prev).set(source, html));
      });
    }
  };
  const hasLogs = (result?.logs?.length ?? 0) > 0;
  const hasTests = (result?.tests?.length ?? 0) > 0;
  // Show tabs whenever the run is a lesson run (testsExpected) OR
  // either pane has content. This means even a "Console is empty"
  // state still shows the Console tab — without it the user has no
  // way to confirm "yes, my code didn't print anything" vs "the
  // tab is just hidden". Earlier rule (`hasLogs && hasTests`) hid
  // tabs whenever one bucket was empty, which made the split feel
  // inconsistent.
  const showTabs = !!testsExpected || hasLogs || hasTests;
  // Auto-pick a sensible default whenever a NEW result lands. Lessons
  // (testsExpected) start on Tests so the pass/fail badges are the
  // first thing you see; a failing run flips to Tests too even if
  // the user was looking at Console (so they don't miss the red
  // pill). Logs-only / playground runs land on Console.
  const failingCount = result?.tests?.filter((t) => !t.passed).length ?? 0;
  useEffect(() => {
    if (!result) return;
    // Preview-with-logs case: keep the user on Preview by default
    // (that's what they expect to see for a React / Three.js run).
    // The Console tab stays available via the toggle in the header
    // but doesn't auto-claim focus the way it does for log-only
    // runs.
    if (previewUrl) {
      setActiveTab("tests");
      return;
    }
    if (hasTests && (testsExpected || failingCount > 0)) {
      setActiveTab("tests");
    } else if (hasLogs && !hasTests) {
      setActiveTab("console");
    } else if (hasTests && !hasLogs) {
      setActiveTab("tests");
    }
    // Intentionally only re-run on the result identity (durationMs
    // is monotonically distinct per run); switching tab via the user
    // shouldn't re-fire this default-picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.durationMs]);

  // Brief green "you passed" pulse on the pane when a NEW result lands
  // with tests that all passed. Subtle glow flash (no confetti — those
  // were retired as too much); pairs with the `success` cue LessonView
  // fires on the same pass.
  const [passPulse, setPassPulse] = useState(false);
  useEffect(() => {
    if (result && hasTests && failingCount === 0) {
      setPassPulse(true);
      const id = window.setTimeout(() => setPassPulse(false), 750);
      return () => window.clearTimeout(id);
    }
    setPassPulse(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.durationMs]);

  // Whenever the result flips to a new timestamp, reload the iframe
  // so the user sees the latest render without needing to reach for
  // the reload button manually. We key off durationMs as a cheap
  // "this is a new result" signal — it monotonically differs per run.
  useEffect(() => {
    if (previewUrl) setReloadTick((n) => n + 1);
  }, [previewUrl, result?.durationMs]);

  const openInBrowser = () => {
    if (!previewUrl) return;
    // tauri-plugin-opener is wired at the app level and is the only
    // reliable way to open an external URL from a Tauri webview. If we
    // end up running in the vite-dev web preview (no Tauri host), the
    // invoke rejects — fall back to window.open so the dev loop stays
    // usable.
    invoke("plugin:opener|open_url", { url: previewUrl }).catch(() => {
      try {
        window.open(previewUrl, "_blank", "noopener,noreferrer");
      } catch {
        /* nothing sensible to do */
      }
    });
  };

  const copyLink = async () => {
    if (!previewUrl) return;
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard write may fail without user-gesture permission — silent */
    }
  };

  return (
    <div
      className={`libre-output${passPulse ? " libre-output--pass-pulse" : ""}`}
    >
      <div className="libre-output-header">
        {/* Header left side: tabs when this is a multi-pane output
            (Console + Tests), otherwise the static label. The
            tabs-in-header treatment matches editors / browser
            devtools where the active subview is the dominant chrome
            element rather than tucked under a generic "output" word. */}
        {showTabs && !previewUrl ? (
          <div
            className="libre-output-tabs"
            role="tablist"
            aria-label={t("output.ariaLabel")}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "console"}
              className={`libre-output-tab ${
                activeTab === "console" ? "libre-output-tab--active" : ""
              }`}
              onClick={() => setActiveTab("console")}
            >
              <span>{t("output.consoleTab")}</span>
              {hasLogs && (
                <span className="libre-output-tab-badge">
                  {result?.logs?.length ?? 0}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "tests"}
              className={`libre-output-tab ${
                activeTab === "tests" ? "libre-output-tab--active" : ""
              } ${
                failingCount > 0
                  ? "libre-output-tab--has-failures"
                  : ""
              }`}
              onClick={() => setActiveTab("tests")}
            >
              <span>{t("output.testsTab")}</span>
              {hasTests && (
                <span
                  className={`libre-output-tab-badge ${
                    failingCount > 0
                      ? "libre-output-tab-badge--fail"
                      : "libre-output-tab-badge--pass"
                  }`}
                >
                  {passedCount}/{totalTests}
                </span>
              )}
            </button>
          </div>
        ) : previewUrl ? (
          // Preview mode — surface a Browser / Console segmented
          // toggle so the user isn't blind to `console.log` output
          // their React (or other web-runtime) code emitted. The
          // toggle is rendered for EVERY preview-producing run
          // (not just ones with existing logs) because users
          // commonly add `console.log` after first paint, see the
          // preview render, then want to flip to console without
          // re-running. The Console tab shows a per-run empty
          // state when nothing was logged.
          //
          // The console badge counts EITHER tool-result logs
          // (synchronous output captured at run time) OR live
          // postMessage logs streaming in from the iframe (async
          // — `console.log` from a click handler, an uncaught
          // exception 2 seconds after mount, etc.). Both are
          // visible in the Console tab; the badge sums both so
          // the user has one number to glance at.
          <div
            className="libre-output-mode-toggle"
            role="group"
            aria-label={t("output.ariaLabel")}
          >
            <button
              type="button"
              aria-pressed={activeTab !== "console"}
              className={`libre-output-mode-btn ${
                activeTab !== "console" ? "libre-output-mode-btn--active" : ""
              }`}
              onClick={() => setActiveTab("tests")}
            >
              browser
            </button>
            <button
              type="button"
              aria-pressed={activeTab === "console"}
              className={`libre-output-mode-btn ${
                activeTab === "console" ? "libre-output-mode-btn--active" : ""
              }`}
              onClick={() => setActiveTab("console")}
            >
              console
              {(hasLogs || liveLogs.length > 0) && (
                <span
                  className={`libre-output-mode-btn-badge ${
                    liveLogs.some((l) => l.level === "error")
                      ? "libre-output-mode-btn-badge--error"
                      : ""
                  }`}
                >
                  {(result?.logs?.length ?? 0) + liveLogs.length}
                </span>
              )}
            </button>
          </div>
        ) : (
          <span className="libre-output-label">
            {previewUrl ? t("output.previewLabel") : t("output.consoleLabel")}
          </span>
        )}
        <div className="libre-output-header-right">
          {result && !running && (
            <span className="libre-output-duration">{result.durationMs.toFixed(0)}ms</span>
          )}
          {running && (
            <span className="libre-output-running-pill">
              <span className="libre-output-running-pill-dot" aria-hidden />
              {currentPhase.label}
            </span>
          )}
          {/* Preview action cluster — slotted into the same header
              as console/tests so the controls match the editor's
              header treatment. Only renders when the current run
              produced a previewUrl. Buttons are icon-only here
              (with title/aria for affordance) so all three fit
              compactly next to the duration pill. */}
          {previewUrl && (
            <div className="libre-output-preview-actions">
              <button
                type="button"
                className="libre-output-preview-btn"
                onClick={openInBrowser}
                title={previewUrl}
                aria-label="Open preview in browser"
              >
                <Icon icon={externalLink} size="xs" color="currentColor" />
                <span>Open in browser</span>
              </button>
              <button
                type="button"
                className="libre-output-preview-btn"
                onClick={copyLink}
                aria-label={copied ? "Copied" : "Copy preview link"}
              >
                <Icon
                  icon={copied ? check : copyIcon}
                  size="xs"
                  color="currentColor"
                />
                <span>{copied ? "Copied" : "Copy link"}</span>
              </button>
              <button
                type="button"
                className="libre-output-preview-btn"
                onClick={() => setReloadTick((n) => n + 1)}
                title={t("output.reloadPreviewTitle")}
                aria-label="Reload preview"
              >
                <Icon icon={refreshCw} size="xs" color="currentColor" />
                <span>Reload</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className={`libre-output-body ${
          previewUrl && activeTab !== "console" ? "libre-output-body--preview" : ""
        }`}
      >
        {/* Generic "no run yet" placeholder is only useful when
            there are NO tabs to show their own per-pane empty
            messages. With tabs visible (lesson runs, prior
            output, prior tests), each tab renders its own context-
            specific empty state ("No console output. Add …",
            "Run your code — test results will appear here.") and
            doubling that with this generic line read as
            duplicated copy. */}
        {!result && !running && !showTabs && (
          <div className="libre-output-empty">{t("output.outputPlaceholder")}</div>
        )}

        {running && (
          // Big centered run indicator — two interlocking gears
          // counter-rotating (GearSpinner), "the machine is working".
          // currentColor-driven so it follows the theme.
          <div className="libre-output-running" aria-live="polite">
            <div className="libre-output-running-stack" aria-hidden>
              <GearSpinner size={84} />
            </div>
            <div className="libre-output-running-label">{currentPhase.label}</div>
          </div>
        )}

        {/* Web-runtime preview. The iframe fills the entire output
            body — no inner card, no URL row, no actions row. The
            Open-in-browser / Copy-link / Reload buttons live in the
            shared output header alongside the duration pill, mirroring
            the editor's header treatment. Both point at the same local
            tiny_http URL — the iframe just embeds it.
            Hidden when the user toggled to the Console tab so the
            log list takes over the body. The iframe element stays
            in the React tree (we just hide via CSS) so toggling
            back to Preview doesn't reload the page. */}
        {previewUrl && (
          <div
            className={`libre-output-preview-fill ${
              previewKind === "reactnative"
                ? "libre-output-preview-fill--rn"
                : ""
            } ${activeTab === "console" ? "libre-output-preview-fill--hidden" : ""}`}
            role="status"
          >
            <iframe
              ref={iframeRef}
              key={`${previewUrl}#${reloadTick}`}
              className={`libre-output-preview-iframe ${
                previewKind === "reactnative"
                  ? "libre-output-preview-iframe--rn"
                  : ""
              }`}
              title={t("output.previewIframeTitle")}
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
            {previewKind === "reactnative" && (
              <ReactNativeDevTools previewUrl={previewUrl} />
            )}
          </div>
        )}

        {/* Console pane. Visible when:
            - tabs not shown AND there are logs (single-section run)
            - tabs shown AND user picked the Console tab — even if
              empty, so they can confirm "no output" rather than
              wondering whether the section is hiding.
            Now merges TWO sources:
            - `result.logs` — synchronous output captured by the
              runner before it returned (`console.log` during top-
              level execution, build errors).
            - `liveLogs` — async output streamed in from the live
              preview iframe (`console.log` from click handlers,
              runtime exceptions, the SyntaxError that fires
              AFTER the runtime resolved its previewUrl). Without
              merging both buckets the user can't see why their
              React preview shows a blank page when the iframe
              threw `createRoot is not found`. */}
        {((!showTabs && hasLogs) ||
          (showTabs && activeTab === "console") ||
          (previewUrl && activeTab === "console")) && (
          <div className="libre-output-console">
            {hasLogs || liveLogs.length > 0 ? (
              <>
                {(result?.logs ?? []).map((line, i) => (
                  <div
                    key={`log-${i}`}
                    className={`libre-output-line libre-output-line--${line.level}`}
                  >
                    {line.text}
                  </div>
                ))}
                {liveLogs.map((line, i) => (
                  <div
                    key={`live-${i}`}
                    className={`libre-output-line libre-output-line--${line.level}`}
                  >
                    {line.text}
                  </div>
                ))}
              </>
            ) : (
              <div className="libre-output-pane-empty">
                {previewUrl
                  ? "No console output yet. Anything your preview's code logs (or any runtime errors) will appear here."
                  : (
                    <>
                      No console output. Add{" "}
                      <code>std.debug.print(...)</code>{" "}
                      <span className="libre-output-pane-empty-hint">
                        (or your language's print) inside your code to see
                        output here.
                      </span>
                    </>
                  )}
              </div>
            )}
          </div>
        )}

        {/* Tests pane. Same visibility rule mirrored — render an
            empty-state when tabs are visible and there are no tests
            (e.g. a lesson where the runner returned no results) so
            the tab isn't a dead end. */}
        {((!showTabs && hasTests) || (showTabs && activeTab === "tests")) && (
          <div className="libre-output-tests">
            {hasTests ? (
              result!.tests!.map((t, i) => {
                // Match the source to this result by NAME (async results
                // settle out of definition order). Fall back to the whole
                // test file if a specific block couldn't be isolated.
                const source = testSourceMap.get(t.name) ?? testSource;
                const open = openTests.has(i);
                return (
                  <div
                    key={`t-${i}`}
                    className={`libre-output-test libre-output-test--${t.passed ? "pass" : "fail"}`}
                  >
                    <span className="libre-output-test-glyph">
                      <Icon
                        icon={t.passed ? check : xIcon}
                        size="xs"
                        color="currentColor"
                        weight="bold"
                      />
                    </span>
                    <div className="libre-output-test-head">
                      <span className="libre-output-test-name">{t.name}</span>
                      {source && (
                        <button
                          type="button"
                          className="libre-output-test-view"
                          aria-expanded={open}
                          onClick={() => toggleTest(i, source)}
                          title="Show the code this test runs"
                        >
                          {open ? "hide test" : "view test"}
                        </button>
                      )}
                    </div>
                    {!t.passed && t.error && (
                      <pre className="libre-output-test-error">{t.error}</pre>
                    )}
                    {open &&
                      source &&
                      (highlightedSrc.has(source) ? (
                        <div
                          className="libre-output-test-codeblock libre-code-block"
                          dangerouslySetInnerHTML={{
                            __html: highlightedSrc.get(source)!,
                          }}
                        />
                      ) : (
                        <pre className="libre-output-test-source">
                          <code>{source}</code>
                        </pre>
                      ))}
                  </div>
                );
              })
            ) : (
              <div className="libre-output-pane-empty">
                {testsExpected
                  ? "Run your code — test results will appear here."
                  : "This lesson doesn't have automated tests."}
              </div>
            )}
          </div>
        )}

        {result?.desktopOnly && (
          // Web build: this language's runtime needs the desktop app.
          // Render the upsell instead of logs / tests / errors. The
          // tests + logs arrays are empty in this case (the gate in
          // runtimes/index.ts returns a synthetic RunResult) so the
          // rest of the pane already renders nothing.
          <DesktopUpsellBanner
            language={result.desktopOnly.language}
            reason={result.desktopOnly.reason}
          />
        )}

        {showToolchainBanner && toolchainStatus && (
          // The run failed specifically because the toolchain isn't
          // installed — render the install-button banner in place of
          // the raw stderr dump so the learner has a one-click path
          // to "make this run work". The generic error block below
          // is suppressed in this case (its content is just the macOS
          // stub message, which the banner replaces with the actual
          // `brew install …` command).
          //
          // Force `installed: false` on the status we hand to the
          // banner. The probe reports `kotlinc` / `java` as installed
          // when the stubs exist on PATH, even though the actual
          // compile step we just ran failed because there's no JDK.
          // The run is the source of truth — the banner's own
          // "installed → don't render" guard must see what the run saw.
          <MissingToolchainBanner
            status={{ ...toolchainStatus, installed: false }}
            onInstalled={() => setTcRefresh((n) => n + 1)}
          />
        )}

        {result?.error && !showToolchainBanner && !(suppressToolchainBanner && missingLang) && (
          <div className="libre-output-error">
            <div className="libre-output-error-title">error</div>
            <pre>{result.error}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
