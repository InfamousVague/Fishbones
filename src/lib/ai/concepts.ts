/// Concept engine — turns code (and prose, and compiler errors)
/// into the *teachable units* that connect a build to the course
/// library. It's the keystone of "teach while building": every
/// other teaching feature (the build journal, the "Learn this"
/// chips, gap-aware coaching, the post-build recap) is a view over
/// the concepts this module detects.
///
/// A `Concept` is a named programming idea ("Ownership", "Closures",
/// "async/await") with:
///   - `signals`   — regexes that detect it in SOURCE CODE,
///   - `aliases`   — names that detect it in PROSE / explanations,
///   - `blurb`     — a one-line plain-English definition,
///   - `query`     — a retrieval query that finds a lesson teaching
///                   it in the learner's installed courses,
///   - `prereqs`   — concept ids that should be understood first
///                   (a small dependency graph — the spine of
///                   "where should I start?" + gap analysis),
///   - `difficulty`— 1 intro / 2 core / 3 advanced.
///
/// Everything here is PURE (no React, no Tauri) so the taxonomy +
/// detection are unit-testable against Rust / JS / Python fixtures.
/// Lesson linking imports the retrieval engine (also pure) so a
/// caller gets `{ concept, lessons }` in one call.

import type { Course } from "@/data/types";
import { searchCourseContent, type RetrievalHit } from "./retrieval";

export type ConceptLang =
  | "rust"
  | "javascript"
  | "typescript"
  | "python";

export interface Concept {
  /// Stable id, e.g. "rust-ownership". Also the key used by the
  /// memory layer's struggle counters + the diagnosis bridge.
  id: string;
  /// Display label, e.g. "Ownership". Canonical English — the
  /// detection/retrieval engines and model prompts consume it
  /// directly; UI surfaces render the localized
  /// `practice.concepts.<id>.label` instead.
  label: string;
  /// Languages this concept belongs to. A build in one language
  /// only ever surfaces that language's concepts.
  langs: ConceptLang[];
  /// One-line plain-English definition. Injected into prompts so
  /// the model explains consistently; UI surfaces (chips, journal,
  /// tooltips) render the localized `practice.concepts.<id>.blurb`.
  blurb: string;
  /// Retrieval query that finds a lesson teaching this concept.
  query: string;
  /// Concept ids that should be understood first.
  prereqs: string[];
  /// 1 = intro, 2 = core, 3 = advanced.
  difficulty: 1 | 2 | 3;
  /// Code patterns that detect the concept in source.
  signals: RegExp[];
  /// Prose names (besides `label`) that detect a mention in an
  /// explanation. Matched as whole words, case-insensitive.
  aliases?: string[];
}

export interface ConceptHit {
  concept: Concept;
  /// A short slice of the source/prose that triggered the match —
  /// surfaced in the journal so the learner sees WHERE the concept
  /// shows up.
  evidence: string;
}

/// One concept paired with the lessons that teach it (resolved
/// against the learner's installed courses) + whether the learner
/// has likely already learned it.
export interface ConceptWithLessons {
  concept: Concept;
  lessons: RetrievalHit[];
  /// Heuristic: true when the learner has completed a lesson that
  /// strongly teaches this concept. "Likely" because lessons aren't
  /// concept-tagged at ingest yet — we infer from a top retrieval
  /// hit landing in the completed set. See `analyzeConceptCoverage`.
  learned: boolean;
}

// ── Taxonomy ────────────────────────────────────────────────
//
// Rust is deepest (The Rust Programming Language + Rustlings are
// the flagship courses); JS/TS + Python carry solid core coverage.
// Signals favour PRECISION — a false "you used closures" is worse
// than a missed one, because the whole point is trustworthy
// concept→lesson links. Implicit concepts that resist regex
// detection (ownership, lifetimes) lean on prose mentions, the
// prereq graph, and the diagnosis bridge instead of brittle code
// patterns.

const RUST: Concept[] = [
  {
    id: "rust-variables",
    label: "Variables & mutability",
    langs: ["rust"],
    blurb: "Bindings are immutable by default; `mut` opts into mutation.",
    query: "rust variables mutability let mut",
    prereqs: [],
    difficulty: 1,
    signals: [/\blet\s+mut\b/, /\blet\s+\w+\s*[:=]/],
    aliases: ["mutability", "immutable", "binding"],
  },
  {
    id: "rust-functions",
    label: "Functions",
    langs: ["rust"],
    blurb: "`fn` defines a function; the last expression is its return value.",
    query: "rust functions fn return",
    prereqs: [],
    difficulty: 1,
    signals: [/\bfn\s+\w+\s*\(/],
    aliases: ["function"],
  },
  {
    id: "rust-ownership",
    label: "Ownership",
    langs: ["rust"],
    blurb: "Each value has one owner; when the owner goes out of scope the value is dropped. Assigning a non-Copy value MOVES it.",
    query: "rust ownership move semantics drop",
    prereqs: ["rust-variables"],
    difficulty: 2,
    signals: [/String::from/, /\.to_owned\(\)/, /\.clone\(\)/, /Vec::new\(\)/],
    aliases: ["ownership", "move semantics", "moved value", "owner"],
  },
  {
    id: "rust-borrowing",
    label: "References & borrowing",
    langs: ["rust"],
    blurb: "`&` borrows a value without taking ownership; `&mut` borrows it mutably. Only one mutable XOR many immutable borrows at once.",
    query: "rust references borrowing borrow checker",
    prereqs: ["rust-ownership"],
    difficulty: 2,
    signals: [/&mut\s+\w/, /&\w+\b(?!\s*\w*::)/, /\bref\s+\w/],
    aliases: ["borrowing", "borrow checker", "reference", "borrow"],
  },
  {
    id: "rust-lifetimes",
    label: "Lifetimes",
    langs: ["rust"],
    blurb: "Lifetime annotations (`'a`) tell the compiler how long references must stay valid.",
    query: "rust lifetimes annotations references valid",
    prereqs: ["rust-borrowing"],
    difficulty: 3,
    signals: [/<\s*'[a-z]+\s*[,>]/, /&\s*'[a-z]+\s/],
    aliases: ["lifetime", "lifetimes", "lifetime annotation"],
  },
  {
    id: "rust-structs",
    label: "Structs",
    langs: ["rust"],
    blurb: "`struct` groups related data into a named type.",
    query: "rust structs fields methods impl",
    prereqs: [],
    difficulty: 2,
    signals: [/\bstruct\s+\w+/],
    aliases: ["struct", "structs"],
  },
  {
    id: "rust-enums",
    label: "Enums",
    langs: ["rust"],
    blurb: "`enum` defines a type that is one of several variants, each able to carry data.",
    query: "rust enums variants",
    prereqs: [],
    difficulty: 2,
    signals: [/\benum\s+\w+/],
    aliases: ["enum", "enums", "variant", "variants"],
  },
  {
    id: "rust-pattern-matching",
    label: "Pattern matching",
    langs: ["rust"],
    blurb: "`match` (and `if let`) destructures a value against patterns and runs the arm that fits.",
    query: "rust pattern matching match if let",
    prereqs: ["rust-enums"],
    difficulty: 2,
    signals: [/\bmatch\s+[\s\S]+?\{/, /\bif\s+let\s+/, /\bwhile\s+let\s+/],
    aliases: ["pattern matching", "match arm", "destructure"],
  },
  {
    id: "rust-option",
    label: "Option<T>",
    langs: ["rust"],
    blurb: "`Option<T>` encodes maybe-a-value as `Some(x)` or `None` — Rust's nullless way of handling absence.",
    query: "rust Option Some None null",
    prereqs: ["rust-enums"],
    difficulty: 2,
    signals: [/\bOption\s*<|->\s*Option/, /\bSome\s*\(/, /\bNone\b/],
    aliases: ["option", "some", "none"],
  },
  {
    id: "rust-result",
    label: "Result & the ? operator",
    langs: ["rust"],
    blurb: "`Result<T, E>` is `Ok(value)` or `Err(error)`; the `?` operator early-returns the error.",
    query: "rust Result Ok Err question mark error propagation",
    prereqs: ["rust-enums"],
    difficulty: 2,
    signals: [/\bResult\s*<|->\s*Result/, /\bOk\s*\(/, /\bErr\s*\(/, /\?\s*;/],
    aliases: ["result", "error propagation", "the ? operator"],
  },
  {
    id: "rust-error-handling",
    label: "Error handling",
    langs: ["rust"],
    blurb: "`panic!`, `.unwrap()`, and `.expect()` handle failure — fine for prototypes, but `Result` + `?` is the robust path.",
    query: "rust error handling panic unwrap expect",
    prereqs: ["rust-result"],
    difficulty: 2,
    signals: [/panic!\s*\(/, /\.unwrap\(\)/, /\.expect\(/],
    aliases: ["panic", "unwrap", "expect", "error handling"],
  },
  {
    id: "rust-traits",
    label: "Traits",
    langs: ["rust"],
    blurb: "A `trait` is shared behaviour types can implement — Rust's interfaces.",
    query: "rust traits impl for interface",
    prereqs: ["rust-structs"],
    difficulty: 3,
    signals: [/\btrait\s+\w+/, /\bimpl\s+\w+\s+for\s+\w+/, /\bdyn\s+\w/],
    aliases: ["trait", "traits", "trait object"],
  },
  {
    id: "rust-generics",
    label: "Generics",
    langs: ["rust"],
    blurb: "Generic type parameters (`<T>`) let one definition work over many types.",
    query: "rust generics type parameters",
    prereqs: ["rust-functions"],
    difficulty: 3,
    signals: [/\bfn\s+\w+\s*<[A-Z]/, /\bstruct\s+\w+\s*<[A-Z]/, /\bimpl\s*<[A-Z]/],
    aliases: ["generic", "generics", "type parameter"],
  },
  {
    id: "rust-closures",
    label: "Closures",
    langs: ["rust"],
    blurb: "A closure `|args| body` is an anonymous function that can capture its environment.",
    query: "rust closures capture environment",
    prereqs: ["rust-functions"],
    difficulty: 2,
    signals: [/\|[^|]*\|\s*\{/, /\|[^|]*\|\s*\w/, /move\s*\|/],
    aliases: ["closure", "closures"],
  },
  {
    id: "rust-iterators",
    label: "Iterators",
    langs: ["rust"],
    blurb: "Iterator adapters (`.iter().map().filter().collect()`) transform sequences lazily.",
    query: "rust iterators map filter collect",
    prereqs: ["rust-closures"],
    difficulty: 2,
    signals: [/\.iter(_mut)?\(\)/, /\.map\(/, /\.filter\(/, /\.collect\(/, /\.fold\(/, /\.enumerate\(\)/],
    aliases: ["iterator", "iterators", "iterator adapter"],
  },
  {
    id: "rust-collections",
    label: "Vec & collections",
    langs: ["rust"],
    blurb: "`Vec<T>` is a growable array; `HashMap<K, V>` a key-value store.",
    query: "rust vec vector hashmap collections",
    prereqs: [],
    difficulty: 1,
    signals: [/\bVec\s*<|vec!\s*\[/, /\bHashMap\b/, /\.push\(/],
    aliases: ["vector", "vec", "hashmap", "collection"],
  },
  {
    id: "rust-strings",
    label: "String vs &str",
    langs: ["rust"],
    blurb: "`String` is an owned, growable string; `&str` is a borrowed string slice.",
    query: "rust string str slice owned borrowed",
    prereqs: ["rust-ownership"],
    difficulty: 1,
    signals: [/\bString\b/, /&str\b/, /\.to_string\(\)/, /\.as_str\(\)/],
    aliases: ["string slice", "str", "&str"],
  },
  {
    id: "rust-modules",
    label: "Modules",
    langs: ["rust"],
    blurb: "`mod`, `use`, and `pub` organise code into a tree of namespaces and control visibility.",
    query: "rust modules mod use pub visibility",
    prereqs: [],
    difficulty: 2,
    signals: [/\bmod\s+\w+/, /\buse\s+[\w:]+/, /\bpub\s+(fn|struct|enum|mod)/],
    aliases: ["module", "modules", "visibility"],
  },
  {
    id: "rust-smart-pointers",
    label: "Smart pointers",
    langs: ["rust"],
    blurb: "`Box`, `Rc`, and `RefCell` give heap allocation, shared ownership, and interior mutability.",
    query: "rust smart pointers box rc refcell interior mutability",
    prereqs: ["rust-ownership"],
    difficulty: 3,
    signals: [/\bBox\s*<|Box::new/, /\bRc\s*<|Rc::new/, /\bRefCell\b/, /\bArc\s*<|Arc::new/],
    aliases: ["smart pointer", "box", "rc", "refcell", "interior mutability"],
  },
  {
    id: "rust-concurrency",
    label: "Concurrency",
    langs: ["rust"],
    blurb: "`thread::spawn` runs work in parallel; `Arc<Mutex<T>>` shares mutable state safely across threads.",
    query: "rust concurrency threads arc mutex",
    prereqs: ["rust-smart-pointers"],
    difficulty: 3,
    signals: [/thread::spawn/, /\bMutex\b/, /\bArc\s*<\s*Mutex/, /\.lock\(\)/],
    aliases: ["concurrency", "thread", "threads", "mutex"],
  },
];

const JS: Concept[] = [
  {
    id: "js-variables",
    label: "Variables",
    langs: ["javascript", "typescript"],
    blurb: "`const` binds an immutable reference, `let` a reassignable one; prefer `const`.",
    query: "javascript variables let const",
    prereqs: [],
    difficulty: 1,
    signals: [/\b(const|let|var)\s+\w+/],
    aliases: ["const", "let", "variable"],
  },
  {
    id: "js-functions",
    label: "Functions & arrow functions",
    langs: ["javascript", "typescript"],
    blurb: "`function` and arrow `=>` functions are first-class values you can pass around.",
    query: "javascript functions arrow function",
    prereqs: [],
    difficulty: 1,
    signals: [/\bfunction\s*\w*\s*\(/, /\([^)]*\)\s*=>/, /\w+\s*=>/],
    aliases: ["arrow function", "function"],
  },
  {
    id: "js-closures",
    label: "Closures",
    langs: ["javascript", "typescript"],
    blurb: "A closure is a function that remembers variables from the scope where it was created.",
    query: "javascript closures scope lexical",
    prereqs: ["js-functions"],
    difficulty: 2,
    signals: [/return\s+function/, /return\s+\([^)]*\)\s*=>/, /return\s+\w+\s*=>/],
    aliases: ["closure", "closures", "lexical scope"],
  },
  {
    id: "js-arrays",
    label: "Array methods",
    langs: ["javascript", "typescript"],
    blurb: "`map`, `filter`, and `reduce` transform arrays without mutating them.",
    query: "javascript array map filter reduce",
    prereqs: ["js-functions"],
    difficulty: 1,
    signals: [/\.map\(/, /\.filter\(/, /\.reduce\(/, /\.forEach\(/],
    aliases: ["map", "filter", "reduce", "array method"],
  },
  {
    id: "js-destructuring",
    label: "Destructuring",
    langs: ["javascript", "typescript"],
    blurb: "Destructuring pulls fields out of objects/arrays into bindings in one step.",
    query: "javascript destructuring object array spread",
    prereqs: ["js-variables"],
    difficulty: 1,
    signals: [/(const|let)\s*\{[^}]+\}\s*=/, /(const|let)\s*\[[^\]]+\]\s*=/, /\.\.\./],
    aliases: ["destructuring", "spread", "rest"],
  },
  {
    id: "js-async",
    label: "async / await",
    langs: ["javascript", "typescript"],
    blurb: "`async` functions return Promises; `await` pauses until a Promise settles.",
    query: "javascript async await promises asynchronous",
    prereqs: ["js-functions"],
    difficulty: 2,
    signals: [/\basync\s+/, /\bawait\s+/, /\bPromise\b/, /\.then\(/],
    aliases: ["async", "await", "promise", "asynchronous"],
  },
  {
    id: "js-modules",
    label: "Modules (import/export)",
    langs: ["javascript", "typescript"],
    blurb: "`import`/`export` split code across files with explicit dependencies.",
    query: "javascript modules import export",
    prereqs: [],
    difficulty: 1,
    signals: [/\bimport\s+.+from/, /\bexport\s+(default\s+)?/],
    aliases: ["import", "export", "module"],
  },
  {
    id: "js-classes",
    label: "Classes",
    langs: ["javascript", "typescript"],
    blurb: "`class` defines a blueprint with a constructor, methods, and inheritance via `extends`.",
    query: "javascript classes constructor extends inheritance",
    prereqs: ["js-functions"],
    difficulty: 2,
    signals: [/\bclass\s+\w+/, /\bconstructor\s*\(/, /\bextends\s+\w/],
    aliases: ["class", "classes", "inheritance", "constructor"],
  },
  {
    id: "react-hooks",
    label: "React hooks",
    langs: ["javascript", "typescript"],
    blurb: "`useState` holds component state; `useEffect` runs side effects after render.",
    query: "react hooks useState useEffect state",
    prereqs: ["js-functions"],
    difficulty: 2,
    signals: [/\buseState\s*\(/, /\buseEffect\s*\(/, /\buse[A-Z]\w*\s*\(/],
    aliases: ["hook", "hooks", "usestate", "useeffect"],
  },
  {
    id: "react-jsx",
    label: "JSX & components",
    langs: ["javascript", "typescript"],
    blurb: "JSX lets a function component return markup; props pass data down.",
    query: "react jsx components props",
    prereqs: ["js-functions"],
    difficulty: 2,
    signals: [/return\s*\(?\s*</, /<\/[A-Z]\w*>/, /<[A-Z]\w*[\s/>]/],
    aliases: ["jsx", "component", "props"],
  },
  {
    id: "ts-types",
    label: "TypeScript types",
    langs: ["typescript"],
    blurb: "`interface`/`type` annotations catch shape mismatches before the code runs.",
    query: "typescript types interface type annotations",
    prereqs: ["js-variables"],
    difficulty: 2,
    signals: [/\binterface\s+\w+/, /\btype\s+\w+\s*=/, /:\s*(string|number|boolean)\b/],
    aliases: ["interface", "type annotation", "typescript type"],
  },
];

const PY: Concept[] = [
  {
    id: "py-variables",
    label: "Variables",
    langs: ["python"],
    blurb: "Python variables are names bound to objects — no declaration keyword needed.",
    query: "python variables assignment",
    prereqs: [],
    difficulty: 1,
    signals: [/^\s*\w+\s*=\s*[^=]/m],
    aliases: ["variable", "assignment"],
  },
  {
    id: "py-functions",
    label: "Functions",
    langs: ["python"],
    blurb: "`def` defines a function; `return` hands back a value.",
    query: "python functions def return",
    prereqs: [],
    difficulty: 1,
    signals: [/\bdef\s+\w+\s*\(/],
    aliases: ["function", "def"],
  },
  {
    id: "py-comprehensions",
    label: "Comprehensions",
    langs: ["python"],
    blurb: "List/dict comprehensions build a collection inline: `[f(x) for x in xs]`.",
    query: "python list comprehension dict comprehension",
    prereqs: ["py-functions"],
    difficulty: 2,
    signals: [/\[[^\]]*\bfor\b[^\]]*\]/, /\{[^}]*\bfor\b[^}]*\}/],
    aliases: ["comprehension", "list comprehension"],
  },
  {
    id: "py-classes",
    label: "Classes",
    langs: ["python"],
    blurb: "`class` defines a type; `__init__` is its constructor, `self` the instance.",
    query: "python classes __init__ self methods",
    prereqs: ["py-functions"],
    difficulty: 2,
    signals: [/\bclass\s+\w+/, /\bdef\s+__init__/, /\bself\b/],
    aliases: ["class", "classes", "__init__", "method"],
  },
  {
    id: "py-exceptions",
    label: "Exceptions",
    langs: ["python"],
    blurb: "`try`/`except` catches errors so the program can recover instead of crashing.",
    query: "python exceptions try except raise",
    prereqs: [],
    difficulty: 2,
    signals: [/\btry\s*:/, /\bexcept\b/, /\braise\s+\w/],
    aliases: ["exception", "try except", "raise"],
  },
  {
    id: "py-decorators",
    label: "Decorators",
    langs: ["python"],
    blurb: "A decorator `@name` wraps a function to add behaviour without changing its body.",
    query: "python decorators wrapping functions",
    prereqs: ["py-functions"],
    difficulty: 3,
    signals: [/^\s*@\w+/m],
    aliases: ["decorator", "decorators"],
  },
  {
    id: "py-generators",
    label: "Generators",
    langs: ["python"],
    blurb: "`yield` makes a function a generator that produces values lazily, one at a time.",
    query: "python generators yield lazy iteration",
    prereqs: ["py-functions"],
    difficulty: 3,
    signals: [/\byield\s+/],
    aliases: ["generator", "generators", "yield"],
  },
  {
    id: "py-fstrings",
    label: "f-strings",
    langs: ["python"],
    blurb: "f-strings interpolate expressions into text: `f\"{name} is {age}\"`.",
    query: "python f-strings formatting interpolation",
    prereqs: ["py-variables"],
    difficulty: 1,
    signals: [/f"[^"]*\{[^}]+\}/, /f'[^']*\{[^}]+\}/],
    aliases: ["f-string", "f-strings", "string formatting"],
  },
];

export const CONCEPTS: readonly Concept[] = [...RUST, ...JS, ...PY];

const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

export function conceptById(id: string): Concept | undefined {
  return BY_ID.get(id);
}

/// Resolve a free-text concept name (or id) to a concept — the
/// lookup the `explain_concept` / `suggest_lessons` tutor tools use
/// so a learner's "explain ownership" or "borrowing" lands on the
/// right node. Tries, in order: exact id, exact label, whole-word
/// alias/label mention, then a loose label substring. `language`
/// (optional) narrows the alias search to avoid a Python "class"
/// matching a Rust question. Returns undefined when nothing fits —
/// the caller falls back to a plain prose answer.
export function findConceptByName(
  query: string,
  language?: string,
): Concept | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const lc = q.toLowerCase();
  const byId = BY_ID.get(lc);
  if (byId) return byId;
  const exactLabel = CONCEPTS.find((c) => c.label.toLowerCase() === lc);
  if (exactLabel) return exactLabel;
  const mentions = detectConceptMentions(q, language);
  if (mentions.length > 0) return mentions[0];
  return CONCEPTS.find(
    (c) =>
      c.label.toLowerCase().includes(lc) ||
      (c.aliases ?? []).some((a) => a.toLowerCase() === lc),
  );
}

/// Normalise an app `LanguageId` to a concept language family.
/// React/Solid/Svelte/etc. map to javascript; everything outside
/// the taught trio returns null (no concepts surfaced).
export function conceptLangFor(language: string): ConceptLang | null {
  const l = language.toLowerCase();
  if (l === "rust") return "rust";
  if (l === "python") return "python";
  if (l === "typescript") return "typescript";
  if (
    l === "javascript" ||
    l === "react" ||
    l === "reactnative" ||
    l === "solid" ||
    l === "svelte" ||
    l === "astro" ||
    l === "htmx" ||
    l === "bun" ||
    l === "web" ||
    l === "threejs"
  ) {
    return "javascript";
  }
  return null;
}

export function conceptsForLanguage(lang: ConceptLang): Concept[] {
  // typescript builds also surface javascript concepts (a TS file
  // uses closures/async/etc. too); javascript does NOT surface
  // typescript-only concepts.
  return CONCEPTS.filter((c) => {
    if (c.langs.includes(lang)) return true;
    if (lang === "typescript" && c.langs.includes("javascript")) return true;
    return false;
  });
}

/// Detect concepts present in a block of SOURCE CODE. Returns hits
/// sorted by difficulty desc then label (advanced concepts lead —
/// they're the most worth explaining). Each hit carries the line
/// that triggered it as evidence.
export function detectConceptsInCode(
  code: string,
  language: string,
): ConceptHit[] {
  const lang = conceptLangFor(language);
  if (!lang || !code) return [];
  const pool = conceptsForLanguage(lang);
  const hits: ConceptHit[] = [];
  for (const concept of pool) {
    let evidence: string | null = null;
    for (const re of concept.signals) {
      const m = re.exec(code);
      if (m) {
        evidence = lineAround(code, m.index);
        break;
      }
    }
    if (evidence !== null) hits.push({ concept, evidence });
  }
  return sortHits(hits);
}

/// Detect concepts MENTIONED in prose (an explanation, a lesson
/// body, a chat message). Matches `label` + `aliases` as whole
/// words. `language` optionally narrows the pool to avoid e.g. a
/// Python "class" mention matching while discussing Rust.
export function detectConceptMentions(
  text: string,
  language?: string,
): Concept[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const pool = language
    ? (() => {
        const l = conceptLangFor(language);
        return l ? conceptsForLanguage(l) : CONCEPTS;
      })()
    : CONCEPTS;
  const out: Concept[] = [];
  for (const concept of pool) {
    const names = [concept.label, ...(concept.aliases ?? [])];
    const found = names.some((n) => containsWord(lower, n.toLowerCase()));
    if (found) out.push(concept);
  }
  // De-dup (a concept could match label AND alias).
  return Array.from(new Set(out));
}

/// Bridge to the error-diagnosis layer: a diagnosis `code`
/// (e.g. "rust-E0382") maps to the concept the learner is
/// struggling with. Lets a failed run surface "you hit a move
/// error — here's the Ownership lesson" deterministically.
const DIAGNOSIS_TO_CONCEPT: Record<string, string> = {
  "rust-E0382": "rust-ownership",
  "rust-E0502": "rust-borrowing",
  "rust-E0499": "rust-borrowing",
  "rust-E0597": "rust-lifetimes",
  "rust-E0308": "rust-functions",
  "rust-E0425": "rust-variables",
  "rust-E0432": "rust-modules",
  "rust-borrow-checker-lifetime": "rust-lifetimes",
  "rust-missing-semicolon": "rust-functions",
  "js-reference-error": "js-variables",
  "js-undefined-property": "react-hooks",
  "js-not-a-function": "js-functions",
  "js-syntax-error": "js-functions",
  "js-missing-module": "js-modules",
  "py-name-error": "py-variables",
  "py-indentation": "py-functions",
  "py-type-error": "py-variables",
};

export function conceptForDiagnosis(code: string): Concept | undefined {
  const id = DIAGNOSIS_TO_CONCEPT[code];
  return id ? BY_ID.get(id) : undefined;
}

/// Expand a concept's transitive prerequisites, prereqs-first
/// (a topological order). The concept itself is the LAST element.
/// Drives "to understand X you'll first want Y then Z".
export function prerequisiteChain(conceptId: string): Concept[] {
  const order: Concept[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const c = BY_ID.get(id);
    if (!c) return;
    for (const p of c.prereqs) visit(p);
    order.push(c);
  };
  visit(conceptId);
  return order;
}

/// Link a concept to the lessons that teach it, in the learner's
/// installed courses. Uses the retrieval engine over the concept's
/// `query` + `label`. `currentCourseId` (optional) biases toward
/// the course the learner is studying.
export function lessonsForConcept(
  courses: readonly Course[],
  concept: Concept,
  k = 2,
  currentCourseId?: string,
): RetrievalHit[] {
  const query = `${concept.label} ${concept.query}`;
  return searchCourseContent(courses, query, k, { currentCourseId });
}

/// Full coverage analysis for a set of detected concepts: pair each
/// with its teaching lessons and a `learned` flag inferred from the
/// completed set. Sorted so UNLEARNED, harder concepts lead — those
/// are the ones worth teaching first.
///
/// The `learned` heuristic: a concept counts as learned when its
/// single strongest teaching lesson (top retrieval hit) is in the
/// completed set. It's deliberately conservative — lessons aren't
/// concept-tagged at ingest yet, so we only claim "learned" on a
/// strong, completed match. Honest under-claiming beats telling a
/// learner they've mastered something they haven't.
export function analyzeConceptCoverage(
  concepts: readonly Concept[],
  courses: readonly Course[],
  completed: ReadonlySet<string>,
  currentCourseId?: string,
): ConceptWithLessons[] {
  const out: ConceptWithLessons[] = concepts.map((concept) => {
    const lessons = lessonsForConcept(courses, concept, 3, currentCourseId);
    const top = lessons[0];
    const learned =
      !!top && completed.has(`${top.courseId}:${top.lessonId}`);
    return { concept, lessons, learned };
  });
  // Unlearned first; then by difficulty desc; then label.
  return out.sort((a, b) => {
    if (a.learned !== b.learned) return a.learned ? 1 : -1;
    if (a.concept.difficulty !== b.concept.difficulty) {
      return b.concept.difficulty - a.concept.difficulty;
    }
    return a.concept.label.localeCompare(b.concept.label);
  });
}

// ── helpers ─────────────────────────────────────────────────

function sortHits(hits: ConceptHit[]): ConceptHit[] {
  return hits.sort((a, b) => {
    if (a.concept.difficulty !== b.concept.difficulty) {
      return b.concept.difficulty - a.concept.difficulty;
    }
    return a.concept.label.localeCompare(b.concept.label);
  });
}

function lineAround(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  let end = text.indexOf("\n", index);
  if (end === -1) end = text.length;
  return text.slice(start, end).trim().slice(0, 120);
}

/// Whole-word-ish containment for multi-word phrases. Boundaries
/// are non-alphanumeric; works for "borrow checker", "async",
/// "&str". Avoids matching "class" inside "classification".
function containsWord(haystackLower: string, needleLower: string): boolean {
  if (!needleLower) return false;
  let from = 0;
  while (true) {
    const idx = haystackLower.indexOf(needleLower, from);
    if (idx === -1) return false;
    const before = idx === 0 ? " " : haystackLower[idx - 1];
    const afterIdx = idx + needleLower.length;
    const after =
      afterIdx >= haystackLower.length ? " " : haystackLower[afterIdx];
    const boundary = (ch: string) => !/[a-z0-9]/.test(ch);
    // The needle may itself start/end with a non-word char (e.g.
    // "&str"); only require a boundary on the alphanumeric side.
    const leftOk = !/[a-z0-9]/.test(needleLower[0]) || boundary(before);
    const rightOk =
      !/[a-z0-9]/.test(needleLower[needleLower.length - 1]) || boundary(after);
    if (leftOk && rightOk) return true;
    from = idx + 1;
  }
}
