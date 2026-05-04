/// Auto-split from the original `src/docs/pages.ts` monolith. See
/// `scripts/split-docs.mjs` for the splitter. Each section file
/// co-locates its page constants; the public sections array is
/// assembled in `./index.ts`.

import type { DocsSection } from "../types";

export const courseFormat = `A course is a folder. The wire format is a zip archive with the \`.fishbones\` extension wrapping that folder. The folder contents:

\`\`\`
<course-id>/
├── course.json     # required — the canonical course data
└── cover.png       # optional — used by the Library + Sidebar carousel
\`\`\`

## course.json

This is a JSON serialization of the \`Course\` interface from \`src/data/types.ts\`:

\`\`\`ts
interface Course {
  id: string;
  title: string;
  description?: string;
  author?: string;
  language: LanguageId;
  chapters: Chapter[];
  packType?: "course" | "challenges";
  source?: "pdf" | "docs";
  coverFetchedAt?: number;
}

interface Chapter {
  id: string;
  title: string;
  lessons: Lesson[];
}

type Lesson = ReadingLesson | ExerciseLesson | QuizLesson | MixedLesson;
\`\`\`

A real course.json (truncated):

\`\`\`json
{
  "id": "bun-complete",
  "title": "Bun: The Complete Runtime",
  "description": "A deep, end-to-end tour of Bun...",
  "author": "Fishbones",
  "language": "bun",
  "chapters": [
    {
      "id": "why-bun",
      "title": "Why Bun",
      "lessons": [
        {
          "id": "r1",
          "kind": "reading",
          "title": "What Bun actually is",
          "body": "Bun is **four tools shipped as one binary**:..."
        },
        {
          "id": "q1",
          "kind": "quiz",
          "title": "Pick the right tool",
          "questions": [{
            "prompt": "...",
            "choices": ["..."],
            "correctIndex": 1,
            "explanation": "..."
          }]
        }
      ]
    }
  ]
}
\`\`\`

## Lesson kinds

### reading

Plain markdown body. Renders through the same pipeline LessonReader uses.

\`\`\`json
{
  "id": "r1",
  "kind": "reading",
  "title": "...",
  "body": "Markdown content..."
}
\`\`\`

The body supports:

- All CommonMark + GFM features (tables, fenced code, ordered/unordered lists)
- **GitHub-style callouts**: \`> [!NOTE]\`, \`> [!TIP]\`, \`> [!WARNING]\`, \`> [!EXAMPLE]\`
- **Inline-sandbox playgrounds**: code fences with the word \`playground\` in the info string become embedded mini-editors
- **Symbol popovers + glossary** (when \`enrichment\` is present — see below)

### exercise

Includes starter code, tests, hints, and a reference solution.

\`\`\`json
{
  "id": "e1",
  "kind": "exercise",
  "title": "...",
  "body": "Markdown describing the task",
  "language": "javascript",
  "topic": "javascript",
  "starter": "function add(a, b) { /* TODO */ }\\nmodule.exports = { add };",
  "solution": "function add(a, b) { return a + b; }\\nmodule.exports = { add };",
  "tests": "test('adds', () => expect(add(1,2)).toBe(3));",
  "hints": ["Look at the function signature.", "Use +", "Return the value"]
}
\`\`\`

For multi-file exercises, use \`files\` and \`solutionFiles\` arrays of \`WorkbenchFile\` objects instead of \`starter\` / \`solution\` strings.

\`tests\` is a string of test code in the format the lesson's runtime expects:
- JS / TS / Bun → Jest-compatible \`test()\` / \`expect()\` calls
- Python → \`assert\`-based tests via the in-browser Python sandbox
- Native (Rust / Go / Swift) → tests evaluated by spawning the toolchain

### quiz

\`\`\`json
{
  "id": "q1",
  "kind": "quiz",
  "title": "...",
  "questions": [
    {
      "prompt": "...",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 1,
      "explanation": "Why B is right"
    }
  ]
}
\`\`\`

Multiple questions per quiz are allowed. The lesson is marked complete when every question has a correct answer.

### mixed

A reading lesson that contains an exercise sub-section. Same fields as \`exercise\` but the prose body is the dominant content.

## Bundle format (.fishbones zip)

Just a standard ZIP. The python builder script is the simplest way to produce one:

\`\`\`python
import json, zipfile

course = { ... }   # build the dict matching the Course interface

with zipfile.ZipFile("my-course.fishbones", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("course.json", json.dumps(course, indent=2))
    # optional: z.write("cover.png", arcname="cover.png")
\`\`\`

The Tauri side handles import: drag a \`.fishbones\` onto the Library, or use **Settings → Import**. \`courses.rs::import_archive\` unzips into \`<app-data>/courses/<course.id>/\`.

## Bundled vs imported

Bundled packs ship inside the app binary at \`src-tauri/resources/bundled-packs/\`. On first launch, the seeder copies them into the user's courses directory — see [Bundled packs](docs:bundled-packs). The user can delete a bundled course; Fishbones tracks the deletion so it doesn't re-seed.

## Enrichment (optional)

A course can carry a per-lesson \`enrichment\` object that powers the in-prose popover system:

\`\`\`json
{
  "kind": "reading",
  "body": "Use \`server.upgrade(req)\` to ...",
  "enrichment": {
    "symbols": [
      { "pattern": "server.upgrade",
        "title": "server.upgrade(req, options?)",
        "summary": "Upgrade an HTTP request to a WebSocket connection." }
    ],
    "glossary": [
      { "term": "WebSocket",
        "definition": "Bidirectional message protocol over TCP." }
    ]
  }
}
\`\`\`

LessonReader scans the rendered HTML, finds first occurrences of each pattern / term, and wraps them in popover triggers. Hovering pops a small card with the summary; clicking pins it open.
`;

export const bundledPacks = `Fishbones ships with ~30 courses pre-bundled into the binary. They appear in the Library on first launch with no install step.

## Where they live

In source: \`src-tauri/resources/bundled-packs/\`:

\`\`\`
src-tauri/resources/bundled-packs/
├── javascript-crash-course.fishbones
├── python-crash-course.fishbones
├── learning-go.fishbones
├── the-rust-programming-language.fishbones
├── learning-react-native.fishbones
├── fluent-react.fishbones
├── interactive-web-development-with-three-js-and-a-frame.fishbones
├── introduction-to-computer-organization-arm.fishbones
├── javascript-the-definitive-guide.fishbones
├── react-native.fishbones
├── svelte-5-complete.fishbones
├── bun-complete.fishbones
├── htmx-fundamentals.fishbones
├── solidjs-fundamentals.fishbones
├── astro-fundamentals.fishbones
├── bun-fundamentals.fishbones
├── tauri-2-fundamentals.fishbones
├── challenges-rust-handwritten.fishbones
├── challenges-go-handwritten.fishbones
├── challenges-c-handwritten.fishbones
├── challenges-cpp-handwritten.fishbones
├── challenges-java-handwritten.fishbones
├── challenges-kotlin-handwritten.fishbones
├── challenges-csharp-handwritten.fishbones
├── challenges-swift-handwritten.fishbones
├── challenges-javascript-handwritten.fishbones
├── challenges-python-handwritten.fishbones
├── challenges-reactnative-handwritten.fishbones
├── challenges-typescript-mo9c9k2o.fishbones
├── challenges-rust-mo9bapm1.fishbones
├── challenges-go-mo9kijkd.fishbones
└── challenges-assembly-handwritten.fishbones
\`\`\`

Tauri's resource bundling copies that whole directory into the platform-specific bundle:

\`\`\`toml
# src-tauri/tauri.conf.json (snippet)
{
  "bundle": {
    "resources": ["resources/bundled-packs/**/*"]
  }
}
\`\`\`

After build, on macOS, they live at:

\`\`\`
Fishbones.app/Contents/Resources/resources/bundled-packs/
\`\`\`

## First-launch seeding

\`src-tauri/src/courses.rs::ensure_seed\` runs on every app launch. It:

1. Lists every \`.fishbones\` (or legacy \`.kata\`) file in the resource dir
2. For each, peeks at \`course.json::id\` without unzipping the whole thing
3. **If the user already has a course directory at \`<app-data>/courses/<id>/\`** — skip (don't overwrite user edits / progress)
4. **If the id is in \`seeded-packs.json\`** — skip (the user has explicitly deleted this pack at some point — respect that)
5. **Otherwise** — unzip into \`<app-data>/courses/\` and add the id to \`seeded-packs.json\`

The marker file \`seeded-packs.json\` is the user's "pin" — once a course id has been seeded once, it's recorded forever. Deleting the course removes the directory but keeps the id in the marker, so next launch we know not to resurrect it.

\`\`\`json
// <app-data>/seeded-packs.json
{
  "seedIds": [
    "javascript-crash-course",
    "bun-complete",
    "svelte-5-complete",
    ...
  ]
}
\`\`\`

> [!TIP]
> If you're testing the seeder, delete \`seeded-packs.json\` (not the courses dir) to force a re-seed on next launch. Or call the Rust command \`reset_seeded_packs_marker\` if you've added that path.

## Authoring a bundled pack

Two-step workflow:

1. **Author** — write a Python builder script that produces a \`.fishbones\` archive. The archive is just a zip of one \`course.json\` (and optionally \`cover.png\`).
2. **Drop** — copy the archive into \`src-tauri/resources/bundled-packs/\`. The next \`tauri:build\` includes it; the next \`tauri:dev\` launch picks it up via the seeder.

Example builder:

\`\`\`python
#!/usr/bin/env python3
import json, zipfile

course = {
    "id": "my-course",
    "title": "My course",
    "description": "...",
    "language": "javascript",
    "chapters": [
        {
            "id": "intro",
            "title": "Intro",
            "lessons": [
                {
                    "id": "r1",
                    "kind": "reading",
                    "title": "Hello",
                    "body": "# Hello\\nWelcome!"
                }
            ]
        }
    ],
}

OUT = "/Users/.../Fishbones/src-tauri/resources/bundled-packs/my-course.fishbones"

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("course.json", json.dumps(course, indent=2))
\`\`\`

Run \`python3 build-my-course.py\`, then \`bun run tauri:dev\`. Your course appears in the Library.

## .fishbones vs .kata

Older versions used \`.kata\` as the extension. The seeder reads both:

\`\`\`rust
match path.extension().and_then(|s| s.to_str()) {
    Some("fishbones") | Some("kata") => { /* import */ }
    _ => continue,
}
\`\`\`

Going forward, all new packs use \`.fishbones\`. Existing \`.kata\` files keep working — no migration needed.
`;

export const COURSES_SECTION: DocsSection = {
  id: "courses",
  title: "Course system",
  pages: [
    { id: "course-format", title: "The course format", tagline: ".fishbones, course.json, lesson kinds", body: courseFormat },
    { id: "bundled-packs", title: "Bundled packs", tagline: "First-launch seeding + the marker file", body: bundledPacks },
  ],
};
