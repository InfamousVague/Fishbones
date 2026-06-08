/// Generate two progressive hints per exercise lesson in The Rust
/// Programming Language course.
///
///   Hint 0: "Remember: <first instructional paragraph from the body>"
///   Hint 1: A concrete technique nudge derived from comparing the
///           solution against the starter — every Rust token that's
///           in the solution but NOT in the starter is something the
///           learner must introduce, mapped through `TECHNIQUE_HINTS`
///           to plain English. Multi-token solutions collapse to the
///           top 2-3 most pedagogically meaningful, capped at ~180
///           chars total so hints stay digestible.
///
/// Output is identity-stable: re-running over a lesson whose
/// `hints[0]` starts with the "Remember: " signature regenerates
/// in place (lets us iterate the heuristics). Lessons whose hint
/// shape doesn't match the signature are presumed hand-authored and
/// left alone.
///
/// Both source copies (Apps + Web public) are written so the
/// sync:courses pipeline doesn't revert the change on next deploy
/// — same pattern as the dangle-playground patch.

import { readFileSync, writeFileSync } from "node:fs";

const PATHS = [
  "/Users/matt/Development/Apps/Libre.academy/public/starter-courses/the-rust-programming-language.json",
  "/Users/matt/Development/Web/libre.academy/public/starter-courses/the-rust-programming-language.json",
];

// ── 1. Body → concept reminder ──────────────────────────────────
// Same logic as `scripts/add-rustlings-hints.mjs`: walk the body
// paragraph-by-paragraph, skip meta/credit lines, take the first
// real conceptual paragraph. Returns null if nothing usable —
// caller falls back.
const META_PATTERNS = [
  /^these exercises are adapted/i,
  /^this section will teach you/i,
  /^in this section/i,
  /^welcome to/i,
  /^thank you/i,
  /^thanks to/i,
  /^for this section, the book/i,
  /^confirm the install/i,         // TRPL-specific — verify-rust-installation
];

function isMeta(text) {
  return META_PATTERNS.some((re) => re.test(text));
}

function cleanup(buf) {
  let text = buf.join(" ");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/`([^`]+)`/g, "`$1`");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function trimToSentence(text, cap = 200) {
  if (text.length <= cap) return text;
  const cut = text.slice(0, cap);
  const last = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return last > 80 ? cut.slice(0, last + 1).trim() : cut.trim() + "…";
}

function deriveConcept(body) {
  if (!body || typeof body !== "string") return null;
  const lines = body.split(/\r?\n/);
  let i = 0;
  // Skip leading headings + blank lines.
  while (i < lines.length && (lines[i].trim() === "" || lines[i].startsWith("#"))) i++;
  while (i < lines.length) {
    const buf = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") { i++; if (buf.length) break; continue; }
      if (line.startsWith("##")) return null;
      // Skip pure-callout / quote lines so we get teaching prose.
      if (/^>\s/.test(line)) { i++; continue; }
      // Skip pure bullet lines.
      if (/^[-*+]\s/.test(line)) { i++; continue; }
      buf.push(line.trim());
      i++;
    }
    if (!buf.length) continue;
    const text = cleanup(buf);
    if (!isMeta(text) && text.length > 20) return trimToSentence(text);
  }
  return null;
}

// ── 2. Solution-vs-starter token diff → technique hint ──────────
// Map of Rust tokens / patterns to plain-English nudges. Order
// matters within a lesson: the higher-yield techniques (control
// flow, ownership, iterators) come first so multi-token hints
// surface the central technique not the trivia.
const TECHNIQUE_HINTS = [
  { re: /\?\s*;|\?\s*$|\?\s*\)/m, hint: "use the `?` operator to propagate errors instead of nesting matches" },
  { re: /\bmatch\b/, hint: "use a `match` expression to handle every variant exhaustively" },
  { re: /\bif\s+let\b/, hint: "destructure with `if let` to handle one variant cleanly" },
  { re: /\bwhile\s+let\b/, hint: "loop with `while let` to keep pulling values while the variant matches" },
  { re: /\bloop\s*\{/, hint: "use a `loop` block — `break value;` returns a value out of the loop" },
  { re: /\bSome\s*\(|\bNone\b/, hint: "wrap the value in `Some(...)` (or return `None`)" },
  { re: /\bOk\s*\(|\bErr\s*\(/, hint: "return `Ok(value)` on success or `Err(message)` on failure" },
  { re: /\.iter\s*\(|\.into_iter\s*\(|\.iter_mut\s*\(/, hint: "iterate with `.iter()` / `.into_iter()` and chain transformations" },
  { re: /\.map\s*\(|\.filter\s*\(|\.fold\s*\(|\.sum\s*\(|\.collect\s*\(/, hint: "chain iterator combinators (`map`, `filter`, `collect`, …)" },
  { re: /&mut\s+\w/, hint: "take a `&mut` reference so the function can mutate without taking ownership" },
  { re: /\blet\s+mut\b/, hint: "declare the binding `let mut` — Rust bindings are immutable by default" },
  { re: /\bmut\s+\w+\s*:/, hint: "add `mut` to the parameter so the function can modify the binding it owns" },
  { re: /&'?\w*\s*str\b|&\s*String\b/, hint: "take/return a string slice (`&str`) instead of an owned `String` where possible" },
  { re: /String::from|\.to_string\s*\(|\.to_owned\s*\(/, hint: "turn the slice into an owned `String` with `String::from(...)` or `.to_string()`" },
  { re: /\.push_str\s*\(|\.push\s*\(/, hint: "build the string up incrementally with `.push_str(...)` / `.push(...)`" },
  { re: /\bVec::new\s*\(|\bvec!\s*\[/, hint: "construct the collection with `Vec::new()` or the `vec![…]` macro" },
  { re: /\.unwrap_or\s*\(|\.unwrap_or_else\s*\(|\.unwrap_or_default\s*\(/, hint: "use `.unwrap_or(...)` / `.unwrap_or_default()` for a safe default when the value isn't there" },
  { re: /\.expect\s*\(/, hint: "use `.expect(\"context\")` so the panic message tells you what went wrong" },
  { re: /\bBox\s*</, hint: "heap-allocate with `Box<...>` when the size isn't known at compile time" },
  { re: /\bdyn\s+\w/, hint: "the return type needs a `dyn Trait` — a trait object that erases the concrete type" },
  { re: /\bimpl\s+\w/, hint: "use `impl Trait` in the return position when there's exactly one concrete type" },
  { re: /\bself\b|\bSelf\b/, hint: "the method belongs on the type — take `self` (or `&self`, `&mut self`) as the first parameter" },
  { re: /\benum\s+\w/, hint: "model the alternatives with an `enum` — each variant is a distinct shape" },
  { re: /\bstruct\s+\w/, hint: "introduce a `struct` to group the fields together" },
  { re: /\btrait\s+\w/, hint: "define the shared behaviour as a `trait`" },
  { re: /\bfor\s+\w+\s+in\s+/, hint: "iterate with `for x in collection` — cleanest when you don't need the index" },
  { re: /\.clone\s*\(/, hint: "call `.clone()` when you need an independent owned copy (cheap escape hatch for ownership puzzles)" },
  { re: /\bas\s+(usize|isize|i\d+|u\d+|f\d+|char)\b/, hint: "convert with an `as` cast to bridge the integer/float/char boundary" },
  { re: /\.parse\s*::?</, hint: "parse the string with `.parse::<T>()` — annotate the target type so Rust knows what to produce" },
  { re: /\.split\s*\(|\.split_whitespace\s*\(|\.lines\s*\(/, hint: "split the input first (`.split(...)`, `.split_whitespace()`, `.lines()`)" },
  { re: /\.len\s*\(|\.is_empty\s*\(/, hint: "check the length with `.len()` (or `.is_empty()` for the zero case)" },
  { re: /\.contains\s*\(|\.starts_with\s*\(|\.ends_with\s*\(/, hint: "ask the string directly — `.contains(...)`, `.starts_with(...)`, `.ends_with(...)`" },
  { re: /\.get\s*\(/, hint: "use `.get(...)` for safe indexed access — returns `Option<&T>` instead of panicking" },
  { re: /\.entry\s*\(/, hint: "use HashMap's `.entry(key).or_insert(...)` to update-or-insert in one step" },
];

function deriveTechnique(starter, solution) {
  if (!solution || typeof solution !== "string") return null;
  const inStarter = starter || "";
  const phrases = [];
  for (const { re, hint } of TECHNIQUE_HINTS) {
    if (re.test(solution) && !re.test(inStarter)) {
      phrases.push(hint);
      if (phrases.length >= 2) break; // cap at two techniques per hint
    }
  }
  if (phrases.length === 0) return null;
  // Join with " — " so the two nudges read as a single, escalating
  // hint rather than two disconnected sentences.
  return phrases.join(" — ");
}

// ── 3. Stitch ────────────────────────────────────────────────────
const REMEMBER_PREFIX = "Remember: ";
const GENERIC_PROBE = "Read the function signatures + the tests — they fully describe what shape the answer must take. Work backwards from the return type.";

function buildHints(lesson) {
  const concept = deriveConcept(lesson.body);
  const technique = deriveTechnique(lesson.starter || "", lesson.solution || "");
  const hint1 = concept
    ? REMEMBER_PREFIX + concept
    : "Re-read the lesson body above for the concept being exercised — then look at the function signatures below.";
  const hint2 = technique || GENERIC_PROBE;
  return [hint1, hint2];
}

// ── 4. Driver ────────────────────────────────────────────────────
const PLACEHOLDER_RE = /^(no hints this time|let the compiler guide you)/i;

function shouldRegenerate(existing) {
  if (!Array.isArray(existing)) return true;
  const real = existing.filter(
    (h) => typeof h === "string" && h.trim().length > 0 && !PLACEHOLDER_RE.test(h),
  );
  if (real.length < 2) return true;
  // Re-derive if the first hint looks like prior script output
  // (so we can iterate). Hand-authored hints (anything else)
  // are preserved.
  return real[0].startsWith(REMEMBER_PREFIX) ||
    real[0].startsWith("Re-read the lesson body");
}

function patch(path) {
  const course = JSON.parse(readFileSync(path, "utf8"));
  let touched = 0, skipped = 0;
  for (const ch of course.chapters) {
    for (const l of ch.lessons) {
      if (l.kind !== "exercise" && l.kind !== "mixed") continue;
      if (!shouldRegenerate(l.hints)) { skipped++; continue; }
      l.hints = buildHints(l);
      touched++;
    }
  }
  writeFileSync(path, JSON.stringify(course, null, 2) + "\n");
  return { touched, skipped, sizeBytes: Buffer.byteLength(JSON.stringify(course, null, 2) + "\n") };
}

for (const p of PATHS) {
  const r = patch(p);
  console.log(`✓ ${p} → patched ${r.touched} lesson(s), preserved ${r.skipped}, sizeBytes ${r.sizeBytes}`);
}
