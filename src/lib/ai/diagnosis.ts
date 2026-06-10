/// Error diagnosis — a deterministic "compiler whisperer" that
/// turns raw stderr into a targeted fix hint.
///
/// A 7B local model reading `error[E0382]: borrow of moved value`
/// cold will sometimes flail (clone everything, rewrite the whole
/// file, apologise). The same model reading the error PLUS a
/// one-line expert hint ("the value moved on assignment — borrow
/// with & or .clone() it") almost always patches correctly on the
/// first try. This module is that hint table: pattern-matched,
/// zero-cost, and easy to extend per language.
///
/// Wired into `run_sandbox_project`'s result payload as a
/// `diagnosis` field — the model reads it in the same tool result
/// as the error, and the console UI can render the human-readable
/// summary. The table leans Rust-first (The Rust Programming
/// Language + Rustlings are the flagship courses) with the common
/// JS/TS/Python failures behind it.

export interface Diagnosis {
  /// Stable id for the matched pattern ("rust-E0382",
  /// "js-reference-error", …). Doubles as the struggle-tracking
  /// topic key in the memory layer.
  code: string;
  /// One-line human summary of what went wrong.
  summary: string;
  /// The targeted fix hint the model (and learner) reads.
  hint: string;
  /// Source location when the error format carries one.
  file?: string;
  line?: number;
}

interface Pattern {
  code: string;
  /// Match against the combined error + log text.
  re: RegExp;
  summary: string;
  hint: string;
}

/// Rust first — error codes are stable and the hints can be
/// precise. JS/TS/Python patterns are message-shaped.
const PATTERNS: Pattern[] = [
  // ── Rust ──────────────────────────────────────────────────
  {
    code: "rust-E0382",
    re: /error\[E0382\]|borrow of moved value|use of moved value/i,
    summary: "Use of a value after it was moved.",
    hint:
      "The value's ownership moved on assignment or a function call. Either borrow instead (`&value` / `&mut value`), `.clone()` it when a copy is fine, or restructure so the original owner isn't used afterwards. Rustlings move_semantics exercises drill exactly this.",
  },
  {
    code: "rust-E0502",
    re: /error\[E0502\]|cannot borrow .+ as mutable because it is also borrowed as immutable/i,
    summary: "Overlapping mutable and immutable borrows.",
    hint:
      "An immutable borrow is still alive where the mutable borrow starts. Shorten the immutable borrow's scope (end its use earlier, or wrap it in a block `{ }`) so the borrows don't overlap.",
  },
  {
    code: "rust-E0499",
    re: /error\[E0499\]|cannot borrow .+ as mutable more than once/i,
    summary: "Two mutable borrows of the same value at once.",
    hint:
      "Only one `&mut` can be live at a time. Sequence the mutations (finish with the first borrow before taking the second) or split the data (e.g. `split_at_mut` for slices).",
  },
  {
    code: "rust-E0308",
    re: /error\[E0308\]|mismatched types/i,
    summary: "Type mismatch between expected and found.",
    hint:
      "Read the `expected … found …` pair in the error. Common fixes: add/remove `&`, convert with `.to_string()` / `as` / `.into()`, or return the right variant (`Ok(value)` vs bare value).",
  },
  {
    code: "rust-E0425",
    re: /error\[E0425\]|cannot find (value|function) `[^`]+` in this scope/i,
    summary: "Name used before it exists in scope.",
    hint:
      "Typo, missing `let`, or missing `use` import. Declare the binding before use or import the item (`use module::name;`).",
  },
  {
    code: "rust-E0432",
    re: /error\[E0432\]|unresolved import/i,
    summary: "Import path doesn't resolve.",
    hint:
      "Check the module path in the `use` statement — in the sandbox, sibling-file modules need a `mod filename;` declaration in main.rs before `use` works.",
  },
  {
    code: "rust-missing-semicolon",
    re: /expected `;`|help: add `;` here/i,
    summary: "Missing semicolon.",
    hint: "Add the `;` where the compiler points — the previous statement never ended.",
  },
  {
    code: "rust-borrow-checker-lifetime",
    re: /error\[E0597\]|borrowed value does not live long enough/i,
    summary: "A reference outlives the value it points at.",
    hint:
      "The owner is dropped while a reference to it is still in use. Move the owner's declaration up a scope, or return owned data (String / Vec) instead of a reference.",
  },
  // ── JavaScript / TypeScript ───────────────────────────────
  {
    code: "js-reference-error",
    re: /ReferenceError: (\w+) is not defined/i,
    summary: "Identifier used but never defined or imported.",
    hint:
      "Define the variable/function before use, or add the import. In the React sandbox, hooks (useState etc.) are in scope already — do NOT add `import React`; just use them.",
  },
  {
    code: "js-undefined-property",
    // Two V8 formats: legacy "Cannot read property 'x' of
    // undefined" AND modern "Cannot read properties of undefined
    // (reading 'x')" — the property name moved AFTER "of
    // undefined", so the middle segment is optional.
    re: /TypeError: Cannot read propert(?:y|ies)\s+(?:\S+\s+)?of (undefined|null)/i,
    summary: "Property access on undefined/null.",
    hint:
      "Something earlier returned undefined — usually state before first render or a missing array element. Guard with optional chaining (`obj?.prop`), default values, or initialise state with the right shape (e.g. `useState([])` not `useState()`).",
  },
  {
    code: "js-not-a-function",
    re: /TypeError: .+ is not a function/i,
    summary: "Calling something that isn't a function.",
    hint:
      "The name points at undefined or a non-function (typo'd method, wrong import shape, or shadowed variable). Log the value or check the import/export pairing.",
  },
  {
    code: "js-syntax-error",
    re: /SyntaxError: Unexpected token|SyntaxError: Unexpected end of input/i,
    summary: "Malformed syntax — usually unbalanced brackets.",
    hint:
      "Count braces/parens around the reported line. The real mistake is often a missing `}` a few lines ABOVE where the parser gave up.",
  },
  {
    code: "js-missing-module",
    re: /Cannot find module ['"]([^'"]+)['"]/i,
    summary: "Import of a module the sandbox doesn't provide.",
    hint:
      "The sandbox vendors react/react-dom only — there's no npm install. Remove the import and inline the functionality, or use a vendored API. Hooks are already in scope in the React runtime.",
  },
  // ── Python ────────────────────────────────────────────────
  {
    code: "py-name-error",
    re: /NameError: name '(\w+)' is not defined/i,
    summary: "Name used before assignment/definition.",
    hint:
      "Define the variable/function before the line that uses it, or fix the typo. Remember Python executes top-to-bottom — calls above a `def` fail.",
  },
  {
    code: "py-indentation",
    re: /IndentationError|TabError/i,
    summary: "Inconsistent indentation.",
    hint:
      "Python blocks live and die by indentation. Re-indent the flagged block with consistent spaces (4 per level), and don't mix tabs with spaces.",
  },
  {
    code: "py-type-error",
    re: /TypeError: unsupported operand|TypeError: can only concatenate/i,
    summary: "Operation between incompatible types.",
    hint:
      "Convert explicitly: `str(n)` to concatenate into strings, `int(s)` to do math on parsed input.",
  },
];

/// File:line extractors per common toolchain format, tried in
/// order. The first match wins.
const LOCATION_RES: RegExp[] = [
  // Rust: `  --> src/main.rs:12:9`
  /-->\s+([^\s:]+):(\d+):\d+/,
  // Node stack: `at file:///…/main.js:3:7` or `(main.js:3:7)`
  /(?:at\s+|\()([^()\s]+\.(?:js|jsx|ts|tsx|mjs)):(\d+):\d+\)?/,
  // Python: `File "main.py", line 7`
  /File "([^"]+)", line (\d+)/,
  // Generic `path/file.ext:NN`
  /([^\s:]+\.(?:rs|py|go|c|cpp|java|kt|swift)):(\d+)/,
];

/// Diagnose a failed run. `text` should combine the error string
/// + recent log lines (caller joins). Returns null when nothing
/// in the table matches — the model just sees the raw error as
/// before, no worse than today.
export function diagnoseRunError(text: string): Diagnosis | null {
  if (!text) return null;
  const pattern = PATTERNS.find((p) => p.re.test(text));
  if (!pattern) return null;

  let file: string | undefined;
  let line: number | undefined;
  for (const re of LOCATION_RES) {
    const m = re.exec(text);
    if (m) {
      file = m[1];
      const n = parseInt(m[2], 10);
      if (Number.isFinite(n)) line = n;
      break;
    }
  }

  return {
    code: pattern.code,
    summary: pattern.summary,
    hint: pattern.hint,
    ...(file ? { file } : {}),
    ...(line !== undefined ? { line } : {}),
  };
}
