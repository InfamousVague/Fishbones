/// Skill-tree data. Each tree is a directed acyclic graph of skill
/// nodes; each node carries a list of "matches" pointing at one or
/// more lessons in the existing course library that teach that skill.
///
/// The `<TreesView>` UI walks these structures top-down (vertical
/// layout — root at top, depth grows downward), gates each node on
/// the completion state of its prerequisites (hard-gate: a locked
/// node is unclickable until every `prereqs` entry is `complete`),
/// and surfaces the next-up node by highlighting the topologically
/// nearest unlocked-but-incomplete skill.
///
/// Lesson matching was driven by an audit pass against the user's
/// installed library — see `docs/skill-tree-gaps.md` for the gap
/// report. Skills with no current content are marked with
/// `matches: []` and `gapNote` so the UI can render them as a
/// "content needed" placeholder rather than a clickable lesson link.
///
/// Adding a new tree:
///   1. Add an entry to `TREES` below.
///   2. Each `nodes[]` row needs a unique `id`, a short `label` for
///      the card, a `summary` for the tooltip, an array of `prereqs`
///      (other node ids in the SAME tree — cross-tree prereqs aren't
///      supported), and a `matches` array of `{ courseId, lessonId }`
///      tuples. Empty `matches` flags a content gap.
///   3. The first prereq-less node is the tree root. The layout
///      algorithm assigns each node a `depth = max(prereq.depth) + 1`
///      so multi-rooted trees just get parallel columns at depth 0.

import type { Course } from "./types";

export interface SkillMatch {
  /// Course id (in-zip id, matches what storage.loadCourse returns).
  courseId: string;
  /// Lesson id within that course's chapters.lessons array.
  lessonId: string;
}

export interface SkillNode {
  id: string;
  label: string;
  /// 1-2 sentence description shown on hover and in the side panel.
  summary: string;
  /// Other node ids in this same tree that must be complete before
  /// this one unlocks. Empty array = root node.
  prereqs: readonly string[];
  /// Lessons that teach this skill. The first entry is the canonical
  /// teacher; additional entries are alternatives the learner can
  /// pick from. Empty array = content gap (UI shows "Coming soon").
  matches: readonly SkillMatch[];
  /// Set when `matches` is empty. Surfaced in the gap report and the
  /// node's tooltip so we know what's missing if it can't be filled.
  gapNote?: string;
  /// Optional node kind. "section" nodes are categorical organizers
  /// (e.g. "Frameworks", "Production Readiness") that group their
  /// descendants visually but don't carry their own lesson. They
  /// always read as "complete" for unlock-gating purposes (so they
  /// never block dependents) and are excluded from progress %
  /// calculations and the gap report.
  kind?: "section";
}

export interface SkillTree {
  id: string;
  title: string;
  /// Two-word tag for the tree shelf card and the suggestion-engine
  /// "next tree" prompt. Examples: "Foundations", "Web Dev".
  short: string;
  description: string;
  /// Which audience the tree targets. The Trees landing page splits
  /// "beginner" trees (Foundations) from "specialty" trees so a new
  /// learner has an obvious on-ramp.
  audience: "beginner" | "specialty";
  /// Visual accent — a hex string used for the tree's card border,
  /// node ring, and progress bar. Picked from the Fishbones cover
  /// palette so each tree has a distinct identity in the shelf.
  accent: string;
  nodes: readonly SkillNode[];
}

// ─────────────────────────────────────────────────────────────────
// Tree 1: Foundations — the absolute beginner's on-ramp.
// ─────────────────────────────────────────────────────────────────

const FOUNDATIONS: SkillTree = {
  id: "foundations",
  title: "Programming Foundations",
  short: "Foundations",
  audience: "beginner",
  accent: "#7faaff",
  description:
    "Twenty skills every programmer needs before any specialty tree makes sense. Variables, control flow, functions, data structures, error handling, I/O, testing.",
  nodes: [
    {
      id: "variables",
      label: "Variables",
      summary:
        "Naming a value so you can refer to it by name and reassign it later.",
      prereqs: [],
      matches: [
        { courseId: "python-crash-course", lessonId: "creating-and-using-variables" },
        { courseId: "python-crash-course", lessonId: "variable-naming-rules" },
        { courseId: "eloquent-javascript", lessonId: "ch01-reading" },
      ],
    },
    {
      id: "arithmetic",
      label: "Arithmetic",
      summary: "Numbers, operators, and how + - * / behave on integer vs float.",
      prereqs: ["variables"],
      matches: [
        { courseId: "python-crash-course", lessonId: "underscores-multiple-assignment-constants" },
        { courseId: "learning-go", lessonId: "booleans-and-numeric-types" },
        { courseId: "the-rust-programming-language", lessonId: "scalar-data-types" },
      ],
    },
    {
      id: "strings",
      label: "Strings",
      summary: "Text values, quoting rules, methods, and string formatting.",
      prereqs: ["variables"],
      matches: [
        { courseId: "python-crash-course", lessonId: "strings-and-quotes" },
        { courseId: "python-crash-course", lessonId: "string-case-methods" },
        { courseId: "python-crash-course", lessonId: "f-strings-for-formatting" },
      ],
    },
    {
      id: "booleans",
      label: "Booleans",
      summary: "true/false values and the operators that produce them.",
      prereqs: ["variables"],
      matches: [
        { courseId: "learning-zig", lessonId: "booleans-and-comparisons" },
        { courseId: "python-crash-course", lessonId: "intro-to-conditionals" },
      ],
    },
    {
      id: "comparisons",
      label: "Comparisons",
      summary: "==, <, >, !=, and combining conditions with and/or.",
      prereqs: ["booleans"],
      matches: [
        { courseId: "python-crash-course", lessonId: "intro-to-conditionals" },
        { courseId: "python-crash-course", lessonId: "combining-conditions-and-or" },
        { courseId: "learning-zig", lessonId: "booleans-and-comparisons" },
      ],
    },
    {
      id: "if-else",
      label: "If / Else",
      summary: "Branching execution based on a condition.",
      prereqs: ["comparisons"],
      matches: [
        { courseId: "python-crash-course", lessonId: "simple-if-statements" },
        { courseId: "python-crash-course", lessonId: "if-elif-else-chains" },
        { courseId: "the-rust-programming-language", lessonId: "control-flow-if-expressions" },
      ],
    },
    {
      id: "while-loops",
      label: "While Loops",
      summary: "Repeat a block while a condition is true.",
      prereqs: ["if-else"],
      matches: [
        { courseId: "learning-zig", lessonId: "loops-while-and-for" },
        { courseId: "learning-go", lessonId: "for-loop-formats" },
      ],
    },
    {
      id: "for-loops",
      label: "For Loops",
      summary: "Iterate over a sequence or a numeric range.",
      prereqs: ["while-loops"],
      matches: [
        { courseId: "python-crash-course", lessonId: "for-loops-through-lists" },
        { courseId: "python-crash-course", lessonId: "range-function-and-numeric-lists" },
        { courseId: "learning-go", lessonId: "for-range-with-slices-maps" },
      ],
    },
    {
      id: "functions",
      label: "Functions",
      summary: "Group steps into a named, reusable unit.",
      prereqs: ["if-else"],
      matches: [
        { courseId: "python-crash-course", lessonId: "what-is-a-function" },
        { courseId: "the-rust-programming-language", lessonId: "functions-and-parameters" },
        { courseId: "learning-go", lessonId: "declaring-and-calling-functions" },
      ],
    },
    {
      id: "function-args",
      label: "Function Arguments",
      summary: "Parameters, positional vs keyword, defaults.",
      prereqs: ["functions"],
      matches: [
        { courseId: "python-crash-course", lessonId: "parameters-and-arguments" },
        { courseId: "python-crash-course", lessonId: "positional-and-keyword-arguments" },
        { courseId: "python-crash-course", lessonId: "default-parameter-values" },
      ],
    },
    {
      id: "return-values",
      label: "Return Values",
      summary: "Functions that produce a value the caller uses.",
      prereqs: ["function-args"],
      matches: [
        { courseId: "python-crash-course", lessonId: "return-values" },
        { courseId: "the-rust-programming-language", lessonId: "statements-expressions-return-values" },
        { courseId: "learning-go", lessonId: "multiple-return-values" },
      ],
    },
    {
      id: "arrays",
      label: "Arrays / Lists",
      summary: "Indexed sequences of values.",
      prereqs: ["variables", "for-loops"],
      matches: [
        { courseId: "python-crash-course", lessonId: "what-is-a-list" },
        { courseId: "python-crash-course", lessonId: "accessing-list-elements" },
        { courseId: "learning-go", lessonId: "arrays-declaration-and-literals" },
      ],
    },
    {
      id: "array-iteration",
      label: "Iterating Arrays",
      summary: "Walking every element with for, map, filter, reduce.",
      prereqs: ["arrays"],
      matches: [
        { courseId: "python-crash-course", lessonId: "for-loops-through-lists" },
        { courseId: "eloquent-javascript", lessonId: "ch04-reading" },
        { courseId: "the-rust-programming-language", lessonId: "iterating-over-vectors" },
      ],
    },
    {
      id: "objects",
      label: "Objects / Dicts",
      summary: "Named-field records, key→value mappings.",
      prereqs: ["variables"],
      matches: [
        { courseId: "python-crash-course", lessonId: "what-is-a-dictionary" },
        { courseId: "eloquent-javascript", lessonId: "ch03-reading" },
        { courseId: "learning-go", lessonId: "maps-declaration-and-operations" },
      ],
    },
    {
      id: "nested-data",
      label: "Nested Data",
      summary: "Lists of dicts, dicts of lists, and how to walk them.",
      prereqs: ["objects", "arrays"],
      matches: [
        { courseId: "python-crash-course", lessonId: "nesting-data-structures" },
        { courseId: "python-crash-course", lessonId: "work-with-nested-structures" },
      ],
    },
    {
      id: "recursion",
      label: "Recursion",
      summary: "Functions that call themselves on smaller inputs.",
      prereqs: ["functions"],
      matches: [
        { courseId: "composing-programs", lessonId: "ch01-reading" },
        { courseId: "learning-zig", lessonId: "recursion" },
        { courseId: "eloquent-javascript", lessonId: "ch02-reading" },
      ],
    },
    {
      id: "error-handling",
      label: "Error Handling",
      summary: "Recognising, raising, and catching errors.",
      prereqs: ["functions"],
      matches: [
        { courseId: "python-crash-course", lessonId: "handling-exceptions" },
        { courseId: "python-crash-course", lessonId: "file-not-found-and-else-blocks" },
        { courseId: "eloquent-javascript", lessonId: "ch07-reading" },
      ],
    },
    {
      id: "io",
      label: "Standard I/O",
      summary: "Reading input from a user, printing output.",
      prereqs: ["strings"],
      matches: [
        { courseId: "python-crash-course", lessonId: "python-interpreter-basics" },
        { courseId: "python-crash-course", lessonId: "running-programs-from-terminal" },
      ],
    },
    {
      id: "file-io",
      label: "File I/O",
      summary: "Opening, reading, writing, and serialising files.",
      prereqs: ["io"],
      matches: [
        { courseId: "python-crash-course", lessonId: "reading-files-with-pathlib" },
        { courseId: "python-crash-course", lessonId: "writing-to-files" },
        { courseId: "python-crash-course", lessonId: "storing-data-with-json" },
      ],
    },
    {
      id: "testing",
      label: "Testing Basics",
      summary: "Why test, writing your first test, fixtures.",
      prereqs: ["functions"],
      matches: [
        { courseId: "python-crash-course", lessonId: "why-test-your-code" },
        { courseId: "python-crash-course", lessonId: "writing-a-passing-test" },
        { courseId: "python-crash-course", lessonId: "using-fixtures" },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Tree 2: Web Development.
// ─────────────────────────────────────────────────────────────────

const WEB: SkillTree = {
  id: "web",
  title: "Web Development",
  short: "Web Dev",
  audience: "specialty",
  accent: "#56b6c2",
  description:
    "From HTML/CSS up through React, async data, SSR vs CSR. Spans browser APIs, frameworks, testing, and deployment.",
  // Trimmed to ~58 nodes (down from 117) for a cleaner tree shape.
  // Sections were dropped — the tree structure now relies on natural
  // dependency chains (HTML → DOM → events → React → Next.js → ...) for
  // its hierarchy instead of categorical hub nodes. Anything cut here
  // is captured as a gap and can be re-added when there's actual lesson
  // content backing it.
  nodes: [
    // ── Root + HTML basics ────────────────────────────────────────
    {
      id: "html-structure",
      label: "HTML Document Structure",
      summary: "Tags, attributes, semantic elements, the DOM tree.",
      prereqs: [],
      matches: [],
      gapNote: "No HTML-from-zero course.",
    },
    {
      id: "html-forms",
      label: "HTML Forms",
      summary: "Input types, validation, native form submission.",
      prereqs: ["html-structure"],
      matches: [],
      gapNote: "No forms lesson.",
    },
    {
      id: "html-accessibility",
      label: "Accessibility",
      summary: "Semantic markup, ARIA roles, focus management.",
      prereqs: ["html-structure"],
      matches: [],
      gapNote: "No a11y lesson.",
    },
    {
      id: "html-media",
      label: "HTML Media",
      summary: "img / picture / video / audio + responsive images.",
      prereqs: ["html-structure"],
      matches: [],
      gapNote: "No media lesson.",
    },
    {
      id: "image-optimization",
      label: "Image Optimization",
      summary: "Responsive images, AVIF/WebP, lazy loading.",
      prereqs: ["html-media"],
      matches: [],
      gapNote: "No image optimization lesson.",
    },

    // ── CSS chain ────────────────────────────────────────────────
    {
      id: "css-selectors",
      label: "CSS Selectors",
      summary: "Targeting elements with type, class, id, attribute.",
      prereqs: ["html-structure"],
      matches: [],
      gapNote: "No CSS course.",
    },
    {
      id: "css-layout",
      label: "CSS Layout",
      summary: "Box model, display modes, positioning.",
      prereqs: ["css-selectors"],
      matches: [],
      gapNote: "Pair with css-fundamentals.",
    },
    {
      id: "css-flexbox",
      label: "Flexbox",
      summary: "1D layout: main + cross axis.",
      prereqs: ["css-layout"],
      matches: [],
      gapNote: "RN flexbox lesson teaches Yoga not browser CSS.",
    },
    {
      id: "css-grid",
      label: "CSS Grid",
      summary: "2D layout: rows + columns.",
      prereqs: ["css-layout"],
      matches: [],
      gapNote: "No grid lesson.",
    },
    {
      id: "css-responsive",
      label: "Responsive Design",
      summary: "Media queries, mobile-first, container queries.",
      prereqs: ["css-layout"],
      matches: [],
      gapNote: "No responsive lesson.",
    },

    // ── DOM + Events ─────────────────────────────────────────────
    {
      id: "js-dom",
      label: "DOM Selection",
      summary: "querySelector, document, traversing elements.",
      prereqs: ["html-structure"],
      matches: [],
      gapNote:
        "Eloquent JavaScript stops at ch11; never reaches DOM/events chapters.",
    },
    {
      id: "js-events",
      label: "DOM Events",
      summary: "click, input, keydown; bubble vs capture.",
      prereqs: ["js-dom"],
      matches: [],
      gapNote: "No DOM events lesson.",
    },
    {
      id: "js-modules",
      label: "ES Modules",
      summary: "import / export, ESM vs CJS.",
      prereqs: ["js-events"],
      matches: [],
      gapNote: "Add a modules lesson.",
    },
    {
      id: "js-closures",
      label: "Closures & Scope",
      summary: "Lexical scope, closure semantics, the TDZ.",
      prereqs: ["js-events"],
      matches: [],
      gapNote: "No closures lesson.",
    },

    // ── Networking + Async ───────────────────────────────────────
    {
      id: "fetch",
      label: "Fetch API",
      summary: "Making HTTP requests from the browser.",
      prereqs: ["js-dom"],
      matches: [
        { courseId: "learning-react-native", lessonId: "fetching-data-from-web" },
      ],
    },
    {
      id: "promises",
      label: "Promises",
      summary: ".then chains, error handling, the microtask queue.",
      prereqs: ["fetch"],
      matches: [
        { courseId: "eloquent-javascript", lessonId: "ch10-reading" },
        { courseId: "javascript-the-definitive-guide", lessonId: "introduction-to-promises" },
        { courseId: "javascript-the-definitive-guide", lessonId: "chaining-promises" },
      ],
    },
    {
      id: "async-await",
      label: "async / await",
      summary: "Sequential async code without .then nesting.",
      prereqs: ["promises"],
      matches: [
        { courseId: "javascript-the-definitive-guide", lessonId: "async-await-basics" },
        { courseId: "javascript-info", lessonId: "ch09-reading" },
      ],
    },
    {
      id: "websockets",
      label: "WebSockets",
      summary: "Full-duplex client/server messages.",
      prereqs: ["fetch"],
      matches: [],
      gapNote: "No WebSocket lesson.",
    },
    {
      id: "web-workers",
      label: "Web Workers",
      summary: "Off-main-thread JS, postMessage.",
      prereqs: ["async-await"],
      matches: [],
      gapNote: "No web workers lesson.",
    },
    {
      id: "service-workers",
      label: "Service Workers",
      summary: "Offline support, cache strategies.",
      prereqs: ["web-workers"],
      matches: [],
      gapNote: "No service workers lesson.",
    },
    {
      id: "indexeddb",
      label: "IndexedDB",
      summary: "Client-side database, object stores.",
      prereqs: ["js-modules"],
      matches: [],
      gapNote: "No IndexedDB lesson.",
    },

    // ── Backend / API ────────────────────────────────────────────
    {
      id: "rest-apis",
      label: "REST APIs",
      summary: "REST principles, HTTP verbs, status codes.",
      prereqs: ["fetch"],
      matches: [],
      gapNote: "No REST design lesson.",
    },
    {
      id: "graphql-basics",
      label: "GraphQL",
      summary: "Schema, queries, mutations, resolvers.",
      prereqs: ["rest-apis"],
      matches: [],
      gapNote: "No GraphQL lesson.",
    },

    // ── Auth ─────────────────────────────────────────────────────
    {
      id: "auth-basics",
      label: "Auth Basics",
      summary: "Sessions vs tokens, secure storage.",
      prereqs: ["rest-apis"],
      matches: [],
      gapNote: "No auth lesson.",
    },
    {
      id: "jwt",
      label: "JWT",
      summary: "JSON Web Tokens, signing, verification.",
      prereqs: ["auth-basics"],
      matches: [],
      gapNote: "No JWT lesson.",
    },
    {
      id: "oauth",
      label: "OAuth 2.0",
      summary: "Authorization Code flow, PKCE, third-party login.",
      prereqs: ["auth-basics"],
      matches: [],
      gapNote: "No OAuth lesson.",
    },

    // ── React ────────────────────────────────────────────────────
    {
      id: "react-components",
      label: "React Components",
      summary: "JSX, props, function components.",
      prereqs: ["js-events"],
      matches: [
        { courseId: "react-native", lessonId: "the-basics-reactnative-dev-docs-intro-react" },
        { courseId: "learning-react-native", lessonId: "jsx-in-react-native" },
        { courseId: "fluent-react", lessonId: "react-value-proposition" },
      ],
    },
    {
      id: "react-state",
      label: "useState",
      summary: "Local component state, immutable updates.",
      prereqs: ["react-components"],
      matches: [
        { courseId: "fluent-react", lessonId: "immutable-state" },
        { courseId: "fluent-react", lessonId: "usestate-vs-usereducer" },
      ],
    },
    {
      id: "react-effects",
      label: "useEffect",
      summary: "Side effects, dependency arrays, cleanup.",
      prereqs: ["react-state"],
      matches: [
        { courseId: "fluent-react", lessonId: "commit-phase-effects" },
        { courseId: "fluent-react", lessonId: "rules-and-server-actions" },
      ],
    },
    {
      id: "react-context",
      label: "Context",
      summary: "Sharing state across the tree.",
      prereqs: ["react-state"],
      matches: [
        { courseId: "fluent-react", lessonId: "advanced-patterns-recap" },
      ],
    },
    {
      id: "react-reducer",
      label: "useReducer",
      summary: "Action-driven state for complex transitions.",
      prereqs: ["react-state"],
      matches: [
        { courseId: "fluent-react", lessonId: "usestate-vs-usereducer" },
      ],
    },
    {
      id: "react-refs",
      label: "Refs",
      summary: "useRef, forwardRef, imperative DOM access.",
      prereqs: ["react-components"],
      matches: [],
      gapNote: "No refs lesson.",
    },
    {
      id: "react-memo",
      label: "Memoization",
      summary: "memo, useMemo, useCallback.",
      prereqs: ["react-state"],
      matches: [],
      gapNote: "No memoization lesson.",
    },
    {
      id: "react-suspense",
      label: "Suspense",
      summary: "Async UI with fallbacks, code splitting.",
      prereqs: ["react-effects"],
      matches: [],
      gapNote: "No suspense lesson.",
    },
    {
      id: "react-query",
      label: "React Query",
      summary: "Server-state caching, background refetch.",
      prereqs: ["react-effects"],
      matches: [],
      gapNote: "No TanStack Query lesson.",
    },
    {
      id: "redux",
      label: "Redux",
      summary: "Global store, actions, reducers.",
      prereqs: ["react-state"],
      matches: [],
      gapNote: "No Redux lesson.",
    },
    {
      id: "forms",
      label: "Forms",
      summary: "Controlled inputs, validation, submission.",
      prereqs: ["react-state"],
      matches: [
        { courseId: "svelte-tutorial", lessonId: "basic-sveltekit--06-forms--03-form-validation" },
        { courseId: "svelte-tutorial", lessonId: "basic-sveltekit--06-forms--04-progressive-enhancement" },
      ],
      gapNote: "Svelte-only today; add a React/HTML controlled-input lesson.",
    },
    {
      id: "routing",
      label: "Client-Side Routing",
      summary: "URL ↔ component mapping, no full page reload.",
      prereqs: ["react-components"],
      matches: [],
      gapNote: "No React-Router lesson.",
    },
    {
      id: "ssr-vs-csr",
      label: "SSR vs CSR",
      summary: "Trade-offs, hydration, server components.",
      prereqs: ["react-components"],
      matches: [
        { courseId: "fluent-react", lessonId: "limitations-of-client-side-rendering" },
        { courseId: "fluent-react", lessonId: "benefits-of-server-rendering" },
        { courseId: "fluent-react", lessonId: "understanding-hydration" },
      ],
    },
    {
      id: "nextjs",
      label: "Next.js",
      summary: "App router, server components, server actions.",
      prereqs: ["ssr-vs-csr"],
      matches: [
        { courseId: "fluent-react", lessonId: "nextjs-overview" },
        { courseId: "fluent-react", lessonId: "server-side-data-fetching" },
      ],
    },
    {
      id: "react-server-components",
      label: "Server Components",
      summary: "Server-only rendering, streaming, RSC payload.",
      prereqs: ["nextjs"],
      matches: [],
      gapNote: "No RSC lesson.",
    },

    // ── Alternative frameworks ──────────────────────────────────
    {
      id: "vue-framework",
      label: "Vue 3",
      summary: "Composition API, single-file components, reactivity.",
      prereqs: ["js-modules"],
      matches: [],
      gapNote: "No Vue lesson.",
    },
    {
      id: "svelte-framework",
      label: "Svelte 5",
      summary: "Compiled framework, runes, no virtual DOM.",
      prereqs: ["js-modules"],
      matches: [
        { courseId: "svelte-tutorial", lessonId: "basic-sveltekit--06-forms--03-form-validation" },
      ],
      gapNote: "Svelte tutorial in library; expand coverage.",
    },
    {
      id: "sveltekit",
      label: "SvelteKit",
      summary: "Routing, load functions, form actions.",
      prereqs: ["svelte-framework"],
      matches: [
        { courseId: "svelte-tutorial", lessonId: "basic-sveltekit--06-forms--04-progressive-enhancement" },
      ],
    },
    {
      id: "solid-framework",
      label: "SolidJS",
      summary: "Fine-grained reactivity, JSX without VDOM.",
      prereqs: ["js-modules"],
      matches: [],
      gapNote: "No Solid lesson.",
    },
    {
      id: "astro-islands",
      label: "Astro Islands",
      summary: "HTML-first sites with hydrated islands.",
      prereqs: ["html-structure", "react-components"],
      matches: [
        { courseId: "astro-fundamentals", lessonId: "r3" },
        { courseId: "astro-fundamentals", lessonId: "r4" },
        { courseId: "astro-fundamentals", lessonId: "r1" },
      ],
    },
    {
      id: "htmx",
      label: "HTMX",
      summary: "Progressive enhancement via HTML attributes.",
      prereqs: ["html-structure"],
      matches: [
        { courseId: "htmx-fundamentals", lessonId: "r1" },
        { courseId: "htmx-fundamentals", lessonId: "r2" },
        { courseId: "htmx-fundamentals", lessonId: "r3" },
      ],
    },

    // ── TypeScript ───────────────────────────────────────────────
    {
      id: "ts-basics",
      label: "TypeScript",
      summary: "Types, interfaces, narrowing.",
      prereqs: ["js-modules"],
      matches: [],
      gapNote: "Add typescript-fundamentals course.",
    },
    {
      id: "ts-react",
      label: "TS in React",
      summary: "Typing components, hooks, props.",
      prereqs: ["ts-basics", "react-components"],
      matches: [],
      gapNote: "Add TS-in-React lesson.",
    },
    {
      id: "ts-generics",
      label: "Generics",
      summary: "Generic functions, constraints.",
      prereqs: ["ts-basics"],
      matches: [],
      gapNote: "No generics lesson.",
    },

    // ── Tooling / Build ──────────────────────────────────────────
    {
      id: "bundlers",
      label: "Bundlers",
      summary: "Module graph, tree shaking, build pipeline.",
      prereqs: ["js-modules"],
      matches: [],
      gapNote: "No bundlers lesson.",
    },
    {
      id: "vite-build",
      label: "Vite",
      summary: "Vite config, plugins, dev / prod build.",
      prereqs: ["bundlers"],
      matches: [],
      gapNote: "No Vite lesson.",
    },

    // ── Testing ──────────────────────────────────────────────────
    {
      id: "unit-testing",
      label: "Unit Testing",
      summary: "Assertions, runners, mocking basics.",
      prereqs: ["js-modules"],
      matches: [],
      gapNote: "Add unit-testing fundamentals lesson.",
    },
    {
      id: "testing-library",
      label: "Testing Library",
      summary: "RTL queries, user-event, a11y-driven tests.",
      prereqs: ["unit-testing", "react-components"],
      matches: [],
      gapNote: "No Testing Library lesson.",
    },
    {
      id: "e2e-playwright",
      label: "Playwright",
      summary: "End-to-end tests, browsers, fixtures.",
      prereqs: ["unit-testing"],
      matches: [],
      gapNote: "No Playwright lesson.",
    },

    // ── Performance + Deployment ─────────────────────────────────
    {
      id: "web-vitals",
      label: "Core Web Vitals",
      summary: "LCP, INP, CLS — measurement.",
      prereqs: ["nextjs"],
      matches: [],
      gapNote: "No web vitals lesson.",
    },
    {
      id: "static-deployment",
      label: "Static Deployment",
      summary: "Vercel, Netlify, Pages from build artifact.",
      prereqs: ["nextjs"],
      matches: [],
      gapNote: "No deployment lesson.",
    },
    {
      id: "edge-deployment",
      label: "Edge Functions",
      summary: "Edge runtimes, KV stores, geo-distributed.",
      prereqs: ["static-deployment"],
      matches: [],
      gapNote: "No edge deployment lesson.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Tree 3: Smart Contracts & Web3.
// ─────────────────────────────────────────────────────────────────

const SMART_CONTRACTS: SkillTree = {
  id: "smart-contracts",
  title: "Smart Contracts & Web3",
  short: "Web3",
  audience: "specialty",
  accent: "#ffba66",
  description:
    "EVM mental model up through DeFi primitives — AMMs, flash loans, governance, proxies. Pulls from Mastering Ethereum + the Solidity Complete deep dive.",
  nodes: [
    {
      id: "evm-mental-model",
      label: "EVM Mental Model",
      summary: "Accounts, contracts, gas, the world state.",
      prereqs: [],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch04-reading" },
        { courseId: "mastering-ethereum", lessonId: "ch14-the-evm-reading-evm-model" },
        { courseId: "solidity-complete", lessonId: "r2" },
      ],
    },
    {
      id: "solidity-storage",
      label: "Storage",
      summary: "State variables, slot layout, storage / memory / calldata.",
      prereqs: ["evm-mental-model"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch07-smart-contracts-and-solidity-reading-storage" },
        { courseId: "solidity-complete", lessonId: "r9" },
        { courseId: "solidity-complete", lessonId: "r10" },
      ],
    },
    {
      id: "solidity-functions",
      label: "Functions",
      summary: "Visibility, return values, state mutability.",
      prereqs: ["solidity-storage"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch07-smart-contracts-and-solidity-reading-constructors" },
        { courseId: "solidity-complete", lessonId: "r3" },
        { courseId: "solidity-complete", lessonId: "r12" },
      ],
    },
    {
      id: "solidity-events",
      label: "Events",
      summary: "emit, indexed parameters, reading from off-chain.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch07-smart-contracts-and-solidity-reading-events" },
        { courseId: "solidity-complete", lessonId: "r15" },
        { courseId: "vyper-fundamentals", lessonId: "r1" },
      ],
    },
    {
      id: "modifiers",
      label: "Modifiers",
      summary: "Pre/post hooks, onlyOwner, parametrised access control.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch07-smart-contracts-and-solidity-reading-modifiers" },
        { courseId: "solidity-complete", lessonId: "r13" },
      ],
    },
    {
      id: "erc20-basics",
      label: "ERC-20 Basics",
      summary: "transfer, balanceOf, total supply.",
      prereqs: ["solidity-storage", "solidity-events", "modifiers"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch05-reading" },
        { courseId: "solidity-complete", lessonId: "r36" },
      ],
    },
    {
      id: "erc20-allowance",
      label: "ERC-20 Allowance",
      summary: "approve / transferFrom flow, allowance race condition.",
      prereqs: ["erc20-basics"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch10-tokens-reading-erc20-deep" },
      ],
    },
    {
      id: "erc721-nfts",
      label: "ERC-721 NFTs",
      summary: "ownerOf, approvals, safeTransferFrom.",
      prereqs: ["erc20-basics"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch10-tokens-reading-erc721" },
      ],
    },
    {
      id: "erc1155-batch",
      label: "ERC-1155",
      summary: "Multi-token, batch ops.",
      prereqs: ["erc20-basics"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch10-tokens-reading-beyond-erc20" },
      ],
    },
    {
      id: "security-cei",
      label: "Checks-Effects-Interactions",
      summary: "The pattern that defangs reentrancy.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch09-smart-contract-security-reading-reentrancy" },
        { courseId: "solidity-complete", lessonId: "r30" },
      ],
    },
    {
      id: "security-reentrancy",
      label: "Reentrancy",
      summary: "The DAO bug, mutex guards, untrusted external calls.",
      prereqs: ["security-cei"],
      matches: [
        { courseId: "solidity-complete", lessonId: "r29" },
        { courseId: "mastering-ethereum", lessonId: "ch09-smart-contract-security-reading-reentrancy" },
      ],
    },
    {
      id: "security-overflow",
      label: "Overflow Safety",
      summary: "Default checked arithmetic since 0.8, unchecked blocks.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "solidity-complete", lessonId: "r27" },
        { courseId: "solidity-complete", lessonId: "r28" },
      ],
    },
    {
      id: "gas-storage-cost",
      label: "Gas & Storage",
      summary: "How gas maps to opcodes, slot packing, hot vs cold.",
      prereqs: ["solidity-storage"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch14-the-evm-reading-packing" },
        { courseId: "solidity-complete", lessonId: "r33" },
        { courseId: "solidity-complete", lessonId: "r34" },
      ],
    },
    {
      id: "factories-create2",
      label: "CREATE2 Factories",
      summary: "Deterministic addresses for counterfactual deploys.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch14-the-evm-reading-create2" },
      ],
    },
    {
      id: "proxies-uups",
      label: "Proxies (UUPS)",
      summary: "Delegatecall, storage layout discipline, upgradability.",
      prereqs: ["factories-create2", "solidity-storage"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch14-the-evm-reading-delegatecall" },
      ],
    },
    {
      id: "amm-basics",
      label: "AMM Basics",
      summary: "Constant-product invariant, slippage, LP tokens.",
      prereqs: ["erc20-basics"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch13-decentralized-finance-reading-amm" },
        { courseId: "mastering-ethereum", lessonId: "ch13-decentralized-finance-reading-defi-intro" },
      ],
    },
    {
      id: "flash-loans",
      label: "Flash Loans",
      summary: "Single-tx borrow + repay, callback-driven.",
      prereqs: ["amm-basics"],
      matches: [],
      gapNote: "No dedicated flash-loan lesson. Host in `mastering-ethereum` DeFi chapter.",
    },
    {
      id: "governance-multisig",
      label: "Governance & Multisig",
      summary: "Proposal lifecycles, timelocks, n-of-m signing.",
      prereqs: ["modifiers"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch12-decentralized-applications-reading-governance" },
        { courseId: "mastering-ethereum", lessonId: "ch12-decentralized-applications-reading-multisig" },
      ],
    },
    {
      id: "merkle-airdrops",
      label: "Merkle Airdrops",
      summary: "Verifying inclusion proofs on-chain.",
      prereqs: ["solidity-storage"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch04-cryptography-reading-merkle" },
        { courseId: "cryptography-fundamentals", lessonId: "r1" },
      ],
    },
    {
      id: "eip712",
      label: "EIP-712 Signatures",
      summary: "Typed structured signing, domain separator, permit pattern.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch04-cryptography-reading-eip712" },
        { courseId: "cryptography-fundamentals", lessonId: "r1" },
        { courseId: "viem-ethers", lessonId: "r28" },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Tree 4: Systems Programming.
// ─────────────────────────────────────────────────────────────────

const SYSTEMS: SkillTree = {
  id: "systems",
  title: "Systems Programming",
  short: "Systems",
  audience: "specialty",
  accent: "#d68a8a",
  description:
    "Memory model up through Rust ownership, async runtimes, and bare-metal assembly. Two parallel tracks (C-family and Rust) that converge on concurrency and OS interfaces.",
  nodes: [
    {
      id: "memory-stack-heap",
      label: "Stack vs Heap",
      summary: "How the runtime divides memory regions.",
      prereqs: [],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "stack-and-heap" },
        { courseId: "learning-zig", lessonId: "three-memory-areas" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "memory-segments-overview" },
      ],
    },
    {
      id: "pointers-c",
      label: "Pointers",
      summary: "Address-of, dereference, pass-by-pointer.",
      prereqs: ["memory-stack-heap"],
      matches: [
        { courseId: "learning-zig", lessonId: "address-of" },
        { courseId: "learning-zig", lessonId: "pass-by-pointer" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "passing-arguments-overview" },
      ],
    },
    {
      id: "arrays-strings-c",
      label: "C Arrays & Strings",
      summary: "Contiguous memory, null-terminated strings, indexing.",
      prereqs: ["pointers-c"],
      matches: [
        { courseId: "introduction-to-computer-organization-arm", lessonId: "array-basics-in-c" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "array-indexing-assembly" },
        { courseId: "learning-zig", lessonId: "arrays" },
      ],
    },
    {
      id: "structs-c",
      label: "Structs",
      summary: "User-defined record types, layout, alignment.",
      prereqs: ["pointers-c"],
      matches: [
        { courseId: "introduction-to-computer-organization-arm", lessonId: "record-basics-in-c" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "passing-records-to-functions" },
        { courseId: "learning-zig", lessonId: "structs" },
      ],
    },
    {
      id: "malloc-free",
      label: "malloc / free",
      summary: "Heap allocation, ownership discipline, leaks.",
      prereqs: ["pointers-c"],
      matches: [],
      gapNote:
        "Zig allocator lesson covers Zig-style; no C `malloc`/`free` semantics teacher. Host in a new `c-programming-fundamentals`.",
    },
    {
      id: "linked-lists-c",
      label: "C Linked Lists",
      summary: "Pointer-based node chains, the canonical malloc exercise.",
      prereqs: ["malloc-free", "structs-c"],
      matches: [],
      gapNote: "Host alongside `malloc-free` in a C course.",
    },
    {
      id: "cpp-classes",
      label: "C++ Classes",
      summary: "Constructors, destructors, RAII.",
      prereqs: ["structs-c"],
      matches: [],
      gapNote: "Only `challenges-cpp-handwritten` exists. Host in a new `cpp-fundamentals`.",
    },
    {
      id: "cpp-templates",
      label: "C++ Templates",
      summary: "Generic types and functions, compile-time substitution.",
      prereqs: ["cpp-classes"],
      matches: [],
      gapNote: "Pair with cpp-fundamentals.",
    },
    {
      id: "rust-ownership",
      label: "Rust Ownership",
      summary: "Move semantics, drop, single-owner discipline.",
      prereqs: ["memory-stack-heap"],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "what-is-ownership" },
        { courseId: "the-rust-programming-language", lessonId: "ownership-rules-and-scope" },
        { courseId: "the-rust-programming-language", lessonId: "moves-and-invalidation" },
      ],
    },
    {
      id: "rust-borrowing",
      label: "Rust Borrowing",
      summary: "References, &mut exclusivity, the borrow checker.",
      prereqs: ["rust-ownership"],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "references-and-borrowing" },
        { courseId: "the-rust-programming-language", lessonId: "mutable-references" },
        { courseId: "rustonomicon", lessonId: "ch02-reading" },
      ],
    },
    {
      id: "rust-lifetimes",
      label: "Rust Lifetimes",
      summary: "Region annotations, why the compiler asks for them.",
      prereqs: ["rust-borrowing"],
      matches: [
        { courseId: "rustonomicon", lessonId: "ch03-reading" },
        { courseId: "rust-by-example", lessonId: "ch06-scope-borrow-lifetime" },
      ],
    },
    {
      id: "rust-traits",
      label: "Rust Traits",
      summary: "Behaviour interfaces, trait bounds, dyn vs impl.",
      prereqs: ["rust-ownership"],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "defining-traits" },
        { courseId: "the-rust-programming-language", lessonId: "trait-bounds-and-impl-trait" },
        { courseId: "rust-by-example", lessonId: "ch05-generics-traits-reading" },
      ],
    },
    {
      id: "rust-errors",
      label: "Rust Error Handling",
      summary: "Result, Option, the ? operator.",
      prereqs: ["rust-ownership"],
      matches: [
        { courseId: "the-rust-programming-language", lessonId: "result-enum-basics" },
        { courseId: "the-rust-programming-language", lessonId: "propagating-errors" },
        { courseId: "rust-by-example", lessonId: "ch07-error-handling-reading" },
      ],
    },
    {
      id: "rust-async",
      label: "Rust Async",
      summary: "Futures, executors, polling, .await.",
      prereqs: ["rust-ownership"],
      matches: [
        { courseId: "rust-async-book", lessonId: "ch01-r-why-async" },
        { courseId: "rust-async-book", lessonId: "ch02-r-syntax" },
        { courseId: "rust-async-book", lessonId: "ch03-r-future-trait" },
      ],
    },
    {
      id: "threads-mutexes",
      label: "Threads & Mutexes",
      summary: "Shared-memory concurrency, lock discipline.",
      prereqs: ["memory-stack-heap"],
      matches: [
        { courseId: "rustonomicon", lessonId: "ch08-reading" },
        { courseId: "learning-go", lessonId: "mutexes-vs-channels" },
      ],
    },
    {
      id: "channels",
      label: "Channels",
      summary: "Message-passing concurrency, select, closing.",
      prereqs: ["threads-mutexes"],
      matches: [
        { courseId: "learning-go", lessonId: "channels-reading-writing-buffering" },
        { courseId: "learning-go", lessonId: "select-statement" },
        { courseId: "learning-go", lessonId: "closing-channels-for-range" },
      ],
    },
    {
      id: "syscalls",
      label: "System Calls",
      summary: "User → kernel boundary, svc, exception vector.",
      prereqs: ["pointers-c"],
      matches: [
        { courseId: "introduction-to-computer-organization-arm", lessonId: "svc-instruction-basics" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "exception-vector-table" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "intro-to-exceptions-and-interrupts" },
      ],
    },
    {
      id: "assembly-arm64",
      label: "ARM64 Assembly",
      summary: "Instructions, registers, load/store.",
      prereqs: ["memory-stack-heap"],
      matches: [
        { courseId: "introduction-to-computer-organization-arm", lessonId: "assembly-line-structure" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "mov-instruction-variants" },
        { courseId: "introduction-to-computer-organization-arm", lessonId: "load-store-instructions" },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Tree 5: Mobile Development.
// ─────────────────────────────────────────────────────────────────

const MOBILE: SkillTree = {
  id: "mobile",
  title: "Mobile Development",
  short: "Mobile",
  audience: "specialty",
  accent: "#a78bfa",
  description:
    "Two parallel tracks: React Native (TypeScript) and Swift / SwiftUI for iOS. The RN track is well-covered; the Swift track is mostly content gaps today.",
  nodes: [
    {
      id: "ts-types",
      label: "TypeScript Types",
      summary: "Type annotations, interfaces, generics.",
      prereqs: [],
      matches: [],
      gapNote: "No TypeScript course exists. Host in a new `typescript-fundamentals`.",
    },
    {
      id: "rn-components",
      label: "RN Components",
      summary: "Native components vs HTML, View / Text / Image.",
      prereqs: ["ts-types"],
      matches: [
        { courseId: "learning-react-native", lessonId: "native-components-vs-html" },
        { courseId: "react-native", lessonId: "the-basics-reactnative-dev-docs-intro-react-native" },
        { courseId: "learning-react-native", lessonId: "text-component-basics" },
      ],
    },
    {
      id: "rn-styling",
      label: "RN Styling",
      summary: "StyleSheet.create, Yoga flexbox.",
      prereqs: ["rn-components"],
      matches: [
        { courseId: "learning-react-native", lessonId: "intro-to-react-native-styles" },
        { courseId: "learning-react-native", lessonId: "stylesheet-create" },
        { courseId: "learning-react-native", lessonId: "flexbox-basics" },
      ],
    },
    {
      id: "rn-state",
      label: "RN State",
      summary: "Component state, props vs state.",
      prereqs: ["rn-components"],
      matches: [
        { courseId: "react-native", lessonId: "the-basics-reactnative-dev-docs-intro-react" },
        { courseId: "learning-react-native", lessonId: "handling-user-input" },
      ],
    },
    {
      id: "rn-navigation",
      label: "RN Navigation",
      summary: "Stack and tab navigators, route params.",
      prereqs: ["rn-state"],
      matches: [
        { courseId: "learning-react-native", lessonId: "navigator-and-organizational-components" },
        { courseId: "learning-react-native", lessonId: "navigator-scene-management" },
      ],
    },
    {
      id: "rn-forms",
      label: "RN Forms",
      summary: "TextInput, controlled state.",
      prereqs: ["rn-state"],
      matches: [
        { courseId: "learning-react-native", lessonId: "handling-user-input" },
        { courseId: "react-native", lessonId: "the-basics-reactnative-dev-docs-handling-text-inpu" },
      ],
    },
    {
      id: "rn-async-storage",
      label: "AsyncStorage",
      summary: "Persistent key-value store on the device.",
      prereqs: ["rn-state"],
      matches: [
        { courseId: "learning-react-native", lessonId: "async-storage-basics" },
        { courseId: "learning-react-native", lessonId: "async-storage-exercise" },
      ],
    },
    {
      id: "rn-fetch-api",
      label: "RN Fetch",
      summary: "HTTP requests from the device.",
      prereqs: ["rn-state"],
      matches: [
        { courseId: "learning-react-native", lessonId: "fetching-data-from-web" },
      ],
    },
    {
      id: "rn-flatlist",
      label: "RN Lists",
      summary: "Virtualised scrolling lists, item rendering.",
      prereqs: ["rn-state"],
      matches: [
        { courseId: "learning-react-native", lessonId: "listview-basics" },
        { courseId: "react-native", lessonId: "the-basics-reactnative-dev-docs-using-a-listview" },
        { courseId: "learning-react-native", lessonId: "build-api-driven-listview" },
      ],
    },
    {
      id: "swift-basics",
      label: "Swift Basics",
      summary: "let / var, types, control flow.",
      prereqs: [],
      matches: [],
      gapNote: "Only challenge bank. Host in a new `swift-fundamentals`.",
    },
    {
      id: "swift-optionals",
      label: "Optionals",
      summary: "?, !, if let, guard let.",
      prereqs: ["swift-basics"],
      matches: [],
      gapNote: "Pair with swift-fundamentals.",
    },
    {
      id: "swift-classes",
      label: "Swift Classes & Structs",
      summary: "Reference vs value semantics.",
      prereqs: ["swift-basics"],
      matches: [],
      gapNote: "Pair with swift-fundamentals.",
    },
    {
      id: "ios-views",
      label: "SwiftUI Views",
      summary: "Declarative UI, state, modifiers.",
      prereqs: ["swift-classes", "swift-optionals"],
      matches: [],
      gapNote: "No SwiftUI/UIKit course. Host in a new `swiftui-fundamentals`.",
    },
    {
      id: "watch-companion",
      label: "watchOS Companion",
      summary: "Apple Watch app paired with iPhone.",
      prereqs: ["ios-views"],
      matches: [],
      gapNote: "No watchOS course. Host in a new `watchos-fundamentals`.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Tree 6: Functional Programming.
// ─────────────────────────────────────────────────────────────────

const FUNCTIONAL: SkillTree = {
  id: "functional",
  title: "Functional Programming",
  short: "FP",
  audience: "specialty",
  accent: "#9bd87c",
  description:
    "Pure functions and recursion as a base, then specialty branches into Haskell types, Scala traits, and the Elixir / OTP actor model.",
  nodes: [
    {
      id: "pure-functions",
      label: "Pure Functions",
      summary: "Same input → same output, no hidden state.",
      prereqs: [],
      matches: [
        { courseId: "eloquent-javascript", lessonId: "ch04-reading" },
        { courseId: "composing-programs", lessonId: "ch02-reading" },
      ],
    },
    {
      id: "higher-order",
      label: "Higher-Order Functions",
      summary: "Functions taking / returning functions.",
      prereqs: ["pure-functions"],
      matches: [
        { courseId: "eloquent-javascript", lessonId: "ch04-reading" },
        { courseId: "composing-programs", lessonId: "ch02-reading" },
        { courseId: "rust-by-example", lessonId: "ch04-functions-closures-reading" },
      ],
    },
    {
      id: "recursion-deep",
      label: "Recursion (Deep)",
      summary: "Tree-recursive functions, the recursion-fairy mindset.",
      prereqs: ["pure-functions"],
      matches: [
        { courseId: "composing-programs", lessonId: "ch01-reading" },
        { courseId: "composing-programs", lessonId: "ch04-reading" },
        { courseId: "algorithms-erickson", lessonId: "ch01-reading" },
      ],
    },
    {
      id: "immutable-data",
      label: "Immutable Data",
      summary: "The discipline of not mutating in place.",
      prereqs: ["pure-functions"],
      matches: [
        { courseId: "fluent-react", lessonId: "immutable-state" },
        { courseId: "composing-programs", lessonId: "ch05-reading" },
      ],
    },
    {
      id: "folds-maps-filters",
      label: "Folds / Maps / Filters",
      summary: "Standard collection combinators.",
      prereqs: ["higher-order"],
      matches: [
        { courseId: "eloquent-javascript", lessonId: "ch04-reading" },
        { courseId: "composing-programs", lessonId: "ch02-reading" },
        { courseId: "javascript-info", lessonId: "ch04-reading" },
      ],
    },
    {
      id: "haskell-types",
      label: "Haskell Types",
      summary: "Algebraic data types, type signatures.",
      prereqs: ["pure-functions"],
      matches: [],
      gapNote: "Only `challenges-haskell-handwritten` (drill bank). Host in a new `haskell-fundamentals`.",
    },
    {
      id: "haskell-pattern-matching",
      label: "Haskell Pattern Matching",
      summary: "Destructuring ADTs, exhaustiveness checks.",
      prereqs: ["haskell-types"],
      matches: [],
      gapNote: "Pair with haskell-fundamentals.",
    },
    {
      id: "haskell-typeclasses",
      label: "Haskell Type Classes",
      summary: "Eq, Ord, Show, Functor — interface-style polymorphism.",
      prereqs: ["haskell-types"],
      matches: [],
      gapNote: "Pair with haskell-fundamentals.",
    },
    {
      id: "haskell-monads",
      label: "Monads",
      summary: "IO, Maybe, Either, do-notation.",
      prereqs: ["haskell-typeclasses"],
      matches: [],
      gapNote: "Pair with haskell-fundamentals.",
    },
    {
      id: "scala-traits",
      label: "Scala Traits",
      summary: "Mixin composition, self-types.",
      prereqs: ["pure-functions"],
      matches: [],
      gapNote: "Only `challenges-scala-handwritten`. Host in a new `scala-fundamentals`.",
    },
    {
      id: "scala-pattern-match",
      label: "Scala Pattern Matching",
      summary: "Case classes, sealed traits, exhaustiveness.",
      prereqs: ["scala-traits"],
      matches: [],
      gapNote: "Pair with scala-fundamentals.",
    },
    {
      id: "elixir-pattern-match",
      label: "Elixir Pattern Match",
      summary: "Match operator, function clauses, guards.",
      prereqs: ["pure-functions"],
      matches: [],
      gapNote: "Only `challenges-elixir-handwritten`. Host in a new `elixir-fundamentals`.",
    },
    {
      id: "elixir-pipes",
      label: "Elixir Pipes",
      summary: "|> chaining, Enum / Stream.",
      prereqs: ["elixir-pattern-match"],
      matches: [],
      gapNote: "Pair with elixir-fundamentals.",
    },
    {
      id: "elixir-genserver",
      label: "GenServer",
      summary: "OTP actor model, handle_call / handle_cast.",
      prereqs: ["elixir-pipes"],
      matches: [],
      gapNote: "Pair with elixir-fundamentals.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Tree 7: Data & Algorithms.
// ─────────────────────────────────────────────────────────────────

const ALGORITHMS: SkillTree = {
  id: "algorithms",
  title: "Data & Algorithms",
  short: "Algorithms",
  audience: "specialty",
  accent: "#3f8a7c",
  description:
    "Big-O up through divide-and-conquer, dynamic programming, graph traversal. Pulls from Open Data Structures + Erickson's Algorithms.",
  nodes: [
    {
      id: "bigo",
      label: "Big-O Analysis",
      summary: "Asymptotic complexity, amortised cost.",
      prereqs: [],
      matches: [
        { courseId: "open-data-structures", lessonId: "ch01-reading" },
        { courseId: "algorithms-erickson", lessonId: "ch02-reading" },
      ],
    },
    {
      id: "arrays-algo",
      label: "Arrays",
      summary: "Random access, doubling resize, amortisation.",
      prereqs: ["bigo"],
      matches: [
        { courseId: "open-data-structures", lessonId: "ch01-reading" },
        { courseId: "the-rust-programming-language", lessonId: "creating-vectors" },
      ],
    },
    {
      id: "linked-lists-algo",
      label: "Linked Lists",
      summary: "Singly + doubly linked, pointer manipulation.",
      prereqs: ["arrays-algo"],
      matches: [
        { courseId: "open-data-structures", lessonId: "ch02-reading" },
        { courseId: "composing-programs", lessonId: "ch04-reading" },
      ],
    },
    {
      id: "stacks-queues",
      label: "Stacks & Queues",
      summary: "ArrayStack, ArrayQueue, the circular-buffer trick.",
      prereqs: ["arrays-algo"],
      matches: [
        { courseId: "open-data-structures", lessonId: "ch01-reading" },
        { courseId: "open-data-structures", lessonId: "ch01-arraystack" },
        { courseId: "open-data-structures", lessonId: "ch01-arrayqueue" },
      ],
    },
    {
      id: "hash-tables",
      label: "Hash Tables",
      summary: "Chaining vs linear probing, load factor.",
      prereqs: ["arrays-algo"],
      matches: [
        { courseId: "open-data-structures", lessonId: "ch03-reading" },
        { courseId: "open-data-structures", lessonId: "ch03-chained" },
        { courseId: "open-data-structures", lessonId: "ch03-linear" },
      ],
    },
    {
      id: "trees-bst",
      label: "BSTs",
      summary: "Search, insert, delete; balanced variants.",
      prereqs: ["linked-lists-algo"],
      matches: [
        { courseId: "open-data-structures", lessonId: "ch04-reading" },
        { courseId: "open-data-structures", lessonId: "ch05-reading" },
      ],
    },
    {
      id: "graphs-bfs-dfs",
      label: "Graphs (BFS/DFS)",
      summary: "Adjacency lists, traversal orderings.",
      prereqs: ["trees-bst", "hash-tables"],
      matches: [
        { courseId: "algorithms-erickson", lessonId: "ch06-reading" },
        { courseId: "open-data-structures", lessonId: "ch07-reading" },
      ],
    },
    {
      id: "sorting-basic",
      label: "Sorting (Basic)",
      summary: "Comparison-based sorts: bubble, insertion, selection.",
      prereqs: ["arrays-algo"],
      matches: [
        { courseId: "open-data-structures", lessonId: "ch08-reading" },
        { courseId: "algorithms-erickson", lessonId: "ch01-merge-sort" },
      ],
    },
    {
      id: "sorting-advanced",
      label: "Sorting (Advanced)",
      summary: "Mergesort, quicksort, the recurrence T(n)=2T(n/2)+n.",
      prereqs: ["sorting-basic"],
      matches: [
        { courseId: "algorithms-erickson", lessonId: "ch01-reading" },
        { courseId: "open-data-structures", lessonId: "ch08-mergesort" },
        { courseId: "algorithms-erickson", lessonId: "ch02-reading" },
      ],
    },
    {
      id: "binary-search",
      label: "Binary Search",
      summary: "Halving the search space, the canonical lg n.",
      prereqs: ["arrays-algo"],
      matches: [
        { courseId: "algorithms-erickson", lessonId: "ch02-reading" },
        { courseId: "algorithms-erickson", lessonId: "ch02-binary-search" },
      ],
    },
    {
      id: "recursion-divide-conquer",
      label: "Divide & Conquer",
      summary: "The recursion fairy, master theorem.",
      prereqs: ["bigo"],
      matches: [
        { courseId: "algorithms-erickson", lessonId: "ch01-reading" },
        { courseId: "algorithms-erickson", lessonId: "ch02-reading" },
      ],
    },
    {
      id: "dp-basic",
      label: "DP (Basic)",
      summary: "Memoisation, tabulation, LCS.",
      prereqs: ["recursion-divide-conquer"],
      matches: [
        { courseId: "algorithms-erickson", lessonId: "ch04-reading" },
        { courseId: "algorithms-erickson", lessonId: "ch04-lcs" },
      ],
    },
    {
      id: "dp-advanced",
      label: "DP (Advanced)",
      summary: "Edit distance, knapsack, multi-dimensional state.",
      prereqs: ["dp-basic"],
      matches: [
        { courseId: "algorithms-erickson", lessonId: "ch04-edit-distance" },
        { courseId: "algorithms-erickson", lessonId: "ch04-knapsack" },
      ],
    },
    {
      id: "greedy",
      label: "Greedy Algorithms",
      summary: "Exchange arguments, interval scheduling.",
      prereqs: ["bigo"],
      matches: [
        { courseId: "algorithms-erickson", lessonId: "ch05-reading" },
        { courseId: "algorithms-erickson", lessonId: "ch05-interval-scheduling" },
      ],
    },
    {
      id: "tries",
      label: "Tries",
      summary: "Prefix trees for fast string lookup.",
      prereqs: ["trees-bst"],
      matches: [],
      gapNote: "No trie lesson. Host in `open-data-structures` or `algorithms-erickson`.",
    },
    {
      id: "heaps",
      label: "Heaps",
      summary: "Binary heap as implicit tree, priority queue ops.",
      prereqs: ["trees-bst"],
      matches: [
        { courseId: "open-data-structures", lessonId: "ch06-reading" },
        { courseId: "open-data-structures", lessonId: "ch06-heap" },
        { courseId: "algorithms-erickson", lessonId: "ch07-reading" },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Public exports
// ─────────────────────────────────────────────────────────────────

export const TREES: readonly SkillTree[] = [
  FOUNDATIONS,
  WEB,
  SMART_CONTRACTS,
  SYSTEMS,
  MOBILE,
  FUNCTIONAL,
  ALGORITHMS,
];

/// Topo-sort a tree's nodes and assign each one a `depth` for the
/// vertical layout. Depth = max(prereq.depth) + 1, with roots at 0.
/// Pure / no side effects — call from React render or memo.
export interface NodeWithLayout extends SkillNode {
  depth: number;
}

export function layoutTree(tree: SkillTree): NodeWithLayout[] {
  const byId = new Map<string, SkillNode>();
  for (const n of tree.nodes) byId.set(n.id, n);
  const depth = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (stack.has(id)) {
      // Cycle — shouldn't happen in a hand-authored DAG, but guard.
      depth.set(id, 0);
      return 0;
    }
    const n = byId.get(id);
    if (!n) return 0;
    stack.add(id);
    let d = 0;
    for (const p of n.prereqs) {
      d = Math.max(d, visit(p, stack) + 1);
    }
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of tree.nodes) visit(n.id, new Set());
  return tree.nodes.map((n) => ({ ...n, depth: depth.get(n.id) ?? 0 }));
}

/// Per-node completion check. A skill is complete when AT LEAST ONE
/// of its `matches` entries is in the user's completed set. Empty-
/// match (gap) skills can never complete. Section nodes (kind:
/// "section") are always considered complete — they're categorical
/// organizers, not lessons, and shouldn't block their dependents.
export function isSkillComplete(
  node: SkillNode,
  completed: Set<string>,
): boolean {
  if (node.kind === "section") return true;
  if (node.matches.length === 0) return false;
  return node.matches.some((m) =>
    completed.has(`${m.courseId}:${m.lessonId}`),
  );
}

/// Per-node lock state. A skill unlocks when EVERY prerequisite is
/// complete. Roots (no prereqs) are always unlocked.
export function isSkillUnlocked(
  node: SkillNode,
  byId: Map<string, SkillNode>,
  completed: Set<string>,
): boolean {
  if (node.prereqs.length === 0) return true;
  for (const pid of node.prereqs) {
    const p = byId.get(pid);
    if (!p || !isSkillComplete(p, completed)) return false;
  }
  return true;
}

/// % of nodes complete in a tree. The dashboard shows this on each
/// tree card. Gap nodes count toward the denominator so the number
/// reflects "how much of the journey is achievable today" — bumping
/// 100% requires both the learner AND the course authors to do
/// their parts.
export function treeProgressPercent(
  tree: SkillTree,
  completed: Set<string>,
): number {
  // Exclude section nodes from the denominator — they're
  // organizational, not learnable units, so counting them would
  // artificially inflate completion percentages.
  const learnable = tree.nodes.filter((n) => n.kind !== "section");
  if (learnable.length === 0) return 0;
  const done = learnable.filter((n) => isSkillComplete(n, completed)).length;
  return Math.round((done / learnable.length) * 100);
}

/// "Next up" = the unlocked, incomplete, non-gap node closest to the
/// root in the tree's topo order. The dashboard / tree page
/// highlights this node so the learner has an obvious next click.
export function suggestNextSkill(
  tree: SkillTree,
  completed: Set<string>,
): SkillNode | null {
  const layout = layoutTree(tree).sort((a, b) => a.depth - b.depth);
  const byId = new Map<string, SkillNode>();
  for (const n of tree.nodes) byId.set(n.id, n);
  for (const n of layout) {
    // Section nodes don't have lessons to "do next" — skip them.
    if (n.kind === "section") continue;
    if (n.matches.length === 0) continue;
    if (isSkillComplete(n, completed)) continue;
    if (!isSkillUnlocked(n, byId, completed)) continue;
    return n;
  }
  return null;
}

/// Stable mapping from skill-node id to a lucide icon name. The
/// renderer uses this to put a recognisable glyph inside each
/// circle in the web-style tree visualisation. We lean on prefix
/// matches so adding a new node automatically picks up its
/// family's default icon (e.g. any `web-react-*` falls through to
/// `atom`); per-id rules win when a more specific glyph is
/// available.
///
/// Adding a new icon: pick a name from
/// `node_modules/@mattmattmattmatt/base/primitives/icon/icons/` and
/// register it in `ICON_REGISTRY` inside TreesView.tsx — that's
/// the eager-import bundle the renderer reads from. This function
/// only knows about ICON IDs (strings); the bundling is the
/// component's job.
export function iconForSkill(nodeId: string): string {
  // ── Foundations
  if (nodeId === "variables") return "box";
  if (nodeId === "arithmetic") return "calculator";
  if (nodeId === "strings") return "quote";
  if (nodeId === "booleans") return "toggle-left";
  if (nodeId === "comparisons") return "equal";
  if (nodeId === "if-else") return "git-branch";
  if (nodeId === "while-loops" || nodeId === "for-loops") return "repeat";
  if (nodeId === "functions" || nodeId === "function-args") return "parentheses";
  if (nodeId === "return-values") return "corner-down-left";
  if (nodeId === "arrays" || nodeId === "array-iteration") return "list";
  if (nodeId === "objects") return "package";
  if (nodeId === "nested-data") return "layers";
  if (nodeId === "recursion") return "infinity";
  if (nodeId === "error-handling") return "alert-triangle";
  if (nodeId === "io") return "terminal";
  if (nodeId === "file-io") return "file-text";
  if (nodeId === "testing") return "check-circle";

  // ── Web Development
  // Section hubs — pick icons that read as "category" rather than
  // "specific concept" so the user can tell at a glance these are
  // organizational nodes, not lessons to complete.
  if (nodeId === "web-markup-style") return "palette";
  if (nodeId === "web-js-platform") return "code-2";
  if (nodeId === "web-frameworks") return "boxes";
  if (nodeId === "web-production") return "factory";
  if (nodeId === "html-structure") return "code";
  if (nodeId === "html-forms") return "type";
  if (nodeId === "html-accessibility") return "search";
  if (nodeId === "html-media") return "image";
  if (nodeId === "html-canvas") return "palette";
  if (nodeId.startsWith("css-")) return "palette";
  if (nodeId === "js-dom") return "mouse-pointer-2";
  if (nodeId === "js-events") return "zap";
  if (nodeId === "js-modules") return "package";
  if (nodeId === "js-closures") return "parentheses";
  if (nodeId === "js-storage") return "database";
  if (nodeId === "js-history") return "route";
  if (nodeId === "js-iterators" || nodeId === "js-generators") return "infinity";
  if (nodeId === "js-proxy") return "boxes";
  if (nodeId === "fetch") return "download";
  if (nodeId === "promises" || nodeId === "async-await") return "hourglass";
  if (nodeId === "websockets" || nodeId === "websocket-realtime" || nodeId === "sse-protocol") return "radio";
  if (nodeId === "web-workers" || nodeId === "service-workers") return "cpu";
  if (nodeId === "indexeddb") return "database";
  if (nodeId === "intersection-observer" || nodeId === "mutation-observer" || nodeId === "resize-observer") return "search";
  if (nodeId === "broadcast-channel") return "radio";
  if (nodeId === "file-system-access") return "file-text";
  if (nodeId.startsWith("react-")) return "atom";
  if (nodeId === "routing") return "route";
  if (nodeId === "forms") return "type";
  if (nodeId === "ssr-vs-csr" || nodeId === "nextjs") return "server";
  if (nodeId === "astro-islands") return "sparkles";
  if (nodeId === "htmx") return "zap";
  if (nodeId === "redux" || nodeId === "redux-toolkit" || nodeId === "zustand" || nodeId === "jotai" || nodeId === "mobx") return "boxes";
  if (nodeId === "react-query" || nodeId === "swr") return "download";
  if (nodeId.startsWith("ts-")) return "type";
  if (nodeId === "bundlers" || nodeId === "vite-build" || nodeId === "webpack-build" || nodeId === "esbuild-tool") return "package";
  if (nodeId === "unit-testing" || nodeId === "vitest-jest" || nodeId === "testing-library" || nodeId === "e2e-playwright" || nodeId === "cypress-e2e" || nodeId === "a11y-testing" || nodeId === "visual-regression") return "check-circle";
  if (nodeId === "rest-apis") return "server";
  if (nodeId === "graphql-basics" || nodeId === "graphql-client") return "git-branch";
  if (nodeId === "trpc") return "link";
  if (nodeId === "orm-prisma" || nodeId === "drizzle-orm") return "database";
  if (nodeId === "hono-api") return "server";
  if (nodeId === "auth-basics" || nodeId === "session-cookies" || nodeId === "passkeys" || nodeId === "mfa") return "shield";
  if (nodeId === "oauth") return "shield";
  if (nodeId === "jwt") return "signature";
  if (nodeId === "web-vitals" || nodeId === "bundle-analysis") return "gauge";
  if (nodeId === "image-optimization") return "image";
  if (nodeId === "font-optimization") return "type";
  if (nodeId === "virtualization" || nodeId === "lazy-hydration") return "layers";
  if (nodeId === "web-animations-api") return "sparkles";
  if (nodeId === "static-deployment" || nodeId === "cdn-caching") return "server";
  if (nodeId === "edge-deployment") return "network";
  if (nodeId === "vue-framework" || nodeId === "vue-pinia") return "triangle";
  if (nodeId === "svelte-framework" || nodeId === "sveltekit") return "sparkles";
  if (nodeId === "solid-framework") return "atom";
  if (nodeId === "qwik-framework") return "zap";
  if (nodeId === "preact-framework") return "atom";
  if (nodeId === "lit-framework") return "code-2";

  // ── Smart contracts
  if (nodeId === "evm-mental-model") return "cpu";
  if (nodeId === "solidity-storage") return "database";
  if (nodeId === "solidity-functions") return "function-square";
  if (nodeId === "solidity-events") return "radio";
  if (nodeId === "modifiers") return "shield";
  if (nodeId === "erc20-basics" || nodeId === "erc20-allowance") return "coins";
  if (nodeId === "erc721-nfts") return "image";
  if (nodeId === "erc1155-batch") return "layers";
  if (nodeId.startsWith("security-")) return "shield";
  if (nodeId === "gas-storage-cost") return "fuel";
  if (nodeId === "factories-create2") return "factory";
  if (nodeId === "proxies-uups") return "link";
  if (nodeId === "amm-basics") return "arrow-left-right";
  if (nodeId === "flash-loans") return "zap";
  if (nodeId === "governance-multisig") return "vote";
  if (nodeId === "merkle-airdrops") return "tree-pine";
  if (nodeId === "eip712") return "signature";

  // ── Systems
  if (nodeId === "memory-stack-heap") return "memory-stick";
  if (nodeId === "pointers-c") return "arrow-right";
  if (nodeId === "arrays-strings-c") return "align-justify";
  if (nodeId === "structs-c") return "boxes";
  if (nodeId === "malloc-free") return "package-plus";
  if (nodeId === "linked-lists-c") return "link-2";
  if (nodeId.startsWith("cpp-")) return "code-2";
  if (nodeId.startsWith("rust-")) return "cog";
  if (nodeId === "threads-mutexes") return "network";
  if (nodeId === "channels") return "radio";
  if (nodeId === "syscalls") return "terminal";
  if (nodeId === "assembly-arm64") return "binary";

  // ── Mobile
  if (nodeId === "ts-types") return "type";
  if (nodeId.startsWith("rn-")) return "smartphone";
  if (nodeId.startsWith("swift-")) return "bird";
  if (nodeId === "ios-views") return "app-window";
  if (nodeId === "watch-companion") return "watch";

  // ── Functional
  if (nodeId === "pure-functions") return "function-square";
  if (nodeId === "recursion-deep") return "infinity";
  if (nodeId === "higher-order") return "arrow-down-up";
  if (nodeId === "immutable-data") return "leaf";
  if (nodeId === "folds-maps-filters") return "combine";
  if (nodeId.startsWith("haskell-")) return "sigma";
  if (nodeId.startsWith("scala-")) return "function-square";
  if (nodeId.startsWith("elixir-")) return "server";

  // ── Data & Algorithms
  if (nodeId === "bigo") return "gauge";
  if (nodeId === "arrays-algo") return "list";
  if (nodeId === "linked-lists-algo") return "link-2";
  if (nodeId === "stacks-queues") return "layers";
  if (nodeId === "hash-tables") return "hash";
  if (nodeId === "trees-bst" || nodeId === "tries") return "git-branch";
  if (nodeId === "graphs-bfs-dfs") return "network";
  if (nodeId === "sorting-basic" || nodeId === "sorting-advanced") return "arrow-down-up";
  if (nodeId === "binary-search") return "search";
  if (nodeId === "recursion-divide-conquer") return "git-branch";
  if (nodeId.startsWith("dp-")) return "grid-3x3";
  if (nodeId === "greedy") return "target";
  if (nodeId === "heaps") return "triangle";

  return "circle";
}

/// Resolve a skill match to its actual lesson + course title. Used
/// by the side panel that opens when a node is clicked. Returns
/// null when the match points at a course that isn't installed
/// (gap / pruned course / web build without the pack).
export function resolveSkillMatch(
  match: SkillMatch,
  courses: readonly Course[],
): {
  course: Course;
  lessonTitle: string;
} | null {
  const c = courses.find((x) => x.id === match.courseId);
  if (!c) return null;
  for (const ch of c.chapters) {
    const l = ch.lessons.find((x) => x.id === match.lessonId);
    if (l) return { course: c, lessonTitle: l.title };
  }
  return null;
}
