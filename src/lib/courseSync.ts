/// Course sync — three concerns under one roof:
///
///   1. **Update detection**: hash the bundled `public/starter-courses/
///      <id>.json` and compare against the `bundleSha` stored on the
///      installed copy. Mismatch → upstream has changed since last
///      sync → Library renders an "update available" badge.
///
///   2. **Reapply bundled**: fetch the bundled JSON, write it over
///      the installed copy via `storage.saveCourse`, set
///      `bundleSha` so the badge clears.
///
///   3. **Fix-applier**: take a list of per-lesson patches (the
///      shape the cmd+K verify-prompt asks the LLM to reply in),
///      apply them to the installed copy, save. Doesn't touch
///      `bundleSha` because user edits aren't an upstream sync —
///      we want the badge to keep tracking upstream changes.
///
/// All three share the same low-level helpers (hash, fetch bundled),
/// hence one file. Pure module — no React state.
///
/// Why hash-of-bundled rather than bumping a version number on every
/// course edit: the existing seed pipeline doesn't surface a place
/// to bump versions per course, and authors shouldn't have to remember
/// to. Hashing is automatic + content-addressable + has no false
/// positives. Cost is one `crypto.subtle.digest` per course on
/// Library mount, which is microseconds for a few-MB JSON.

import type { Course, Lesson, ExerciseLesson, MixedLesson, WorkbenchFile } from "../data/types";
import { storage } from "./storage";
import { isDesktop } from "./platform";

/// SHA-256 the canonical JSON form of a course. We strip the
/// `bundleSha` field before hashing so storing the hash on the same
/// object can't change the hash and trigger an infinite "different"
/// signal. Same for `coverFetchedAt` — it's a per-install timestamp,
/// not part of the upstream content.
export async function hashCourse(c: Course): Promise<string> {
  const stripped: Course = { ...c };
  delete stripped.bundleSha;
  delete stripped.coverFetchedAt;
  return await sha256(canonicalJson(stripped));
}

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hashBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/// Stable JSON serialization — sort object keys at every depth so
/// two courses with the same content but different key insertion
/// order produce the same hash. Arrays are NOT sorted (order is
/// content for lessons / chapters / files).
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = (v as Record<string, unknown>)[k];
      }
      return out;
    }
    return v;
  });
}

/// Resolve the URL the running app should fetch a bundled course
/// from. Vite serves `public/` at `import.meta.env.BASE_URL`, which
/// differs between desktop (`/`) and the deployed web build
/// (`/fishbones/learn/`). The trailing-slash handling matches
/// `webSeedCourses.ts`'s `starterUrl()` helper.
export function bundledCourseUrl(courseId: string): string {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
  return `${base}starter-courses/${courseId}.json`;
}

/// Fetch the bundled course JSON. Returns null when no bundled
/// counterpart exists (user-imported course, network unreachable on
/// web, etc.) — callers treat null as "no bundled version, nothing
/// to update against".
///
/// Desktop: reads the .fishbones archive shipped under
/// `src-tauri/resources/bundled-packs/` via the Rust
/// `read_bundled_course` command. This is the SAME source the
/// desktop seed extracts from on first launch — keeping update
/// detection on the same source of truth means "freshly seeded"
/// can never come up as "update available". The earlier desktop
/// path here read from `public/starter-courses/<id>.json` (the web
/// extractor's output), which drifts whenever the .fishbones
/// changes without a manual `npm run starter:web` re-extract,
/// triggering perpetual update badges.
///
/// Web: still fetches `${BASE_URL}starter-courses/<id>.json`
/// (same-origin) — that IS the source of truth for the deployed
/// web build.
export async function fetchBundledCourse(
  courseId: string,
): Promise<Course | null> {
  if (isDesktop) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<Course | null>("read_bundled_course", {
        courseId,
      });
      return result ?? null;
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(bundledCourseUrl(courseId), { cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as Course;
  } catch {
    return null;
  }
}

export interface UpdateStatus {
  /// True when bundled hash !== installed.bundleSha — caller should
  /// render the "update available" badge.
  available: boolean;
  bundledHash: string | null;
  installedSha: string | null;
  /// Cached so the caller doesn't have to re-fetch when the user
  /// clicks the badge to apply the update.
  bundled: Course | null;
}

/// Compare a single installed course against its bundled counterpart.
/// Tolerates both legs being missing — returns `{available: false,
/// bundled: null}` when there's no bundled version on disk for this
/// course.
export async function checkUpdateAvailable(
  installed: Course,
): Promise<UpdateStatus> {
  const bundled = await fetchBundledCourse(installed.id);
  if (!bundled) {
    return {
      available: false,
      bundledHash: null,
      installedSha: installed.bundleSha ?? null,
      bundled: null,
    };
  }
  const bundledHash = await hashCourse(bundled);

  // Backfill case: an installed course from before we started
  // tracking bundleSha. If its current content already matches the
  // bundled hash, claim "no update" and seed the field — that way
  // legacy installs don't show a spurious badge on first launch.
  if (!installed.bundleSha) {
    const installedHash = await hashCourse(installed);
    if (installedHash === bundledHash) {
      // Persist the backfill so we don't re-hash on every Library
      // mount. Fire-and-forget: a single failed write isn't worth
      // surfacing — the next mount will retry.
      const next: Course = { ...installed, bundleSha: bundledHash };
      void storage.saveCourse(installed.id, next).catch(() => {});
      return {
        available: false,
        bundledHash,
        installedSha: bundledHash,
        bundled,
      };
    }
    // No bundleSha + content differs from bundled: the user has
    // local edits OR an outdated install. Surface the badge so the
    // user can choose to overwrite.
    return {
      available: true,
      bundledHash,
      installedSha: null,
      bundled,
    };
  }

  return {
    available: installed.bundleSha !== bundledHash,
    bundledHash,
    installedSha: installed.bundleSha,
    bundled,
  };
}

/// Overwrite the installed copy with the current bundled version.
/// Stamps `bundleSha` so the badge clears + we won't re-trigger
/// until the next upstream change.
///
/// Returns the new Course so callers can splice it into in-memory
/// state without re-listing from disk.
export async function syncBundledToInstalled(
  courseId: string,
): Promise<Course> {
  const bundled = await fetchBundledCourse(courseId);
  if (!bundled) {
    throw new Error(
      `No bundled course at ${bundledCourseUrl(courseId)} — nothing to apply.`,
    );
  }
  const bundledHash = await hashCourse(bundled);
  // Preserve the installed-side cover-extracted timestamp + id so
  // the in-memory Course identity stays stable. The cover image on
  // disk doesn't get touched here — a future "extract cover" run
  // refreshes it independently.
  let installed: Course | null = null;
  try {
    installed = await storage.loadCourse(courseId);
  } catch {
    // First-install case — fine.
  }
  const next: Course = {
    ...bundled,
    coverFetchedAt: installed?.coverFetchedAt ?? bundled.coverFetchedAt,
    bundleSha: bundledHash,
  };
  await storage.saveCourse(courseId, next);
  return next;
}

// ───────────────────────────────────────────────────────────────────
// Fix-applier — takes per-lesson patches the verify-prompt LLM reply
// produces and applies them to the installed course.
// ───────────────────────────────────────────────────────────────────

/// Shape of one entry in the LLM's reply. Mirrors the JSON the
/// `formatFixPrompt` instructions in `verify/export.ts` ask for.
export interface LessonFixPatch {
  id: string;
  diagnosis?: string;
  solution?: string;
  tests?: string;
  starter?: string;
  solutionFiles?: WorkbenchFile[];
  files?: WorkbenchFile[];
}

export interface ApplyFixesResult {
  /// Lessons in the patch list whose id matched a lesson in the
  /// course AND were updated.
  applied: Array<{ id: string; title: string }>;
  /// Lessons in the patch list whose id wasn't found in the course.
  /// Surface to the user so they can spot typos in the LLM reply.
  notFound: string[];
  /// The updated course (saved to disk + returned for in-memory
  /// splice).
  course: Course;
}

/// Tolerant JSON parser — strips markdown fences, isolates the
/// outermost `{ … }` if the model wrapped the JSON in prose, and
/// retries with raw input. Mirrors the logic in
/// `src/ingest/retryLesson.ts`'s `parseJsonTolerant` so we don't
/// dual-import a heavy module just for this.
export function extractFixesFromText(text: string): LessonFixPatch[] {
  const out: LessonFixPatch[] = [];
  // Match every fenced ```json ... ``` block, plus bare ``` ... ```
  // blocks (LLMs sometimes drop the language tag).
  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let foundFenced = false;
  while ((m = fenceRe.exec(text)) !== null) {
    const body = m[1].trim();
    if (!body) continue;
    foundFenced = true;
    const parsed = tryParse(body);
    if (parsed) out.push(parsed);
  }

  // Fallback: no fenced blocks — try to parse the whole input as a
  // JSON array or single object. Useful when the user pastes raw
  // JSON without markdown wrapping.
  if (!foundFenced) {
    const trimmed = text.trim();
    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed) as unknown;
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && typeof item === "object" && "id" in item) {
              out.push(item as LessonFixPatch);
            }
          }
        }
      } catch {
        // ignore
      }
    } else {
      const single = tryParse(trimmed);
      if (single) out.push(single);
    }
  }

  // Dedupe by id — if the model emitted two blocks for the same
  // lesson (e.g. iterated and then re-iterated) keep the LAST one,
  // assumed to be the most considered.
  const byId = new Map<string, LessonFixPatch>();
  for (const p of out) {
    if (typeof p.id === "string" && p.id) byId.set(p.id, p);
  }
  return [...byId.values()];
}

function tryParse(s: string): LessonFixPatch | null {
  try {
    const v = JSON.parse(s) as unknown;
    if (v && typeof v === "object" && "id" in v) return v as LessonFixPatch;
  } catch {
    // fall through
  }
  return null;
}

/// Apply a batch of patches to an installed course. Patches are
/// matched by `id` against every lesson in every chapter. Saved
/// atomically (one write).
///
/// Does NOT touch `bundleSha` — local edits aren't an upstream sync.
/// The badge stays tracking upstream until the user explicitly
/// reapplies the bundled starter.
export async function applyFixesToCourse(
  courseId: string,
  patches: LessonFixPatch[],
): Promise<ApplyFixesResult> {
  const course = await storage.loadCourse(courseId);
  const applied: Array<{ id: string; title: string }> = [];
  const seen = new Set<string>();
  const patchById = new Map(patches.map((p) => [p.id, p]));

  for (const ch of course.chapters) {
    for (const l of ch.lessons) {
      const patch = patchById.get(l.id);
      if (!patch) continue;
      seen.add(l.id);
      mutateLessonInPlace(l, patch);
      applied.push({ id: l.id, title: l.title });
    }
  }

  const notFound = patches.map((p) => p.id).filter((id) => !seen.has(id));
  await storage.saveCourse(courseId, course);
  return { applied, notFound, course };
}

/// (Dev only) Promote the installed course back into the bundled
/// `public/starter-courses/<id>.json` so the next install picks up
/// the fixes. Calls a Tauri command that walks up from the binary
/// looking for the Fishbones repo root + writes there. Returns
/// the absolute path written, or throws when:
///   * the running build is web (no Tauri to invoke), or
///   * the binary is a release build (the Rust command refuses), or
///   * the repo root can't be located (running outside `npm run
///     tauri:dev`).
export async function promoteCourseToBundled(
  course: Course,
): Promise<string> {
  if (!isDesktop) {
    throw new Error(
      "Promote to bundled is desktop-only — the web build can't write to the repo.",
    );
  }
  // Lazy-import the Tauri invoke helper so the web build doesn't
  // pull `@tauri-apps/api/core` into its bundle.
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("save_bundled_starter_course", {
    courseId: course.id,
    body: course,
  });
}

/// Apply a single patch to a single lesson by mutating its fields.
/// Only writes fields the patch actually carries (omit means "leave
/// unchanged"). Setting a field to `null` explicitly clears it,
/// matching what the LLM might emit to drop a multi-file
/// solutionFiles when collapsing to a single solution string.
function mutateLessonInPlace(lesson: Lesson, patch: LessonFixPatch): void {
  // Only exercise / mixed lessons carry these fields. The type
  // narrowing is hand-rolled — we mutate properties that exist on
  // ExerciseLesson | MixedLesson.
  if (lesson.kind !== "exercise" && lesson.kind !== "mixed") return;
  const ex = lesson as ExerciseLesson | MixedLesson;
  if (typeof patch.solution === "string") ex.solution = patch.solution;
  if (typeof patch.tests === "string") ex.tests = patch.tests;
  if (typeof patch.starter === "string") ex.starter = patch.starter;
  if (Array.isArray(patch.solutionFiles)) ex.solutionFiles = patch.solutionFiles;
  if (Array.isArray(patch.files)) ex.files = patch.files;
  // Explicit null = clear (so the LLM can collapse multi-file
  // lessons to single-file by emitting `solutionFiles: null`).
  if (patch.solutionFiles === null) delete (ex as { solutionFiles?: unknown }).solutionFiles;
  if (patch.files === null) delete (ex as { files?: unknown }).files;
}
