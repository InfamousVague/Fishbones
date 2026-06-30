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
