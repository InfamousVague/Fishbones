import { bookOpen } from "@base/primitives/icon/icons/book-open";
import { code as codeIcon } from "@base/primitives/icon/icons/code";
import { helpCircle } from "@base/primitives/icon/icons/help-circle";
import type { Course, Lesson, LanguageId } from "../../data/types";

/// Display name for a language id. Used by the "Rust challenges" style
/// section header so the learner sees which subset we're showing, not
/// a bare "Challenge packs" that's ambiguous when filtered.
export function languageLabel(lang: LanguageId): string {
  switch (lang) {
    case "javascript":
      return "JavaScript";
    case "typescript":
      return "TypeScript";
    case "python":
      return "Python";
    case "rust":
      return "Rust";
    case "swift":
      return "Swift";
    case "go":
      return "Go";
    case "web":
      return "Web";
    case "threejs":
      return "Three.js";
    case "react":
      return "React";
    case "reactnative":
      return "React Native";
    case "c":
      return "C";
    case "cpp":
      return "C++";
    case "java":
      return "Java";
    case "kotlin":
      return "Kotlin";
    case "csharp":
      return "C#";
    case "assembly":
      return "Assembly";
    case "svelte":
      return "Svelte";
    case "solid":
      return "SolidJS";
    case "htmx":
      return "HTMX";
    case "astro":
      return "Astro";
    case "bun":
      return "Bun";
    case "tauri":
      return "Tauri";
    case "solidity":
      return "Solidity";
    case "vyper":
      return "Vyper";
    // 2026 expansion — full names matching the LANGUAGE_META labels.
    case "ruby":
      return "Ruby";
    case "lua":
      return "Lua";
    case "dart":
      return "Dart";
    case "haskell":
      return "Haskell";
    case "scala":
      return "Scala";
    case "sql":
      return "SQL";
    case "elixir":
      return "Elixir";
    case "zig":
      return "Zig";
    case "move":
      return "Move";
    case "cairo":
      return "Cairo";
    case "sway":
      return "Sway";
  }
}

/// Maps a lesson kind to the glyph shown to the left of its title in the
/// sidebar. Keeping this in one place so adding a new lesson type is a
/// one-line change rather than hunting through LessonRow.
export function iconForKind(kind: Lesson["kind"]) {
  switch (kind) {
    case "reading":
      return bookOpen;
    case "exercise":
    case "mixed":
    case "puzzle":
    case "cloze":
    case "micropuzzle":
      // Code-shaped lessons all get the terminal/code icon. Puzzle
      // (arrangement), cloze (multi-blank fill-in), and micropuzzle
      // (single-line cloze stack) sit one notch above plain reading
      // conceptually but the sidebar already has too many kind-
      // specific tints — collapsing to the code icon keeps the
      // tree visually scannable.
      return codeIcon;
    case "quiz":
      return helpCircle;
  }
}

/// Compute the 0..1 progress fraction for a course given the completion
/// set the sidebar already has in scope. Keyed by `${courseId}:${lessonId}`
/// so it mirrors the shape used everywhere else (useProgress, library,
/// profile view).
export function courseProgress(
  course: Course,
  completed: Set<string>,
): { pct: number; done: number; total: number } {
  let total = 0;
  let done = 0;
  for (const ch of course.chapters) {
    for (const l of ch.lessons) {
      total += 1;
      if (completed.has(`${course.id}:${l.id}`)) done += 1;
    }
  }
  return { pct: total > 0 ? done / total : 0, done, total };
}

/// Short language tag for the carousel fallback tile. Same list as
/// BookCover.tsx's langGlyph — kept local here so the sidebar doesn't
/// import internals from the library folder.
export function carouselGlyph(lang: LanguageId): string {
  switch (lang) {
    case "javascript":
      return "JS";
    case "typescript":
      return "TS";
    case "python":
      return "PY";
    case "rust":
      return "RS";
    case "swift":
      return "SW";
    case "go":
      return "GO";
    case "web":
      return "WEB";
    case "threejs":
      return "3D";
    case "react":
      return "RX";
    case "reactnative":
      return "RN";
    case "c":
      return "C";
    case "cpp":
      return "C++";
    case "java":
      return "JV";
    case "kotlin":
      return "KT";
    case "csharp":
      return "C#";
    case "assembly":
      return "ASM";
    case "svelte":
      return "SV";
    case "solid":
      return "SO";
    case "htmx":
      return "HX";
    case "astro":
      return "AS";
    case "bun":
      return "BN";
    case "tauri":
      return "TR";
    case "solidity":
      return "SOL";
    case "vyper":
      return "VY";
    // 2026 expansion — match BookCover.tsx's langGlyph + the
    // LANG_GLYPHS map in extract-starter-courses.mjs.
    case "ruby":
      return "RB";
    case "lua":
      return "LU";
    case "dart":
      return "DT";
    case "haskell":
      return "HS";
    case "scala":
      return "SC";
    case "sql":
      return "SQL";
    case "elixir":
      return "EX";
    case "zig":
      return "ZG";
    case "move":
      return "MV";
    case "cairo":
      return "CR";
    case "sway":
      return "SW";
  }
}
