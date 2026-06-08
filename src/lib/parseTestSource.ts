/// Parse a lesson's `tests` string (a Jest-ish test file) into per-test source
/// blocks, so the UI can show "here's the actual code this test runs" next to
/// each pass/fail result.
///
/// Each `test(...)` / `it(...)` call is captured whole by scanning forward to
/// its matching close paren while respecting string / template / comment
/// content (so a `)` inside a string or comment doesn't end the block early).
/// The first string-literal argument is the test name — the same name the
/// runtime reports on each TestResult — which lets the UI match a result to
/// its source by NAME rather than index (async test results settle in
/// completion order, not definition order, so index matching is unsafe).

export interface TestBlock {
  /// The test's name (first string-literal argument to test()/it()).
  name: string;
  /// The full source of the `test(...)` / `it(...)` call, trimmed.
  code: string;
}

/// Extract every top-level `test(...)` / `it(...)` block, in source order.
export function extractTestBlocks(source: string | undefined | null): TestBlock[] {
  if (!source) return [];
  const blocks: TestBlock[] = [];
  // Match a `test(` / `it(` whose name isn't part of a longer identifier
  // (so `submit(` or `xit(` don't match). The opening paren is included so
  // `re.lastIndex - 1` points at it.
  const re = /(?<![A-Za-z0-9_$.])(?:test|it)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const start = m.index;
    const openParen = re.lastIndex - 1;
    const close = matchingParen(source, openParen);
    if (close < 0) break; // unbalanced — give up cleanly
    const code = source.slice(start, close + 1).trim();
    blocks.push({ name: extractName(code) ?? "", code });
    re.lastIndex = close + 1;
  }
  return blocks;
}

/// Build a name → source lookup. First occurrence wins on duplicate names
/// (duplicate test names are rare and bad practice; the first is the safe pick).
export function testSourceByName(source: string | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const b of extractTestBlocks(source)) {
    if (b.name && !map.has(b.name)) map.set(b.name, b.code);
  }
  return map;
}

/// Index of the `)` matching the `(` at `open`, skipping string / template /
/// comment spans. Returns -1 if the parens are unbalanced before end-of-input.
function matchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(s, i, c);
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/// Return the index of the closing quote for the string/template that opens at
/// `start` (holding quote `q`), honouring backslash escapes. Template `${...}`
/// interpolation is not recursed into — a `)` inside `${...}` is rare here, and
/// the worst case is `matchingParen` bailing out and the caller falling back to
/// showing the whole test file.
function skipString(s: string, start: number, q: string): number {
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === q) return i;
  }
  return s.length;
}

/// The first string-literal argument of a `test(...)` / `it(...)` call.
function extractName(testCallSrc: string): string | undefined {
  const m = /^(?:test|it)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(testCallSrc);
  if (!m) return undefined;
  // Unescape the common escapes so the name matches the runtime's reported name.
  return m[2].replace(/\\(['"`\\])/g, "$1");
}
