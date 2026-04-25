/// Load every real challenge pack from disk, ignoring book-style courses
/// (`packType !== "challenges"`). Reads straight from the user's Fishbones
/// app-data dir so the test walks their actual content, not fixtures.
///
/// On macOS this is `~/Library/Application Support/com.mattssoftware.kata/courses`.
/// Linux + Windows paths included for portability — any extra location
/// just has to be added to `CANDIDATE_ROOTS` below.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WorkbenchFile {
  name: string;
  language: string;
  content: string;
  readOnly?: boolean;
}

export interface Lesson {
  id: string;
  title: string;
  kind: "reading" | "exercise" | "mixed" | "quiz";
  body?: string;
  language?: string;
  starter?: string;
  solution?: string;
  tests?: string;
  files?: WorkbenchFile[];
  solutionFiles?: WorkbenchFile[];
  hints?: string[];
  difficulty?: "easy" | "medium" | "hard";
  topic?: string;
}

export interface Chapter {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface Course {
  id: string;
  title: string;
  author?: string;
  language: string;
  chapters: Chapter[];
  packType?: "course" | "challenges";
}

/// Same Tauri identifier the app uses (see src-tauri/tauri.conf.json).
const BUNDLE_ID = "com.mattssoftware.kata";

const CANDIDATE_ROOTS = [
  // macOS
  join(homedir(), "Library", "Application Support", BUNDLE_ID, "courses"),
  // Linux
  join(homedir(), ".config", BUNDLE_ID, "courses"),
  join(homedir(), ".local", "share", BUNDLE_ID, "courses"),
  // Windows (covers both Roaming + Local via APPDATA)
  process.env.APPDATA
    ? join(process.env.APPDATA, BUNDLE_ID, "courses")
    : "",
].filter(Boolean);

export function findCoursesDir(): string {
  const override = process.env.FISHBONES_COURSES_DIR;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(
        `FISHBONES_COURSES_DIR set to "${override}" but that path doesn't exist`,
      );
    }
    return override;
  }
  for (const root of CANDIDATE_ROOTS) {
    if (existsSync(root)) return root;
  }
  throw new Error(
    `Could not find courses dir. Tried:\n${CANDIDATE_ROOTS.join(
      "\n",
    )}\nSet FISHBONES_COURSES_DIR=... to point at yours.`,
  );
}

/// Walk the courses dir, read every `course.json`, return just the
/// challenge packs (ignoring book-style linear courses — the user
/// explicitly asked to skip those for this suite).
export function loadChallengePacks(): Course[] {
  const dir = findCoursesDir();
  const entries = readdirSync(dir);
  const packs: Course[] = [];
  for (const name of entries) {
    const courseDir = join(dir, name);
    let st;
    try {
      st = statSync(courseDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const jsonPath = join(courseDir, "course.json");
    if (!existsSync(jsonPath)) continue;
    let parsed: Course;
    try {
      parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as Course;
    } catch (e) {
      // Skip corrupt course.json — don't let one bad file nuke the run.
      console.warn(`[e2e] skipping ${name}: ${(e as Error).message}`);
      continue;
    }
    if (parsed.packType !== "challenges") continue;
    packs.push(parsed);
  }
  packs.sort((a, b) => a.language.localeCompare(b.language));
  return packs;
}

/// Filter packs down to just the languages the caller cares about.
/// `FISHBONES_E2E_LANGS=javascript,python` from the environment wins
/// over the argument so a single env var drives a whole run.
export function filterLanguages(packs: Course[]): Course[] {
  const envLangs = process.env.FISHBONES_E2E_LANGS;
  if (!envLangs) return packs;
  const allowed = new Set(
    envLangs
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return packs.filter((p) => allowed.has(p.language.toLowerCase()));
}

/// Flatten a pack into `{ chapter, lesson }` pairs for the exercise
/// lessons only. Respects `FISHBONES_E2E_LIMIT` to cap per-pack count
/// (useful when you want a quick watchable run rather than the full
/// 120-challenge march).
export function listExercises(
  course: Course,
): Array<{ chapter: Chapter; lesson: Lesson }> {
  const out: Array<{ chapter: Chapter; lesson: Lesson }> = [];
  for (const chapter of course.chapters) {
    for (const lesson of chapter.lessons) {
      if (lesson.kind !== "exercise" && lesson.kind !== "mixed") continue;
      out.push({ chapter, lesson });
    }
  }
  const limitRaw = process.env.FISHBONES_E2E_LIMIT;
  if (limitRaw) {
    const n = parseInt(limitRaw, 10);
    if (Number.isFinite(n) && n > 0) return out.slice(0, n);
  }
  return out;
}

/// Which languages run end-to-end purely in the browser (or via online
/// sandbox that the browser fetches). These we actually execute and
/// assert against in the UI suite.
export const BROWSER_RUNNABLE_LANGUAGES = new Set([
  "javascript",
  "typescript",
  "python",
  "rust",
  "go",
]);

/// Languages whose runtime shells out to a local toolchain via Tauri
/// `run_*` commands. Without `tauri-driver` wired up, Playwright against
/// the plain Vite dev server can't hit those — so the spec marks them
/// with test.skip + a clearly-labelled reason instead of pretending to
/// pass. Flip each one into BROWSER_RUNNABLE_LANGUAGES once you've
/// either wired tauri-driver OR built a sidecar shell-out for the
/// specific toolchain.
export const NATIVE_TOOLCHAIN_LANGUAGES = new Set([
  "swift",
  "c",
  "cpp",
  "java",
  "kotlin",
  "csharp",
  "assembly",
]);
