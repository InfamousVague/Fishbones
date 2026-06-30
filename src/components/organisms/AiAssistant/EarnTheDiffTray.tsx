/// "Earn the Diff" — the inline challenge tray.
///
/// When the agent finishes a build WITH the learner (build-with-me /
/// socratic), it doesn't just hand over the project. The host picks
/// the ONE load-bearing line the build hinges on (deterministically,
/// via `selectRewindStep` — no model in the loop), blanks it, and
/// asks the learner to PREDICT it before revealing. The learner
/// earns the diff. Grading is the lenient, deterministic token
/// grader; the real line is always revealed afterwards regardless of
/// the guess, so a wrong prediction never leaves the sandbox wrong.
///
/// This is a POST-BUILD reward surface (not a mid-stream
/// interceptor): the file already landed and the run is green. That
/// matches the design's hard rule — the build is never left
/// unfinished by the challenge, and we fire at most once per build.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { bookOpenText } from "@base/primitives/icon/icons/book-open-text";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import { check } from "@base/primitives/icon/icons/check";
import type { Course } from "@/data/types";
import type { ToolResult } from "@/lib/aiTools/types";
import { analyzeBuildState } from "@/lib/ai/buildState";
import { analyzeBuildTape } from "@/lib/ai/buildTape";
import {
  gradeRewindGuess,
  selectRewindStep,
  type RewindChoice,
} from "@/lib/ai/rewind";
import { shouldOfferRewind } from "@/lib/ai/rewindPolicy";
import { loadMemory } from "@/lib/ai/memory";
import type { PairMode } from "@/lib/aiAgent/pairMode";
import { loadProject, isSandboxFsUnavailable } from "@/lib/sandboxFs";

const EMPTY_COURSES: readonly Course[] = [];
const EMPTY_COMPLETED: ReadonlySet<string> = new Set<string>();

/// Compute the at-most-one rewind challenge for the current build.
/// Fires only after a green run in a teaching mode; returns null
/// (fail-open) the moment any condition or the line-selection
/// doesn't qualify. `signature` lets the host show each challenge
/// once per completed build.
export function useRewindChallenge(opts: {
  open: boolean;
  streaming: boolean;
  timeline: readonly ToolResult[];
  pairMode: PairMode;
  courses?: readonly Course[];
  completed?: ReadonlySet<string>;
  currentCourseId?: string;
  /// mastery lookup (memory.mastery in a later pass); defaults to 0
  /// so the gate simply never suppresses until mastery exists.
  conceptMastery?: (conceptId: string) => number;
}): { challenge: RewindChoice | null; signature: string | null } {
  const { open, streaming, timeline, pairMode, currentCourseId } = opts;
  const courses = opts.courses ?? EMPTY_COURSES;
  const completed = opts.completed ?? EMPTY_COMPLETED;
  const conceptMastery = opts.conceptMastery;

  const state = useMemo(() => analyzeBuildState(timeline), [timeline]);

  // A signature that changes once per COMPLETED build cycle: the
  // project + how many green runs have happened. A fresh green run
  // after more edits offers a new challenge.
  const greenRuns = useMemo(() => {
    let n = 0;
    for (const t of timeline) {
      if (t.name === "run_sandbox_project") {
        try {
          const p = JSON.parse(t.content) as { ok?: boolean };
          if (t.ok && p.ok !== false) n++;
        } catch {
          if (t.ok) n++;
        }
      }
    }
    return n;
  }, [timeline]);

  const eligible =
    open &&
    !streaming &&
    pairMode !== "build-for-me" &&
    state.stage === "complete" &&
    !!state.projectId;
  const signature = eligible ? `${state.projectId}:${greenRuns}` : null;

  const [challenge, setChallenge] = useState<RewindChoice | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!eligible || !state.projectId) {
      setChallenge(null);
      return;
    }
    const reqId = ++reqRef.current;
    let cancelled = false;
    (async () => {
      try {
        const project = await loadProject(state.projectId!);
        if (cancelled || reqId !== reqRef.current) return;
        const tape = analyzeBuildTape(timeline);
        const choice = selectRewindStep({
          files: project.files.map((f) => ({
            path: f.name,
            content: f.content,
            language: f.language,
          })),
          tape,
          courses,
          completed,
          currentCourseId,
          memoryStruggles: loadMemory().struggles,
        });
        if (cancelled || reqId !== reqRef.current) return;
        // Final timing gate — now that we know the concept, honour
        // the mastery suppression.
        const mastery = choice && conceptMastery
          ? conceptMastery(choice.concept.concept.id)
          : 0;
        const ok =
          !!choice &&
          shouldOfferRewind({
            pairMode,
            buildComplete: true,
            alreadyOfferedThisBuild: false,
            conceptMastery: mastery,
          });
        setChallenge(ok ? choice : null);
      } catch (e) {
        if (!isSandboxFsUnavailable(e)) {
          console.debug("rewind challenge load failed", e);
        }
        if (!cancelled && reqId === reqRef.current) setChallenge(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, courses, completed, currentCourseId, pairMode]);

  return { challenge, signature };
}

function openLesson(courseId: string, lessonId: string) {
  window.dispatchEvent(
    new CustomEvent("libre:open-lesson", { detail: { courseId, lessonId } }),
  );
}

/// The challenge tray. Self-contained interaction: ask → grade →
/// reveal. Calls `onResolved(passed, conceptId)` once the learner
/// submits (so the host can record mastery), and `onDismiss` when
/// the learner skips or closes — both end the challenge for this
/// build.
export function EarnTheDiffTray({
  challenge,
  onResolved,
  onDismiss,
}: {
  challenge: RewindChoice;
  onResolved: (passed: boolean, conceptId: string) => void;
  onDismiss: () => void;
}) {
  const [guess, setGuess] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [passed, setPassed] = useState(false);

  // Reset when a new challenge instance arrives.
  useEffect(() => {
    setGuess("");
    setRevealed(false);
    setPassed(false);
  }, [challenge.file, challenge.lineIndex, challenge.answer]);

  const cov = challenge.concept;
  const lessons = cov.lessons.slice(0, 2);

  const submit = () => {
    if (revealed) return;
    const result = gradeRewindGuess(guess, challenge.answer);
    setPassed(result.passed);
    setRevealed(true);
    onResolved(result.passed, cov.concept.id);
  };

  // Render the blanked source with the hole line emphasised.
  const blankedLines = useMemo(
    () => challenge.blankedSource.split("\n"),
    [challenge.blankedSource],
  );

  return (
    <div className="libre-etd" role="region" aria-label="Earn the diff challenge">
      <div className="libre-etd-head">
        <Icon icon={sparkles} size="sm" color="currentColor" />
        <span className="libre-etd-title">Earn the diff</span>
        <span className="libre-etd-concept">{cov.concept.label}</span>
        <button
          type="button"
          className="libre-ai-panel-preview-close"
          onClick={onDismiss}
          aria-label="Skip challenge"
        >
          <Icon icon={xIcon} size="xs" color="currentColor" />
        </button>
      </div>

      <div className="libre-etd-body">
        <p className="libre-etd-prompt">{challenge.prompt}</p>

        <pre className="libre-etd-code" aria-label="Build with one line blanked">
          {blankedLines.map((line, i) => {
            const isHole = i === challenge.lineIndex;
            return (
              <div
                key={i}
                className={
                  "libre-etd-codeline" +
                  (isHole ? " libre-etd-codeline--hole" : "")
                }
              >
                {isHole && revealed ? challenge.answer : line || " "}
              </div>
            );
          })}
        </pre>

        {!revealed ? (
          <div className="libre-etd-input-row">
            <input
              type="text"
              className="libre-etd-input"
              placeholder="Type the missing line…"
              value={guess}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              onChange={(e) => setGuess(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button
              type="button"
              className="libre-etd-submit"
              onClick={submit}
              disabled={guess.trim().length === 0}
            >
              Check
            </button>
            <button
              type="button"
              className="libre-etd-skip"
              onClick={onDismiss}
            >
              Skip
            </button>
          </div>
        ) : (
          <div className="libre-etd-result">
            <div
              className={
                "libre-etd-verdict" +
                (passed ? " libre-etd-verdict--pass" : " libre-etd-verdict--miss")
              }
            >
              {passed ? (
                <>
                  <Icon icon={check} size="xs" color="currentColor" />
                  You earned it — that's the line.
                </>
              ) : (
                <>Not quite. Here's the line the build needed:</>
              )}
            </div>
            {!passed && (
              <div className="libre-etd-yourguess">
                <span className="libre-etd-yourguess-label">you wrote</span>
                <code>{guess.trim() || "—"}</code>
              </div>
            )}
            <p className="libre-etd-blurb">{cov.concept.blurb}</p>
            {lessons.length > 0 && (
              <div className="libre-etd-links">
                {lessons.map((l) => (
                  <button
                    key={l.link}
                    type="button"
                    className="libre-bj-learn"
                    onClick={() => openLesson(l.courseId, l.lessonId)}
                    title={`Open “${l.lessonTitle}” in ${l.courseTitle}`}
                  >
                    <Icon icon={bookOpenText} size="xs" color="currentColor" />
                    <span className="libre-bj-learn-text">{l.lessonTitle}</span>
                    <Icon icon={arrowRight} size="xs" color="currentColor" />
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="libre-etd-done"
              onClick={onDismiss}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
