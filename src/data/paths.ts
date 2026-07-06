/// Curated learning paths — editorial sequences that thread the
/// catalog's courses, Exercism tracks, koans, and *-lings drill
/// packs into a goal-oriented journey ("become an entry-level
/// developer", "ship mobile apps", "go systems", …).
///
/// This is hand-curated content, not user data — same shape as
/// `src/data/achievements.ts` (a static module the UI reads).
///
/// ── Shape ────────────────────────────────────────────────────
/// A path is an ordered list of STAGES. A stage is either:
///   - a single `step` on the trunk, or
///   - a `fork` into named parallel BRANCHES (alternative routes —
///     "pick iOS or Android", "Zig route vs C route"). Branches
///     don't reconverge; each runs to its own end. That keeps the
///     horizontal tree tractable and matches how learning routes
///     actually branch (you pick a specialisation, you don't have
///     to do all of them).
///
/// `courseId`s are verified against the live catalog manifest
/// (`libre.academy/starter-courses/manifest.json`). A step whose
/// course isn't installed renders as an "add from Discover"
/// affordance rather than an error — paths are aspirational maps.
///
/// Icon is a string key resolved in the component (mirrors the
/// `resolveAchievementIcon` indirection) so this module stays free
/// of presentation imports.

import type { LanguageId } from "./types";

export type PathIconKey =
  | "briefcase"
  | "smartphone"
  | "cpu"
  | "server"
  | "blocks"
  | "workflow";

export interface PathStep {
  /// Matches a catalog / installed course id (manifest `id`).
  courseId: string;
  /// One-line "why this step / what it gets you" caption.
  note: string;
}

export interface PathBranch {
  id: string;
  /// Short lane label — "iOS", "Android", "Zig route", …
  label: string;
  steps: PathStep[];
}

export type PathStage =
  | { kind: "step"; step: PathStep }
  | {
      kind: "fork";
      /// Optional caption shown at the split ("Pick a platform").
      label?: string;
      branches: PathBranch[];
    };

export interface LearningPath {
  id: string;
  /// Role / outcome the path trains toward.
  title: string;
  /// One-paragraph pitch — what you'll be able to do at the end.
  blurb: string;
  /// Primary language represented by this path (for badges/tooltips).
  language: LanguageId;
  /// Presentation icon key (resolved in the component).
  icon: PathIconKey;
  /// Ordered stages, trunk left-to-right; forks fan out vertically.
  stages: PathStage[];
}

/// Display order top-to-bottom on the Paths page. The four core
/// LANGUAGE tracks come first — pure "learn this language, easiest to
/// hardest" trunks for someone who just wants a place to start. The
/// role / outcome paths (Rust Developer, Backend Engineer, …) follow:
/// they're deeper and branch into specialisations. Every `courseId`
/// below is verified against the live catalog manifest
/// (libre.academy/starter-courses/manifest.json).
export const LEARNING_PATHS: readonly LearningPath[] = [
  // ── Language tracks (easiest → hardest) ──────────────────────────
  {
    id: "rust",
    title: "Rust",
    blurb:
      "Learn Rust from zero to the deep end. The official book teaches ownership and the borrow checker, the drills make compiler errors feel like hints, then you test, take on hard problems, go async, and finally lift the hood with unsafe.",
    language: "rust",
    icon: "cpu",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "the-rust-programming-language",
          note: "Start here — the official book. Ownership, types, and the borrow checker from scratch.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "rustlings",
          note: "Tiny fix-the-code drills until compiler errors read like hints.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "exercism-rust",
          note: "Structured practice — one concept at a time.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "testing-rust",
          note: "Write tests like an engineer — unit through end-to-end.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "challenges-rust-handwritten",
          note: "Harder problems, no hand-holding — prove the fundamentals.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "rust-async-book",
          note: "Futures, executors, and pinning — concurrency the Rust way.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "rustonomicon",
          note: "The deep end: unsafe, raw pointers, and what the guarantees cost.",
        },
      },
    ],
  },
  {
    id: "go",
    title: "Go",
    blurb:
      "Pick up Go the practical way. A from-the-ground-up book covers goroutines, interfaces, and the standard library; the drills and structured practice build fluency; then harder problems prove you've got it.",
    language: "go",
    icon: "server",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "learning-go",
          note: "Start here — Go from the ground up: goroutines, interfaces, the standard library.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "golings",
          note: "Small fix-the-code drills, rustlings-style, for Go.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "exercism-go",
          note: "Structured practice — one concept at a time.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "challenges-go-handwritten",
          note: "Harder problems to prove the fundamentals.",
        },
      },
    ],
  },
  {
    id: "python",
    title: "Python",
    blurb:
      "Start programming with Python and keep going. From an absolute-beginner on-ramp to the full language, structured practice, Pythonic idioms, and finally problems with no training wheels.",
    language: "python",
    icon: "workflow",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "python-for-beginners",
          note: "Start here — programming from zero, no experience assumed.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "learning-python",
          note: "Go deeper: the full language — data structures, modules, and OOP.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "exercism-python",
          note: "Structured practice — one concept at a time.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "python-koans",
          note: "Learn Pythonic idioms by making failing tests pass.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "challenges-python-handwritten",
          note: "Harder problems, no training wheels.",
        },
      },
    ],
  },
  {
    id: "javascript",
    title: "JavaScript",
    blurb:
      "Learn the language of the web, end to end. Begin at absolute zero, work through the big in-house book into TypeScript, practise, master the quirks, understand how JS really works, then test like a pro and take on hard problems.",
    language: "javascript",
    icon: "blocks",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "javascript-for-beginners",
          note: "Start here — JavaScript from absolute zero.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "javascript-typescript",
          note: "The big one: JS in depth, then TypeScript layered on top.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "exercism-javascript",
          note: "Structured practice — one concept at a time.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "javascript-koans",
          note: "Learn the language's quirks by making failing tests pass.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "you-dont-know-js-yet",
          note: "Go deep on how JavaScript really works under the hood.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "testing-javascript",
          note: "Test JS like a pro — unit through end-to-end.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "challenges-javascript-handwritten",
          note: "Hard problems to prove you've mastered it.",
        },
      },
    ],
  },
  // ── Role / outcome paths ─────────────────────────────────────────
  {
    id: "rust-developer",
    title: "Rust Developer",
    blurb:
      "The complete Rust shelf, walked in order of difficulty. Start with the book that defines the language, drill it until ownership is reflex, learn to test like an engineer, then go async and finally under the hood with unsafe.",
    language: "rust",
    icon: "cpu",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "the-rust-programming-language",
          note: "The definitive first book — ownership, types, and the borrow checker.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "rustlings",
          note: "Small fix-the-code drills until compiler errors read like hints.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "exercism-rust",
          note: "Structured practice — concept by concept, exercise by exercise.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "testing-rust",
          note: "Unit to E2E: test Rust programs like a professional.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "challenges-rust-handwritten",
          note: "Hard problems, no training wheels — prove the fundamentals.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "rust-async-book",
          note: "Futures, executors, and pinning — concurrency the Rust way.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "rustonomicon",
          note: "The dark arts: unsafe, raw pointers, and what the guarantees cost.",
        },
      },
    ],
  },
  {
    id: "entry-level-developer",
    title: "Entry-Level Developer",
    blurb:
      "Your first job-ready stack. Learn one language end to end, drill the fundamentals until they're reflex, then add types and a database — the toolkit every junior role assumes you have.",
    language: "typescript",
    icon: "briefcase",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "javascript-typescript",
          note: "Your first language, cover to cover — JavaScript then TypeScript, syntax to shipping.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "javascript-koans",
          note: "Cement the fundamentals by fixing failing tests.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "exercism-javascript",
          note: "Drill core JavaScript until the patterns are reflex.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "exercism-typescript",
          note: "Add static types — the safety net every team expects.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "challenges-sql-handwritten",
          note: "Every app has a database. Learn to query one.",
        },
      },
    ],
  },
  {
    id: "mobile-app-developer",
    title: "Mobile App Developer",
    blurb:
      "Ship to phones. Pick a platform — native iOS with Swift, native Android with Kotlin, or cross-platform with Flutter's Dart — and follow that lane to fluency.",
    language: "swift",
    icon: "smartphone",
    stages: [
      {
        kind: "fork",
        label: "Pick a platform",
        branches: [
          {
            id: "ios",
            label: "iOS · Swift",
            steps: [
              {
                courseId: "exercism-swift",
                note: "Apple's app language, from the ground up.",
              },
              {
                courseId: "swiftlings",
                note: "Compiler-guided Swift drills — fix it till it builds.",
              },
            ],
          },
          {
            id: "android",
            label: "Android · Kotlin",
            steps: [
              {
                courseId: "kotlin-koans",
                note: "The modern Android language, learned by example.",
              },
              {
                courseId: "exercism-kotlin",
                note: "Idiomatic Kotlin at exercise scale.",
              },
            ],
          },
          {
            id: "cross-platform",
            label: "Cross-platform · Flutter",
            steps: [
              {
                courseId: "exercism-dart",
                note: "Flutter's language — one codebase, iOS + Android.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "systems-engineer",
    title: "Systems Engineer",
    blurb:
      "Work close to the metal. Master Rust the long way first, then branch into Zig for simplicity or C/C++ for the classic systems stack.",
    language: "rust",
    icon: "cpu",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "the-rust-programming-language",
          note: "The Rust book, cover to cover — ownership done right.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "rustlings",
          note: "Compiler-driven Rust drills, one failing test at a time.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "exercism-rust",
          note: "Idiomatic Rust across dozens of real exercises.",
        },
      },
      {
        kind: "fork",
        label: "Then go wider",
        branches: [
          {
            id: "zig",
            label: "Zig route",
            steps: [
              {
                courseId: "a-to-zig",
                note: "A smaller, sharper systems language from zero.",
              },
              {
                courseId: "ziglings",
                note: "Learn Zig by repairing broken programs.",
              },
            ],
          },
          {
            id: "c-cpp",
            label: "C / C++ route",
            steps: [
              {
                courseId: "exercism-c",
                note: "All the way down — manual memory, raw pointers, C.",
              },
              {
                courseId: "cplings",
                note: "Modern C++ drills to round out the toolkit.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "backend-engineer",
    title: "Backend Engineer",
    blurb:
      "Build the services behind the app. Learn Go the way production teams use it, drill it until it's muscle memory, and get fluent with SQL.",
    language: "go",
    icon: "server",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "learning-go",
          note: "Go from zero — the language built for services.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "golings",
          note: "Rustlings-style Go drills — compiler in the loop.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "exercism-go",
          note: "Idiomatic Go across a broad exercise set.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "challenges-sql-handwritten",
          note: "Query, join, and model data like a backend dev.",
        },
      },
    ],
  },
  {
    id: "blockchain-developer",
    title: "Blockchain Developer",
    blurb:
      "Build on-chain. Understand Bitcoin and Ethereum from first principles and ship a DeFi flow, then specialise in one of the newer contract languages.",
    language: "solidity",
    icon: "blocks",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "mastering-bitcoin",
          note: "How Bitcoin actually works, byte by byte.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "mastering-ethereum",
          note: "Smart contracts and the EVM, properly.",
        },
      },
      {
        kind: "fork",
        label: "Specialise",
        branches: [
          {
            id: "move",
            label: "Move",
            steps: [
              {
                courseId: "challenges-move-handwritten",
                note: "The safe asset language behind Aptos & Sui.",
              },
            ],
          },
          {
            id: "cairo",
            label: "Cairo",
            steps: [
              {
                courseId: "challenges-cairo-handwritten",
                note: "Provable computation, STARK-style.",
              },
            ],
          },
          {
            id: "sway",
            label: "Sway",
            steps: [
              {
                courseId: "challenges-sway-handwritten",
                note: "Fuel's Rust-flavoured contract language.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "functional-programmer",
    title: "Functional Programmer",
    blurb:
      "Think in pure functions and immutable data. Start with a deep Haskell foundation, then branch into Elixir for production systems or the JVM/Lisp world.",
    language: "haskell",
    icon: "workflow",
    stages: [
      {
        kind: "step",
        step: {
          courseId: "exercism-haskell",
          note: "Pure functional programming, lazy by default.",
        },
      },
      {
        kind: "step",
        step: {
          courseId: "haskellings",
          note: "Haskell drills — types first, then it compiles.",
        },
      },
      {
        kind: "fork",
        label: "Then specialise",
        branches: [
          {
            id: "elixir",
            label: "Elixir route",
            steps: [
              {
                courseId: "exercism-elixir",
                note: "Concurrent, fault-tolerant FP for real systems.",
              },
              {
                courseId: "exlings",
                note: "Elixir drills, Rustlings-style.",
              },
            ],
          },
          {
            id: "jvm-lisp",
            label: "JVM / Lisp route",
            steps: [
              {
                courseId: "exercism-scala",
                note: "Functional programming on the JVM.",
              },
              {
                courseId: "clojure-koans",
                note: "A Lisp where immutability is the default.",
              },
            ],
          },
        ],
      },
    ],
  },
] as const;

/// Lookup by id — used by the list→detail drill-in. Returns
/// undefined for unknown ids (caller falls back to the list).
export function getPath(id: string): LearningPath | undefined {
  return LEARNING_PATHS.find((p) => p.id === id);
}

/// Flatten every step in a path (trunk + all fork branches) into a
/// single array. The list-card progress bar sums over this — a
/// fork's branches are alternative routes, so counting all of them
/// toward the denominator slightly understates "% of the route I
/// picked", but it's the only honest aggregate without knowing
/// which branch the learner chose. The detail view shows per-branch
/// progress where that nuance matters.
export function flattenSteps(path: LearningPath): PathStep[] {
  const out: PathStep[] = [];
  for (const stage of path.stages) {
    if (stage.kind === "step") {
      out.push(stage.step);
    } else {
      for (const b of stage.branches) out.push(...b.steps);
    }
  }
  return out;
}
