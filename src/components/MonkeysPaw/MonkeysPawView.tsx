/// Monkey's Paw — adversarial test-writing duels.
///
/// The learner writes ONLY tests ("the contract"); the Paw answers
/// each summon with the laziest implementation in its hand-authored
/// cheat ladder that still passes the suite ("the grant"). Victory =
/// the suite kills the entire ladder AND passes the hidden reference
/// (see engine.ts for the dual-oracle rules, duels.ts for content).
///
/// Runs through `runtimes/rust.ts` — local rustc on the desktop
/// build, the Rust Playground API fallback on web — so the duel is
/// fully playable on both targets.

// Side-effect import: configures @monaco-editor/react's loader for
// offline worker spawning (same import EditorPane / InlineSandbox use;
// idempotent).
import "../../lib/monaco/setup";
import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { useActiveTheme } from "../../theme/useActiveTheme";
import { MONACO_THEME_BY_APP_THEME } from "../../theme/monaco-themes";
import { runRust } from "../../runtimes/rust";
import { RUST_DUELS, findDuel } from "./duels";
import {
  summon,
  loadProgress,
  saveProgress,
  type SummonOutcome,
} from "./engine";
import "./MonkeysPaw.css";

/// Curled-finger tracker: one finger per cheat in the ladder plus a
/// thumb for the reference. Slain cheats curl their finger; the thumb
/// curls only on victory — all five down = the wish is yours.
function Fingers({
  slain,
  total,
  won,
}: {
  slain: number;
  total: number;
  won: boolean;
}) {
  return (
    <span
      className="libre-paw__fingers"
      title={`${slain} of ${total} grants slain${won ? " — contract fulfilled" : ""}`}
      aria-label={`${slain} of ${total} cheats defeated`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={
            "libre-paw__finger" +
            (i < slain ? " libre-paw__finger--curled" : "")
          }
        />
      ))}
      <span
        className={
          "libre-paw__finger libre-paw__finger--thumb" +
          (won ? " libre-paw__finger--curled" : "")
        }
      />
    </span>
  );
}

interface MonkeysPawViewProps {
  /// Return to the Practice page — the Paw lives under Practice as a
  /// practice type (no rail chip of its own), so the landing header
  /// carries the way back.
  onBack?: () => void;
}

export default function MonkeysPawView({ onBack }: MonkeysPawViewProps = {}) {
  const activeTheme = useActiveTheme();
  const monacoTheme = MONACO_THEME_BY_APP_THEME[activeTheme];

  const [openDuelId, setOpenDuelId] = useState<string | null>(null);
  const duel = findDuel(openDuelId);

  // Per-duel state, hydrated from localStorage when a duel opens.
  const [suite, setSuite] = useState("");
  const [slain, setSlain] = useState(0);
  const [rounds, setRounds] = useState(0);
  const [won, setWon] = useState(false);
  const [outcome, setOutcome] = useState<SummonOutcome | null>(null);
  const [summoning, setSummoning] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  // Landing-card refresh signal so win-stamps appear after returning.
  const [, setLedgerBump] = useState(0);

  // The latest values, readable from async summon and the unmount
  // save without stale closures. (An earlier version depended the
  // unmount effect on [slain, rounds, won] — its CLEANUP then ran on
  // every change with the previous render's values and overwrote the
  // freshly-saved victory with stale state.)
  const suiteRef = useRef(suite);
  suiteRef.current = suite;
  const progressRef = useRef({ slain, rounds, won });
  progressRef.current = { slain, rounds, won };
  const openIdRef = useRef(openDuelId);
  openIdRef.current = openDuelId;

  const openDuel = useCallback((id: string) => {
    const d = findDuel(id);
    if (!d) return;
    const saved = loadProgress(id);
    setSuite(saved?.suite ?? d.starterTests);
    setSlain(saved?.slain ?? 0);
    setRounds(saved?.rounds ?? 0);
    setWon(saved?.won ?? false);
    setOutcome(null);
    setOpenDuelId(id);
  }, []);

  const closeDuel = useCallback(() => {
    if (openDuelId) {
      saveProgress(openDuelId, {
        suite: suiteRef.current,
        slain,
        rounds,
        won,
      });
    }
    setOpenDuelId(null);
    setLedgerBump((n) => n + 1);
  }, [openDuelId, slain, rounds, won]);

  // Persist on unmount too (e.g. rail navigation away mid-duel).
  // Registered ONCE with all state read through refs — depending on
  // the live values would run the cleanup on every summon and clobber
  // the just-saved progress with the previous render's snapshot.
  useEffect(() => {
    return () => {
      const id = openIdRef.current;
      if (id) {
        saveProgress(id, {
          suite: suiteRef.current,
          ...progressRef.current,
        });
      }
    };
  }, []);

  const invoke = useCallback(async () => {
    if (!duel || summoning) return;
    setSummoning(true);
    setProgressLabel("The Paw stirs…");
    try {
      const result = await summon(duel, suiteRef.current, runRust, {
        startAt: slain,
        onProgress: ({ phase, index, total }) => {
          setProgressLabel(
            phase === "reference"
              ? "Weighing your contract against the true artifact…"
              : `Testing your contract against grant ${index + 1} of ${total}…`,
          );
        },
      });
      const nextRounds = rounds + 1;
      const nextSlain =
        result.kind === "cheat" ? result.slain : duel.cheats.length;
      const nextWon = won || result.kind === "victory";
      setOutcome(result);
      setRounds(nextRounds);
      setSlain(nextSlain);
      setWon(nextWon);
      saveProgress(duel.id, {
        suite: suiteRef.current,
        slain: nextSlain,
        rounds: nextRounds,
        won: nextWon,
      });
    } finally {
      setSummoning(false);
      setProgressLabel("");
    }
  }, [duel, summoning, slain, rounds, won]);

  // ── Landing ──────────────────────────────────────────────────
  if (!duel) {
    return (
      <div className="libre-paw">
        <header className="libre-paw__header">
          {onBack && (
            <button
              type="button"
              className="libre-paw__back"
              onClick={onBack}
            >
              ← Practice
            </button>
          )}
          <h1 className="libre-paw__title">The Monkey&rsquo;s Paw</h1>
          <span className="libre-paw__lang-chip">RUST</span>
        </header>
        <p className="libre-paw__blurb">
          You write only the tests. The Paw grants each wish with the
          laziest Rust that satisfies them — exactly, literally,
          maliciously. Corner it until the cheapest code left standing
          is the real thing.
        </p>

        <div className="libre-paw__pact">
          <div className="libre-paw__pact-step">
            <span className="libre-paw__pact-num">1</span>
            <p>
              <strong>Write the contract</strong>
              Real <code>#[test]</code> functions in real Rust — your
              suite is the only language the Paw understands.
            </p>
          </div>
          <div className="libre-paw__pact-step">
            <span className="libre-paw__pact-num">2</span>
            <p>
              <strong>Invoke the Paw</strong>
              It answers with code that passes every test you wrote —
              and honors nothing you didn&rsquo;t.
            </p>
          </div>
          <div className="libre-paw__pact-step">
            <span className="libre-paw__pact-num">3</span>
            <p>
              <strong>Close the loopholes</strong>
              Each cheat you kill curls one finger. Kill them all and
              your suite must still accept the true solution — green
              tests, honest code.
            </p>
          </div>
        </div>

        <div className="libre-paw__grid">
          {RUST_DUELS.map((d) => {
            const saved = loadProgress(d.id);
            return (
              <button
                key={d.id}
                type="button"
                className="libre-paw__card"
                onClick={() => openDuel(d.id)}
              >
                <div className="libre-paw__card-top">
                  <span
                    className={
                      "libre-paw__difficulty" +
                      (d.difficulty === "master"
                        ? " libre-paw__difficulty--master"
                        : "")
                    }
                  >
                    {d.difficulty}
                  </span>
                  <Fingers
                    slain={saved?.slain ?? 0}
                    total={d.cheats.length}
                    won={saved?.won ?? false}
                  />
                </div>
                <h2 className="libre-paw__card-title">{d.title}</h2>
                <p className="libre-paw__card-wish">&ldquo;{d.wish}&rdquo;</p>
                <div className="libre-paw__tags">
                  {d.conceptTags.map((tag) => (
                    <span key={tag} className="libre-paw__tag">
                      {tag}
                    </span>
                  ))}
                </div>
                {saved?.won && (
                  <span className="libre-paw__won-stamp">FULFILLED</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Duel screen ──────────────────────────────────────────────
  const survivingCheat =
    outcome?.kind === "cheat" ? duel.cheats[outcome.cheatIndex] : null;

  return (
    <div className="libre-paw">
      <div className="libre-paw__duel-bar">
        <button type="button" className="libre-paw__back" onClick={closeDuel}>
          ← All wishes
        </button>
        <h1 className="libre-paw__duel-title">{duel.title}</h1>
        <span className="libre-paw__rounds">
          <Fingers slain={slain} total={duel.cheats.length} won={won} />
          {rounds > 0 && <span>round {rounds}</span>}
        </span>
      </div>

      <div className="libre-paw__wish">
        <p className="libre-paw__wish-text">&ldquo;{duel.wish}&rdquo;</p>
        <ul className="libre-paw__clauses">
          {duel.clauses.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <code className="libre-paw__signature">{duel.signature}</code>
      </div>

      <div className="libre-paw__panes">
        <section className="libre-paw__pane" aria-label="Your contract">
          <div className="libre-paw__pane-head">
            <span>Your contract</span>
            <span>tests only</span>
          </div>
          <div className="libre-paw__editor">
            <Editor
              height="100%"
              language="rust"
              value={suite}
              theme={monacoTheme}
              onMount={(editor) => {
                // Dev-only automation handle — lets preview/E2E
                // tooling drive the contract editor (Monaco's model
                // isn't reachable from the page otherwise). Compiled
                // out of production builds.
                if (import.meta.env.DEV) {
                  (window as unknown as Record<string, unknown>).__pawEditor =
                    editor;
                }
              }}
              onChange={(v) => setSuite(v ?? "")}
              options={{
                minimap: { enabled: false },
                fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
                fontSize: 12.5,
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                folding: false,
                padding: { top: 10, bottom: 10 },
                renderLineHighlight: "none",
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: { vertical: "auto", horizontal: "auto" },
              }}
            />
          </div>
        </section>

        <section className="libre-paw__pane" aria-label="The Paw's grant">
          <div className="libre-paw__pane-head">
            <span>The Paw&rsquo;s grant</span>
            {survivingCheat && <span>{survivingCheat.title}</span>}
          </div>
          <div className="libre-paw__grant-body">
            {outcome === null && (
              <div className="libre-paw__grant-empty">
                <p>
                  The Paw awaits your contract.
                  <br />
                  Sign it with <strong>Invoke the Paw</strong> — and read
                  what you receive very carefully.
                </p>
              </div>
            )}

            {outcome?.kind === "cheat" && survivingCheat && (
              <>
                <div className="libre-paw__green-wrong">
                  ✓ Every test you wrote passes… over this.
                </div>
                <blockquote className="libre-paw__monologue">
                  <strong>{survivingCheat.title}</strong>
                  {survivingCheat.monologue}
                </blockquote>
                <pre className="libre-paw__grant-code">
                  {survivingCheat.code}
                </pre>
              </>
            )}

            {outcome?.kind === "unfair" && (
              <div className="libre-paw__notice libre-paw__notice--unfair">
                <strong>The contract demands the impossible.</strong> Even
                the true artifact fails{" "}
                {outcome.failures.length > 0
                  ? `your clause${outcome.failures.length > 1 ? "s" : ""}: ${outcome.failures.join(", ")}`
                  : "your suite"}
                . One of those tests asks for non-contract behavior — repair
                your own clause and invoke again.
              </div>
            )}

            {outcome?.kind === "broken" && (
              <div className="libre-paw__notice libre-paw__notice--broken">
                {"The contract itself does not hold (it fails to compile or run):\n\n" +
                  outcome.error}
              </div>
            )}

            {outcome?.kind === "victory" && (
              <div className="libre-paw__victory">
                <h3>The Paw capitulates.</h3>
                <p>
                  Every cheat lies slain and the true artifact passes your
                  contract — the cheapest code that satisfies your suite is
                  now the real thing. Won in {rounds}{" "}
                  {rounds === 1 ? "round" : "rounds"}.
                </p>
                <div className="libre-paw__lessons">
                  {duel.cheats.map((c) => (
                    <div key={c.id} className="libre-paw__lesson">
                      <strong>{c.title}:</strong> {c.lesson}
                    </div>
                  ))}
                </div>
                <pre className="libre-paw__grant-code">{duel.reference}</pre>
              </div>
            )}

            {slain > 0 && outcome?.kind !== "victory" && (
              <div className="libre-paw__ledger" aria-label="Slain grants">
                {duel.cheats.slice(0, slain).map((c) => (
                  <span key={c.id} className="libre-paw__slain" title={c.lesson}>
                    {c.title}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="libre-paw__actions">
        <button
          type="button"
          className="libre-paw__summon"
          onClick={() => void invoke()}
          disabled={summoning}
        >
          {summoning ? "The Paw stirs…" : "Invoke the Paw"}
        </button>
        {summoning && (
          <span className="libre-paw__progress">{progressLabel}</span>
        )}
      </div>
    </div>
  );
}
