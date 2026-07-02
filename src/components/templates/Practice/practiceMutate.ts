/// Deterministic single-line code mutator — the shared engine behind
/// Spot-the-Bug (and, later, One-Line-Fix / Which-Compiles). Given a
/// known-good solution's lines, it introduces exactly ONE subtle,
/// high-signal bug — a flipped comparison, an inverted boolean, a
/// swapped logical operator, or a dropped boundary `=` — and reports
/// which line it broke. Seeded by the atom id so a given card always
/// shows the same bug (stable SRS scheduling).
///
/// Intentionally conservative: it only flips operators/keywords that
/// read as genuine logic bugs, skips comment lines, and never invents
/// a syntax error. When no line carries a mutatable token it returns
/// null and the caller simply doesn't emit a Spot-the-Bug atom.

export interface BugPuzzle {
  /// The lines WITH the bug applied (one line differs from the source).
  lines: string[];
  /// 0-based index of the broken line.
  bugLine: number;
  /// The original (correct) text of the broken line — shown on reveal.
  original: string;
  /// Short human label for the bug class, e.g. "comparison operator".
  category: string;
}

/// Ordered substring swaps. Longer operators MUST come before their
/// prefixes (`===` before `==`) so `swapFirst` matches the right one.
const COMPARISON: ReadonlyArray<[string, string]> = [
  ["===", "!=="],
  ["!==", "==="],
  ["<=", "<"],
  [">=", ">"],
  ["==", "!="],
  ["!=", "=="],
];
const LOGICAL: ReadonlyArray<[string, string]> = [
  ["&&", "||"],
  ["||", "&&"],
];
/// Spaced so we never touch `++`, unary `+`, or pointer derefs.
/// Compound-assign pairs come first so ` += ` isn't shadowed by ` + `.
const ARITHMETIC: ReadonlyArray<[string, string]> = [
  [" += ", " -= "],
  [" -= ", " += "],
  [" + ", " - "],
  [" - ", " + "],
];
/// Rust borrow mutability — dropping `mut` is a classic, high-signal
/// bug (aliasing / "cannot borrow as mutable"). One-way only: the
/// reverse would over-match every `&`.
const MUTABILITY: ReadonlyArray<[string, string]> = [["&mut ", "&"]];

interface Rule {
  category: string;
  apply: (line: string) => string | null;
}

const RULES: readonly Rule[] = [
  { category: "comparison operator", apply: (l) => swapFirst(l, COMPARISON) },
  { category: "boolean value", apply: swapBoolean },
  { category: "logical operator", apply: (l) => swapFirst(l, LOGICAL) },
  { category: "arithmetic operator", apply: (l) => swapFirst(l, ARITHMETIC) },
  { category: "borrow mutability", apply: (l) => swapFirst(l, MUTABILITY) },
];

/// Replace the first occurrence of any `from` token (scanned in array
/// order) with its `to`. Returns null when none are present.
function swapFirst(line: string, pairs: ReadonlyArray<[string, string]>): string | null {
  for (const [from, to] of pairs) {
    const i = line.indexOf(from);
    if (i >= 0) return line.slice(0, i) + to + line.slice(i + from.length);
  }
  return null;
}

/// Flip the first standalone `true`/`false` keyword.
function swapBoolean(line: string): string | null {
  const m = line.match(/\b(true|false)\b/);
  if (!m || m.index == null) return null;
  const to = m[1] === "true" ? "false" : "true";
  return line.slice(0, m.index) + to + line.slice(m.index + m[1].length);
}

/// Lines we never mutate: blank, or comment-only (//, #, *, --).
function isMutatableLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (/^(\/\/|#|\*|--|\/\*)/.test(t)) return false;
  return true;
}

/// Build a Spot-the-Bug puzzle from a solution's lines, or null if no
/// line carries a mutatable token. `seed` makes the choice stable.
export function makeBugPuzzle(lines: string[], seed: number): BugPuzzle | null {
  const candidates: Array<{ i: number; mutated: string; category: string }> = [];
  lines.forEach((line, i) => {
    if (!isMutatableLine(line)) return;
    for (const rule of RULES) {
      const mutated = rule.apply(line);
      if (mutated && mutated !== line) {
        candidates.push({ i, mutated, category: rule.category });
        break; // one (highest-priority) mutation per line
      }
    }
  });
  if (candidates.length === 0) return null;
  const pick = candidates[(seed >>> 0) % candidates.length];
  const out = lines.slice();
  out[pick.i] = pick.mutated;
  return {
    lines: out,
    bugLine: pick.i,
    original: lines[pick.i],
    category: pick.category,
  };
}

/// FNV-1a — stable seed from an atom id.
export function seedFromId(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─── Fill-the-Gap (cloze) ───────────────────────────────────────────
//
// Blank ONE meaningful token out of the solution and offer four
// same-class candidates. Token classes reuse the Spot-the-Bug
// philosophy — operators and literals whose alternatives read as
// plausible, not as syntax errors.

export interface ClozePuzzle {
  lines: string[];
  blankLine: number;
  blankStart: number;
  blankLen: number;
  answer: string;
  options: string[];
  category: string;
}

interface TokenClass {
  category: string;
  /// Match the FIRST candidate token in a line: returns [start, text].
  find: (line: string) => [number, string] | null;
  /// Distractor pool for a matched token (must exclude the token
  /// itself; ordered — the shuffle is seeded downstream).
  pool: (token: string) => string[];
}

const COMPARISON_POOL = ["===", "!==", "==", "!=", "<=", ">=", "<", ">"];
const LOGICAL_POOL = ["&&", "||", "&", "|"];
const ARITHMETIC_POOL = ["+", "-", "*", "/", "%"];

/// Match helpers keep cloze conservative: operators must be space-
/// padded (so `++`, unary minus, and lifetimes don't match), numbers
/// must be standalone integers.
function findPadded(line: string, pool: string[]): [number, string] | null {
  for (const tok of pool) {
    const padded = ` ${tok} `;
    const i = line.indexOf(padded);
    if (i >= 0) return [i + 1, tok];
  }
  return null;
}

const TOKEN_CLASSES: readonly TokenClass[] = [
  {
    category: "comparison operator",
    find: (l) => findPadded(l, COMPARISON_POOL),
    pool: (t) => COMPARISON_POOL.filter((x) => x !== t),
  },
  {
    category: "logical operator",
    find: (l) => findPadded(l, LOGICAL_POOL),
    pool: (t) => LOGICAL_POOL.filter((x) => x !== t),
  },
  {
    category: "arithmetic operator",
    find: (l) => findPadded(l, ARITHMETIC_POOL),
    pool: (t) => ARITHMETIC_POOL.filter((x) => x !== t),
  },
  {
    category: "number",
    find: (l) => {
      const m = l.match(/\b\d{1,6}\b/);
      return m && m.index != null ? [m.index, m[0]] : null;
    },
    pool: (t) => {
      const n = parseInt(t, 10);
      // Plausible off-by-style neighbours; dedupe + drop the answer.
      const cands = [n - 1, n + 1, n * 2, n === 0 ? 2 : 0, n + 10];
      const out: string[] = [];
      for (const c of cands) {
        const s = String(c);
        if (s !== t && !out.includes(s)) out.push(s);
      }
      return out;
    },
  },
];

/// Deterministic in-place Fisher-Yates with a splitmix-ish PRNG.
function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/// Build a Fill-the-Gap puzzle, or null when no line carries a
/// blankable token. Seeded by the atom id so the same card always
/// blanks the same token (stable SRS identity).
export function makeClozePuzzle(lines: string[], seed: number): ClozePuzzle | null {
  const candidates: Array<{
    line: number;
    start: number;
    token: string;
    cls: TokenClass;
  }> = [];
  lines.forEach((line, i) => {
    if (!isMutatableLine(line)) return;
    for (const cls of TOKEN_CLASSES) {
      const hit = cls.find(line);
      if (hit) {
        candidates.push({ line: i, start: hit[0], token: hit[1], cls });
        break; // highest-priority class per line
      }
    }
  });
  if (candidates.length === 0) return null;
  const pick = candidates[(seed >>> 0) % candidates.length];
  const distractors = pick.cls.pool(pick.token).slice(0, 3);
  if (distractors.length < 2) return null; // need a real choice
  const options = seededShuffle([pick.token, ...distractors], seed ^ 0x5f356495);
  return {
    lines,
    blankLine: pick.line,
    blankStart: pick.start,
    blankLen: pick.token.length,
    answer: pick.token,
    options,
    category: pick.cls.category,
  };
}

// ─── Memory Rebuild ─────────────────────────────────────────────────

export interface RebuildPuzzle {
  lines: string[];
  decoys: string[];
  peekMs: number;
}

/// Build a Memory-Rebuild puzzle: the correct lines plus 1-2 mutated
/// decoy lines that belong nowhere. Decoys come from the same
/// single-line mutator Spot-the-Bug uses, so they're plausible
/// look-alikes rather than obvious junk. Null when no line is
/// mutatable (no decoy possible = puzzle is just Parsons again).
export function makeRebuildPuzzle(lines: string[], seed: number): RebuildPuzzle | null {
  const decoys: string[] = [];
  // Two attempts with derived seeds; keep decoys that differ from
  // every real line AND from each other.
  for (const s of [seed ^ 0x1b873593, seed ^ 0xcc9e2d51]) {
    const bug = makeBugPuzzle(lines, s);
    if (!bug) continue;
    const decoy = bug.lines[bug.bugLine];
    if (!lines.includes(decoy) && !decoys.includes(decoy)) decoys.push(decoy);
    if (decoys.length >= 2) break;
  }
  if (decoys.length === 0) return null;
  return {
    lines,
    decoys,
    // Peek window scales with solution length: base 1.5s + 400ms/line,
    // capped so long snippets don't turn into a free read.
    peekMs: Math.min(1500 + lines.length * 400, 6000),
  };
}
