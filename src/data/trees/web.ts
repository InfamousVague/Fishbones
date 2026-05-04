/// Auto-split from the original `src/data/trees.ts` monolith — see
/// `scripts/split-trees.mjs` for the splitter. The shape of the data
/// is unchanged; only the file boundaries moved.
import type { SkillTree } from "./_core";
export const WEB: SkillTree = {
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
