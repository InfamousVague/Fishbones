#!/usr/bin/env node
/// Auto-derive block-arrangement puzzles from existing exercise solutions.
///
/// Reads every `<id>.json` in `public/starter-courses/`, walks each
/// course's chapters, and for every `exercise` or `mixed` lesson with a
/// non-trivial `solution` field, INSERTS a sibling `puzzle` lesson
/// immediately after it. The puzzle's blocks are sliced from the
/// solution's lines (or statements, depending on lesson difficulty),
/// shuffled, and a couple of distractor blocks pulled from sibling
/// lessons mixed in.
///
/// Idempotent: re-running this script does NOT compound puzzles. We
/// detect already-derived puzzles by their id suffix (`__puzzle`) and
/// skip them. So `extract-starter-courses` → `generate-puzzles` →
/// `sync-courses` is the pipeline; bumping a course re-runs the chain
/// from extraction.
///
/// Output: course JSON files are mutated in-place. The web seed
/// manifest doesn't change shape (the puzzle lessons appear inside the
/// course's `chapters[].lessons[]` like any other lesson kind).
///
/// USAGE
///   node scripts/generate-puzzles.mjs
///
/// Run AFTER `extract-starter-courses.mjs` (which stages the JSON
/// files), BEFORE the academy's `sync:courses` (which mirrors the
/// staged files into the marketing site).

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STAGED = join(ROOT, "public", "starter-courses");

/// Skip puzzle generation for solutions shorter than this. A 1-2 line
/// solution makes a trivial puzzle (no rearrangement happens). 3+ lines
/// is the cutoff where reordering actually tests understanding.
const MIN_SOLUTION_LINES = 3;
/// Cap puzzle size so a 50-line solution doesn't become a 50-block
/// puzzle on a Watch screen. Long solutions get clipped to the first
/// MAX_BLOCKS contiguous statements; learners drill on the opening
/// shape instead of every detail.
const MAX_BLOCKS = 10;
/// Add up to N distractor blocks per puzzle. Two is enough that the
/// pool isn't trivially "stage every block in some order" but the
/// learner doesn't drown in noise.
const MAX_DISTRACTORS = 2;

/// Languages whose comments / blank lines should be filtered identically
/// to JS. We don't ship a real parser — heuristic line-splitting is
/// enough for the auto-derive case. The comment patterns below cover the
/// browser-runnable + ingest-able language set; everything else falls
/// through to the default JS-ish pattern (which is also fine for
/// formatted code in those languages).
const COMMENT_PATTERNS = {
  javascript: /^\s*(\/\/|\/\*|\*)/,
  typescript: /^\s*(\/\/|\/\*|\*)/,
  rust: /^\s*(\/\/|\/\*|\*)/,
  swift: /^\s*(\/\/|\/\*|\*)/,
  go: /^\s*(\/\/|\/\*|\*)/,
  c: /^\s*(\/\/|\/\*|\*)/,
  cpp: /^\s*(\/\/|\/\*|\*)/,
  java: /^\s*(\/\/|\/\*|\*)/,
  kotlin: /^\s*(\/\/|\/\*|\*)/,
  csharp: /^\s*(\/\/|\/\*|\*)/,
  solidity: /^\s*(\/\/|\/\*|\*)/,
  python: /^\s*#/,
};

function isCommentLine(line, language) {
  const pat = COMMENT_PATTERNS[language] ?? /^\s*(\/\/|#|\/\*|\*)/;
  return pat.test(line);
}

/// Lines that are pure structural punctuation (just `{`, `}`, `;`, or
/// blank). Skipping these in line-mode keeps the puzzle from being
/// padded with one-character blocks that don't carry meaning.
function isStructuralLine(line) {
  return /^\s*[{};]?\s*$/.test(line);
}

/// Pick the granularity. Challenge packs (kata-style) get line-level
/// because the solutions are typically 5-20 lines and learners benefit
/// from seeing each statement as a discrete step. Course lessons get
/// statement-level (slightly chunkier) so the puzzles match the prose's
/// pace. Hard difficulty (when present) always falls to line-level even
/// for course packs.
function chooseGranularity(course, lesson) {
  if (lesson.difficulty === "hard") return "line";
  if (lesson.difficulty === "easy") return "statement";
  if (course.packType === "challenges") return "line";
  return "statement";
}

/// Slice the solution into raw block strings. Granularity controls
/// whether we emit one block per line ("line") or one block per
/// brace-balanced statement ("statement").
function sliceIntoBlocks(solution, language, granularity) {
  const rawLines = solution.split(/\r?\n/);

  // Strip top-level comment lines + structural-only lines so blocks
  // always carry semantic content. We don't strip comments INSIDE a
  // block when building statement-level blocks — those are part of
  // the canonical solution shape.
  const lines = rawLines.filter(
    (l) => !isStructuralLine(l) && !isCommentLine(l, language),
  );
  if (lines.length === 0) return [];

  if (granularity === "line") {
    // Line-mode: each kept line is its own block. Trim trailing
    // whitespace but preserve indentation — indentation is part of
    // what learners are arranging.
    return lines.map((l) => l.replace(/\s+$/, ""));
  }

  // Statement-mode: walk lines, group consecutive lines with rising
  // brace-depth into one block until depth returns to its starting
  // level + 1 (meaning we've closed the just-opened block). This
  // groups e.g. an `if (...) { ... }` into a single block instead of
  // four mini-blocks. Falls back to line-mode for languages without
  // braces (Python, etc.) where the heuristic doesn't apply.
  const usesBraces = language !== "python";
  if (!usesBraces) {
    // Python: group by indentation continuation. A block is the
    // first line + every following line whose indent is greater than
    // the first's.
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const head = lines[i];
      const headIndent = head.match(/^(\s*)/)[1].length;
      const group = [head];
      let j = i + 1;
      while (j < lines.length) {
        const nextIndent = lines[j].match(/^(\s*)/)[1].length;
        if (nextIndent <= headIndent) break;
        group.push(lines[j]);
        j += 1;
      }
      blocks.push(group.join("\n").replace(/\s+$/, ""));
      i = j;
    }
    return blocks;
  }

  // Brace-balanced grouping for C-family languages.
  const blocks = [];
  let buffer = [];
  let depth = 0;
  let openedHere = false;
  for (const line of lines) {
    buffer.push(line);
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (opens > 0) openedHere = true;
    depth += opens - closes;

    if (depth <= 0 && openedHere) {
      // Closed the balanced block we opened in this run.
      blocks.push(buffer.join("\n").replace(/\s+$/, ""));
      buffer = [];
      depth = 0;
      openedHere = false;
    } else if (depth === 0 && !openedHere) {
      // Standalone single-line statement at top level. Emit it.
      blocks.push(buffer.join("\n").replace(/\s+$/, ""));
      buffer = [];
    }
  }
  if (buffer.length > 0) {
    blocks.push(buffer.join("\n").replace(/\s+$/, ""));
  }
  return blocks;
}

/// Stable id derived from the lesson id + block content. Re-running the
/// generator produces the same ids, so a learner mid-puzzle doesn't lose
/// progress when the script reruns. Includes a short hash of the code
/// so two blocks with the same content (e.g. duplicate `}` lines that
/// somehow survived filtering) get distinct ids.
function blockId(lessonId, code, index, suffix) {
  const hash = createHash("sha1")
    .update(`${lessonId}|${index}|${code}`)
    .digest("hex")
    .slice(0, 8);
  return `${lessonId}__${suffix ?? "block"}__${hash}`;
}

/// Pull a few lines from sibling lessons' solutions to use as
/// distractors. We prefer same-chapter siblings because their style is
/// consistent with the target lesson; if none exist, fall back to any
/// other lesson in the course. Never pulls from the same lesson (would
/// be a real solution line, not a distractor).
function gatherDistractorPool(course, currentLessonId) {
  const pool = [];
  for (const ch of course.chapters) {
    for (const l of ch.lessons) {
      if (l.id === currentLessonId) continue;
      if (l.kind !== "exercise" && l.kind !== "mixed") continue;
      const lines = (l.solution || "")
        .split(/\r?\n/)
        .map((x) => x.replace(/\s+$/, ""))
        .filter(
          (line) =>
            !isStructuralLine(line) &&
            !isCommentLine(line, l.language || course.language) &&
            line.trim().length > 4 &&
            line.trim().length < 80,
        );
      pool.push(...lines);
    }
  }
  return pool;
}

/// Pick up to N distinct distractors that are NOT already in the
/// canonical block list. We dedupe by trimmed string content so a
/// sibling that happens to use the same identifier doesn't accidentally
/// collide with a real block.
function pickDistractors(pool, canonicalCodes, n) {
  const canonical = new Set(canonicalCodes.map((c) => c.trim()));
  const seen = new Set();
  const out = [];
  // Walk the pool in randomized order so every regen picks a different
  // distractor set. Determinism isn't a goal here; learners should see
  // a fresh distractor on a retry.
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  for (const candidate of shuffled) {
    const t = candidate.trim();
    if (canonical.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(candidate);
    if (out.length >= n) break;
  }
  return out;
}

/// Build a single puzzle lesson from an exercise. Returns null if the
/// solution is too small to form a meaningful puzzle.
function buildPuzzle(course, lesson) {
  if (!lesson.solution || lesson.solution.trim().length === 0) return null;
  const language = lesson.language || course.language;
  const granularity = chooseGranularity(course, lesson);
  const rawBlocks = sliceIntoBlocks(lesson.solution, language, granularity);
  if (rawBlocks.length < MIN_SOLUTION_LINES) return null;

  const trimmed = rawBlocks.slice(0, MAX_BLOCKS);

  const puzzleLessonId = `${lesson.id}__puzzle`;

  // Build canonical (correct) blocks.
  const canonical = trimmed.map((code, i) => ({
    id: blockId(puzzleLessonId, code, i, "ord"),
    code,
  }));

  // Distractors.
  const pool = gatherDistractorPool(course, lesson.id);
  const distractors = pickDistractors(
    pool,
    canonical.map((b) => b.code),
    MAX_DISTRACTORS,
  ).map((code, i) => ({
    id: blockId(puzzleLessonId, code, i, "dis"),
    code,
    distractor: true,
  }));

  // Combine, shuffle once at build time so the ORDER stored on disk is
  // already a poor approximation of the canonical (the renderer can
  // re-shuffle at view time but will fall through to this baseline if
  // it doesn't).
  const all = [...canonical, ...distractors].sort(() => Math.random() - 0.5);

  const granularityLabel =
    granularity === "line"
      ? "lines"
      : granularity === "statement"
      ? "statements"
      : "functions";

  return {
    id: puzzleLessonId,
    kind: "puzzle",
    language,
    title: `${lesson.title} — arrange the ${granularityLabel}`,
    body:
      "Stage the blocks below in the right order. Tap a block in the pool to add it to the stage; tap a staged block to send it back. When the stage matches the canonical solution, the lesson completes.",
    blocks: all,
    solutionOrder: canonical.map((b) => b.id),
    granularity,
    prompt: `Arrange these ${canonical.length} ${granularityLabel} from "${lesson.title}".`,
  };
}

/// Walk a course and inject puzzle + cloze lessons. Returns
/// {puzzles, clozes} counts so the run log shows what was added.
///
/// Order of insertion: exercise → cloze (fill-in tokens) → puzzle
/// (arrange shape). Cloze sits between the original exercise and
/// the arrangement puzzle because it's the more contextual
/// follow-up: "now that you've written it, fill in the key
/// pieces", and only then "rearrange the whole shape".
function injectPuzzles(course) {
  let puzzles = 0;
  let clozes = 0;
  for (const chapter of course.chapters) {
    const next = [];
    for (const lesson of chapter.lessons) {
      next.push(lesson);
      if (
        lesson.id.endsWith("__puzzle") ||
        lesson.id.endsWith("__cloze")
      )
        continue; // already an auto-derive, keep but don't re-derive
      if (lesson.kind !== "exercise" && lesson.kind !== "mixed") continue;

      // Cloze counterpart (insert before puzzle so it reads first).
      const clozeId = `${lesson.id}__cloze`;
      const hasCloze = chapter.lessons.some((l) => l.id === clozeId);
      if (!hasCloze) {
        const cloze = buildCloze(course, lesson);
        if (cloze) {
          next.push(cloze);
          clozes += 1;
        }
      }

      // Arrangement puzzle (existing behaviour).
      const puzzleId = `${lesson.id}__puzzle`;
      const hasPuzzle = chapter.lessons.some((l) => l.id === puzzleId);
      if (!hasPuzzle) {
        const puzzle = buildPuzzle(course, lesson);
        if (puzzle) {
          next.push(puzzle);
          puzzles += 1;
        }
      }
    }
    chapter.lessons = next;
  }
  return { puzzles, clozes };
}

// ─────────────────────── cloze generator ───────────────────────
//
// Cloze (fill-in-the-blank) lessons are the "contextual fill-in"
// answer to: arrangement puzzles either give us one-liners (boring)
// or huge wall-of-code blocks (overwhelming). Cloze keeps the FULL
// solution visible as code and just blanks out the tokens that
// matter — function names, return expressions, key keywords. The
// learner reads the shape AND drills on the specific bits that
// carry meaning.
//
// We only blank tokens we can confidently distractor — function
// names (we have sibling function names), return values (we have
// adjacent expressions), keywords (we have a fixed alternate pool
// per language). Free-form variables get skipped because their
// distractors would need semantic knowledge we don't have without
// a full parser.

/// Per-language keyword distractor pools. When we blank a keyword,
/// distractors come from the same language family + a few
/// look-alikes. Trimmed to keep the option chip readable on phone
/// (4 options total per slot).
const KEYWORD_DISTRACTORS = {
  // Control-flow + declaration keywords share the same alternate
  // pool across most C-family languages because the learner
  // pressures are similar (return-vs-break-vs-continue).
  default: {
    return: ["break", "continue", "yield"],
    break: ["return", "continue", "yield"],
    continue: ["break", "return", "yield"],
    yield: ["return", "break", "continue"],
    async: ["await", "static", "const"],
    await: ["async", "yield", "return"],
    const: ["let", "var", "static"],
    let: ["const", "var", "mut"],
    var: ["let", "const", "mut"],
    mut: ["let", "const", "static"],
    if: ["while", "for", "match"],
    while: ["for", "if", "loop"],
    for: ["while", "if", "loop"],
    fn: ["let", "struct", "trait"],
    function: ["const", "let", "var"],
    def: ["class", "lambda", "async"],
    class: ["def", "trait", "struct"],
    struct: ["class", "trait", "enum"],
    trait: ["struct", "class", "enum"],
    enum: ["struct", "trait", "class"],
    pub: ["mut", "static", "const"],
    public: ["private", "protected", "static"],
    private: ["public", "protected", "static"],
    static: ["const", "pub", "let"],
    impl: ["trait", "struct", "fn"],
    interface: ["class", "type", "abstract"],
    type: ["interface", "struct", "enum"],
    null: ["undefined", "None", "nil"],
    true: ["false", "1", "yes"],
    false: ["true", "0", "no"],
  },
};

/// Tokens we'll blank in cloze lessons, by language family.
/// "Identifier" tokens are blanked greedily (every defined function
/// name); keyword tokens are blanked only when they're at a
/// statement start (so a stray `for` inside a string doesn't
/// trigger a blank).
const CLOZE_DEFINITIONS = {
  // Function-definition matchers per language. Capture group 1 is
  // the function/method name. Used to blank function names that
  // appear at definition sites — we don't blank call sites
  // because they'd need a different distractor strategy.
  jsLikeDef: /\b(?:function|const|let|var)\s+([a-zA-Z_$][\w$]*)\s*[=(]/g,
  pyDef: /^\s*def\s+([A-Za-z_]\w*)\s*\(/gm,
  goDef: /^\s*func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/gm,
  rustDef: /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*[(<]/gm,
  cFamilyDef: /^\s*(?:[a-zA-Z_][\w*\s]*\s)?([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/gm,
  // Return-statement matcher — captures the expression after
  // `return`. Used to blank the return value (high-information
  // single-token answer when the expression is short).
  returnExpr: /\breturn\s+([^;\n{}]+?)(\s*[;\n{}])/g,
};

/// Produce candidate slots from a solution. Each candidate is a
/// shape we'll consider blanking; the caller filters and caps.
function findClozeCandidates(solution, language) {
  const out = [];

  // `hint` chooses the chip's empty-state placeholder ("pick
  // function name" vs "pick identifier"). We pass it per-pattern
  // so the JS-like matcher (which catches both functions and
  // variable declarations) doesn't lie about what the blank is.
  const pushDef = (re, hint) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(solution)) !== null) {
      const name = m[1];
      if (!name || name.length < 2) continue;
      // Skip very common short identifiers — they make for boring
      // blanks with no distractor pool.
      if (["i", "j", "k", "x", "y", "z", "n", "tmp"].includes(name)) continue;
      // The exact position of the name within the matched text.
      const fullStart = m.index;
      const inMatch = m[0].indexOf(name);
      out.push({
        kind: "identifier",
        hint,
        start: fullStart + inMatch,
        end: fullStart + inMatch + name.length,
        token: name,
      });
    }
  };

  if (language === "python") {
    pushDef(CLOZE_DEFINITIONS.pyDef, "function name");
  } else if (language === "go") {
    pushDef(CLOZE_DEFINITIONS.goDef, "function name");
  } else if (language === "rust") {
    pushDef(CLOZE_DEFINITIONS.rustDef, "function name");
  } else if (
    ["c", "cpp", "java", "csharp", "kotlin", "swift", "solidity"].includes(
      language,
    )
  ) {
    pushDef(CLOZE_DEFINITIONS.cFamilyDef, "function name");
  } else {
    // JS / TS / JS-like default — `function NAME`, `const NAME =`,
    // `let NAME =`, `var NAME =` all match. We label these
    // "identifier" since variable declarations dominate in
    // modern JS/TS (`const x = ...`) and "function name" would be
    // misleading three-quarters of the time.
    pushDef(CLOZE_DEFINITIONS.jsLikeDef, "identifier");
  }

  // Return-expression slots — only when the expression is a single
  // short token. Multi-token returns make for ambiguous distractors.
  CLOZE_DEFINITIONS.returnExpr.lastIndex = 0;
  let rm;
  while ((rm = CLOZE_DEFINITIONS.returnExpr.exec(solution)) !== null) {
    const expr = rm[1].trim();
    if (expr.length === 0 || expr.length > 24) continue;
    // Only single identifiers / numeric literals / simple subscripts —
    // anything with operators or function calls is too ambiguous
    // to distractor cleanly.
    if (!/^[A-Za-z_][\w.]*(?:\[[^\]]*\])?$/.test(expr) && !/^-?\d+(?:\.\d+)?$/.test(expr)) {
      continue;
    }
    const fullStart = rm.index;
    const inMatch = rm[0].indexOf(expr);
    out.push({
      kind: "identifier",
      hint: "return value",
      start: fullStart + inMatch,
      end: fullStart + inMatch + expr.length,
      token: expr,
    });
  }

  // De-duplicate overlapping candidates (e.g. a return-expr that's
  // also a function name in the same solution). Keep the first
  // occurrence by start position.
  out.sort((a, b) => a.start - b.start);
  const dedup = [];
  let lastEnd = -1;
  for (const c of out) {
    if (c.start < lastEnd) continue;
    dedup.push(c);
    lastEnd = c.end;
  }
  return dedup;
}

/// Build a cloze lesson. Returns null when there aren't enough
/// candidate slots to make a meaningful exercise — fewer than 2
/// blanks leaves a degenerate "tap one chip and you're done"
/// experience.
function buildCloze(course, lesson) {
  if (!lesson.solution || lesson.solution.trim().length === 0) return null;
  const language = lesson.language || course.language;
  // Cap solution size — cloze on a 200-line solution is a chore.
  // 80 lines is roughly one phone scroll.
  const lines = lesson.solution.split(/\r?\n/);
  if (lines.length > 80) return null;

  const candidates = findClozeCandidates(lesson.solution, language);
  if (candidates.length < 2) return null;

  // Cap slots so the chip count stays manageable. 2-5 is the
  // sweet spot — enough to test retention without becoming a
  // typing puzzle.
  const MAX_SLOTS = 5;
  const picked = candidates.slice(0, MAX_SLOTS);

  const lessonId = `${lesson.id}__cloze`;

  // Walk picked positions back-to-front so replacements don't shift
  // the later indices. Build template by splicing in `__SLOT_<id>__`
  // markers in the source position.
  let template = lesson.solution;
  const slots = [];
  const distractorPool = gatherClozeDistractorPool(course, lesson.id);

  for (let i = picked.length - 1; i >= 0; i--) {
    const c = picked[i];
    const slotId = blockId(lessonId, c.token, i, "cs");
    const marker = `__SLOT_${slotId}__`;
    template = template.slice(0, c.start) + marker + template.slice(c.end);

    const options = pickClozeDistractors(c, picked, distractorPool, language, 3);
    slots.unshift({
      id: slotId,
      answer: c.token,
      options: shuffleOnce([c.token, ...options]),
      hint: c.hint,
    });
  }

  return {
    id: lessonId,
    kind: "cloze",
    language,
    title: `${lesson.title} — fill in the blanks`,
    body:
      "Read the canonical solution and pick the right value for each tappable blank. Each chip opens a sheet with options — when every chip is correct, the lesson auto-completes.",
    template,
    slots,
    prompt: `Fill in the ${slots.length} blank${slots.length === 1 ? "" : "s"} in the canonical solution.`,
  };
}

/// Pool of identifier candidates from sibling lessons + the lesson
/// itself, used to source distractors that look plausible (same
/// language flavour, similar style).
function gatherClozeDistractorPool(course, currentLessonId) {
  const pool = new Set();
  for (const ch of course.chapters) {
    for (const l of ch.lessons) {
      if (l.id === currentLessonId) continue;
      const src = (l.solution || l.starter || "");
      if (!src) continue;
      // Pull every identifier-shaped token. Filter to sensible
      // length (3-24 chars) so we don't pick `i` or
      // `theLongestNameYouEverSaw`.
      const re = /\b([A-Za-z_][A-Za-z0-9_]{2,23})\b/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        pool.add(m[1]);
      }
    }
  }
  return [...pool];
}

/// Pick `n` distractors for a candidate slot. Strategy:
///   * keyword candidates → KEYWORD_DISTRACTORS lookup
///   * identifier candidates → other-name siblings from the same
///     solution + the global pool, filtered to similar length
function pickClozeDistractors(candidate, allPicked, pool, language, n) {
  const want = n;
  const seen = new Set([candidate.token]);
  const out = [];

  // Same-solution sibling identifiers first (highest contextual
  // relevance — same author voice, same surrounding code).
  const siblingTokens = allPicked
    .map((c) => c.token)
    .filter((t) => t !== candidate.token);
  for (const t of siblingTokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= want) return out;
  }

  // Then global pool, ranked by closeness in length to the answer
  // (keeps the chip widths similar so visual cues don't leak the
  // answer).
  const targetLen = candidate.token.length;
  const ranked = [...pool]
    .filter((t) => !seen.has(t))
    .sort((a, b) => Math.abs(a.length - targetLen) - Math.abs(b.length - targetLen));
  for (const t of ranked) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= want) return out;
  }

  // Final fallback: synthesise plausible-looking but distinct names
  // by mutating the answer (drop a char, swap a vowel). Keeps the
  // option chip count consistent even on tiny courses.
  if (out.length < want) {
    const variants = synthesizeVariants(candidate.token, want - out.length);
    for (const v of variants) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/// Cheap variant generator: drop a vowel, swap a vowel, append a
/// prime. Used only as a last-resort distractor when the pool runs
/// dry — better than not filling option slots at all.
function synthesizeVariants(token, n) {
  const out = [];
  // Drop last vowel.
  const dropped = token.replace(/[aeiouAEIOU](?=[^aeiouAEIOU]*$)/, "");
  if (dropped !== token && dropped.length >= 2) out.push(dropped);
  // Swap first vowel.
  for (const swap of ["a", "e", "i", "o", "u"]) {
    if (out.length >= n) break;
    const swapped = token.replace(/[aeiouAEIOU]/, swap);
    if (swapped !== token) out.push(swapped);
  }
  // Append prime if still short.
  if (out.length < n) out.push(token + "_");
  return out.slice(0, n);
}

/// One-shot Fisher-Yates. The renderer also re-shuffles per render
/// for option-sheet display, so this is just to scramble the source
/// JSON's option order (so `answer` isn't always at index 0).
function shuffleOnce(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function main() {
  if (!existsSync(STAGED)) {
    console.error(
      `[generate-puzzles] expected staged courses at ${STAGED} — run \`node scripts/extract-starter-courses.mjs\` first.`,
    );
    process.exit(1);
  }
  const files = (await readdir(STAGED)).filter(
    (f) => f.endsWith(".json") && f !== "manifest.json",
  );

  let totalCourses = 0;
  let totalPuzzles = 0;
  let totalClozes = 0;

  for (const f of files) {
    const path = join(STAGED, f);
    const text = await readFile(path, "utf-8");
    const course = JSON.parse(text);
    if (!course.chapters) continue;

    const before = course.chapters.reduce(
      (acc, ch) => acc + ch.lessons.length,
      0,
    );
    const { puzzles, clozes } = injectPuzzles(course);
    const after = course.chapters.reduce(
      (acc, ch) => acc + ch.lessons.length,
      0,
    );

    if (puzzles + clozes > 0) {
      await writeFile(path, JSON.stringify(course, null, 2), "utf-8");
      console.log(
        `[generate-puzzles] ${course.id}: +${puzzles} puzzles, +${clozes} clozes (${before} → ${after} lessons)`,
      );
      totalPuzzles += puzzles;
      totalClozes += clozes;
    } else {
      console.log(
        `[generate-puzzles] ${course.id}: no eligible exercises (${before} lessons)`,
      );
    }
    totalCourses += 1;
  }

  console.log(
    `[generate-puzzles] processed ${totalCourses} courses, inserted ${totalPuzzles} puzzles + ${totalClozes} clozes`,
  );
}

main().catch((err) => {
  console.error("[generate-puzzles] failed:", err);
  process.exit(1);
});
