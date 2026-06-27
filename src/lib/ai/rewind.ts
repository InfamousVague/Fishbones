/// "Earn the Diff" — the rewind engine.
///
/// The novel mechanism: when the agent builds something WITH the
/// learner, it doesn't just hand over a finished project. It picks
/// the ONE load-bearing line the build hinges on — the line that
/// embodies a concept the learner hasn't mastered (or just tripped
/// over) — blanks it, and asks the learner to PREDICT it before the
/// reveal. The learner earns the diff. The line they reconstruct,
/// the concept it teaches, and the lessons that explain it all fall
/// straight out of engines that already exist (`concepts.ts`,
/// `retrieval.ts`, the diagnosis table).
///
/// Two hard design rules, both about FAILING OPEN — a bad challenge
/// is far worse than no challenge:
///   1. `selectRewindStep` returns `null` by default. It only fires
///      when a line clears every filter: a real, installed-course
///      lesson exists for its concept; the line passes a strict
///      size/uniqueness guard; the concept is new-to-you or freshly
///      struggled. No qualifying line → null → the caller silently
///      falls back to the passive Build Journal.
///   2. The grader is lenient + deterministic (token-overlap, not
///      string-equality) so a learner who got the IDEA right isn't
///      failed on a stray space. And the real line is always
///      revealed afterwards regardless of the guess — the sandbox is
///      never left corrupted by a wrong prediction.
///
/// Pure module. No model picks the hole; no model grades. The small
/// local model only writes flavour text around a decision this
/// engine already made.

import type { Course } from "../../data/types";
import {
  analyzeConceptCoverage,
  conceptForDiagnosis,
  conceptLangFor,
  detectConceptsInCode,
  type Concept,
  type ConceptWithLessons,
} from "./concepts";
import { buildStruggleConcepts, strugglePathsForConcept, type BuildStep } from "./buildTape";

/// A project file in its FINAL state (loaded from disk by the host).
export interface RewindFile {
  path: string;
  content: string;
  language: string;
}

export interface RewindInput {
  files: readonly RewindFile[];
  /// The build tape (drives the struggle signal). Optional — the
  /// rewind still works on a clean build using concept novelty alone.
  tape?: readonly BuildStep[];
  courses: readonly Course[];
  completed: ReadonlySet<string>;
  /// Persistent per-diagnosis struggle counts from learner memory
  /// (code → times hit across sessions). Boosts concepts the learner
  /// repeatedly trips over.
  memoryStruggles?: Readonly<Record<string, number>>;
  currentCourseId?: string;
}

export interface RewindChoice {
  file: string;
  language: string;
  /// 0-based line index within the file.
  lineIndex: number;
  /// The exact original line, verbatim — used for grading + reveal.
  answer: string;
  /// The original line trimmed of leading indentation, for compact
  /// display in the tray.
  display: string;
  /// The full file content with the chosen line replaced by the
  /// blank marker — what the learner sees with the hole in it.
  blankedSource: string;
  blankMarker: string;
  /// The concept the line embodies, with its teaching lessons +
  /// learned flag (so the reveal can deep-link "Learn this").
  concept: ConceptWithLessons;
  /// A deterministic one-line cue the tray shows above the input.
  /// The model MAY rewrite it with more flavour, but this always
  /// works even when the model is terse.
  prompt: string;
  /// Why this line was chosen — surfaced for transparency + tests.
  reason: "struggled-concept" | "new-concept";
}

const BLANK_MARKER = "/* ___ your turn ___ */";

// Line guard bounds. A good hole is one substantive line: long
// enough to be worth predicting, short enough to be guessable.
const MIN_LINE_CHARS = 8;
const MAX_LINE_CHARS = 100;
const MIN_LINE_WORDS = 2;

/// Choose at most ONE line to rewind, or null. See module docs for
/// the fail-open contract.
export function selectRewindStep(input: RewindInput): RewindChoice | null {
  const { files, courses, completed, currentCourseId } = input;
  const tape = input.tape ?? [];
  const memoryStruggles = input.memoryStruggles ?? {};

  // 1. The ZPD signal: a weight per concept id. Base 1; +2 if the
  //    build itself tripped over it this run; + persistent history.
  const zpd = new Map<string, number>();
  for (const c of buildStruggleConcepts(tape)) {
    zpd.set(c.id, (zpd.get(c.id) ?? 1) + 2);
  }
  for (const [code, count] of Object.entries(memoryStruggles)) {
    const concept = conceptForDiagnosis(code);
    if (concept && count > 0) {
      zpd.set(concept.id, (zpd.get(concept.id) ?? 1) + Math.min(count, 3));
    }
  }

  // 2. Detect concepts across all code files, then resolve coverage
  //    (lessons + learned) over the union so each candidate carries
  //    its teaching links.
  const codeFiles = files.filter(
    (f) => f.content.trim().length > 0 && conceptLangFor(effLang(f)),
  );
  if (codeFiles.length === 0) return null;

  const unionConcepts = dedupe(
    codeFiles.flatMap((f) => detectConceptsInCode(f.content, effLang(f)).map((h) => h.concept)),
  );
  if (unionConcepts.length === 0) return null;

  const coverage = analyzeConceptCoverage(
    unionConcepts,
    courses,
    completed,
    currentCourseId,
  );
  const coverageById = new Map(coverage.map((c) => [c.concept.id, c]));

  // 3. Generate candidate (file, line, concept) triples + score.
  let best: { choice: RewindChoice; score: number } | null = null;

  for (const file of codeFiles) {
    const lang = effLang(file);
    const lines = file.content.split("\n");
    const fileConcepts = detectConceptsInCode(file.content, lang).map((h) => h.concept);

    for (const concept of fileConcepts) {
      const cov = coverageById.get(concept.id);
      if (!cov) continue;

      // HARD FILTER: a real installed-course lesson must teach this
      // concept, else the reveal can't deep-link anywhere.
      if (cov.lessons.length === 0) continue;

      const struggled = zpd.has(concept.id);
      // HARD FILTER: only teach what's new OR freshly struggled.
      // A concept the learner has demonstrably mastered is a waste
      // of a challenge.
      if (cov.learned && !struggled) continue;

      const lineIndex = bestLineForConcept(lines, concept, file.path);
      if (lineIndex < 0) continue;

      const weight = zpd.get(concept.id) ?? 1;
      // Score: harder + more-struggled concepts win. A struggled
      // concept gets a decisive edge (the build literally just
      // broke on it).
      const strugglePaths = strugglePathsForConcept(tape, concept.id);
      const onStrugglePath = strugglePaths.has(file.path) ? 2 : 1;
      const score = concept.difficulty * weight * onStrugglePath;

      if (!best || score > best.score) {
        best = {
          score,
          choice: makeChoice(file, lang, lines, lineIndex, cov, struggled),
        };
      }
    }
  }

  return best?.choice ?? null;
}

/// Grade a learner's predicted line against the real one. Lenient +
/// deterministic: normalises whitespace, tokenises into words +
/// punctuation, and scores Dice overlap so "got the right pieces"
/// passes even if spacing or trivial ordering differs. Exact match
/// (after whitespace normalisation) always passes.
export function gradeRewindGuess(
  guess: string,
  answer: string,
): { passed: boolean; similarity: number } {
  const ng = normalizeWs(guess);
  const na = normalizeWs(answer);
  if (ng.length === 0) return { passed: false, similarity: 0 };
  if (ng === na) return { passed: true, similarity: 1 };

  const ta = tokenize(answer);
  const tg = tokenize(guess);
  const similarity = diceMultiset(ta, tg);
  return { passed: similarity >= 0.8, similarity };
}

// ── line selection ──────────────────────────────────────────

/// Find the best single line in `lines` that embodies `concept` and
/// passes the guard. Returns the line index, or -1 if none qualify.
/// Prefers the line whose match is strongest + least ambiguous.
function bestLineForConcept(
  lines: string[],
  concept: Concept,
  _path: string,
): number {
  let bestIdx = -1;
  let bestLen = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!passesLineGuard(trimmed)) continue;
    // The line must match one of the concept's code signals.
    if (!concept.signals.some((re) => re.test(raw))) continue;
    // Uniqueness: the trimmed line must appear exactly once so the
    // learner (and the grader) reason about an unambiguous target.
    if (countTrimmed(lines, trimmed) !== 1) continue;
    // Prefer the SHORTEST qualifying line — the tightest, most
    // guessable embodiment of the concept.
    if (trimmed.length < bestLen) {
      bestLen = trimmed.length;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Declaration headers (`fn main() {`, `struct Point {`, `def f(self):`,
// `export function App() {`, `impl X for Y {`, `class Bag:` …). These
// are scaffolding, not the load-bearing insight — "predict the
// signature" is a trivial, unsatisfying challenge. The aha-line is an
// EXPRESSION or STATEMENT, so we exclude declaration heads outright.
const DECL_HEAD =
  /^(export\s+)?(default\s+)?(public\s+|private\s+|pub\s+|async\s+|static\s+|abstract\s+)*(fn|function|struct|enum|trait|impl|mod|class|def|interface|type)\b/;

function passesLineGuard(trimmed: string): boolean {
  if (trimmed.length < MIN_LINE_CHARS || trimmed.length > MAX_LINE_CHARS) {
    return false;
  }
  // No comment-only lines, no bare braces / punctuation, no imports
  // (imports are boilerplate, not the load-bearing idea).
  if (/^(\/\/|#|\/\*|\*)/.test(trimmed)) return false;
  if (/^[{}()\[\];,]+$/.test(trimmed)) return false;
  if (/^(import|use|from|#include|using|package)\b/.test(trimmed)) return false;
  if (DECL_HEAD.test(trimmed)) return false;
  // At least MIN_LINE_WORDS identifier-ish tokens — a line with one
  // token (`);`) isn't predictable.
  const words = trimmed.match(/[A-Za-z_]\w*/g) ?? [];
  return words.length >= MIN_LINE_WORDS;
}

function makeChoice(
  file: RewindFile,
  lang: string,
  lines: string[],
  lineIndex: number,
  cov: ConceptWithLessons,
  struggled: boolean,
): RewindChoice {
  const answer = lines[lineIndex];
  const indent = answer.match(/^\s*/)?.[0] ?? "";
  const blanked = lines.slice();
  blanked[lineIndex] = `${indent}${BLANK_MARKER}`;
  return {
    file: file.path,
    language: lang,
    lineIndex,
    answer,
    display: answer.trim(),
    blankedSource: blanked.join("\n"),
    blankMarker: BLANK_MARKER,
    concept: cov,
    prompt: struggled
      ? `Your build tripped on ${cov.concept.label} earlier. One line is blanked in ${file.path} — what goes here?`
      : `This build hinges on ${cov.concept.label}. One line is blanked in ${file.path} — predict it before the reveal.`,
    reason: struggled ? "struggled-concept" : "new-concept",
  };
}

// ── grading helpers ─────────────────────────────────────────

function normalizeWs(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/// Split a code line into comparable tokens: identifiers/numbers as
/// whole words, plus each non-space punctuation char as its own
/// token (so `()`, `:`, `<>` count toward overlap).
function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[0]);
  return out;
}

/// Dice similarity over token MULTISETS: 2·|shared| / (|a|+|b|),
/// counting repeats. 1.0 = identical bag of tokens.
function diceMultiset(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of b) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      shared++;
      counts.set(t, c - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

// ── misc helpers ────────────────────────────────────────────

function effLang(f: RewindFile): string {
  if (f.language && conceptLangFor(f.language)) return f.language;
  const lower = f.path.toLowerCase();
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (/\.(jsx?|mjs)$/.test(lower)) return "javascript";
  return f.language;
}

function countTrimmed(lines: string[], trimmed: string): number {
  let n = 0;
  for (const l of lines) if (l.trim() === trimmed) n++;
  return n;
}

function dedupe(concepts: readonly Concept[]): Concept[] {
  const seen = new Set<string>();
  const out: Concept[] = [];
  for (const c of concepts) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
