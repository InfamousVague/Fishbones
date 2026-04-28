#!/usr/bin/env node
/// Merge per-course micropuzzle sidecars into the staged course JSONs.
///
/// Each sidecar lives at `.cache/micropuzzles/<course-id>.json` and has
/// shape:
///
///   { courseId, drills: [{ afterLessonId, drill }] }
///
/// We:
///   1. Read every sidecar in `.cache/micropuzzles/`
///   2. For each entry, splice the `drill` lesson into the matching
///      course's chapter, immediately after the source lesson.
///   3. Pre-render every challenge's `line` via Shiki so the runtime
///      doesn't pay for highlighting (mobile + watch read the
///      pre-tokenised HTML straight out of the JSON).
///   4. Write the updated course JSON back to public/starter-courses/.
///
/// Idempotent — a drill whose id already exists in the chapter is
/// skipped, so re-running after re-authoring one course doesn't
/// double up.
///
/// Run AFTER the authoring agents have written their sidecars; BEFORE
/// `node scripts/repack-bundled-packs-with-drills.mjs` and the academy
/// sync.

import { codeToHtml } from "shiki";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STAGED = join(ROOT, "public", "starter-courses");
const CACHE = join(ROOT, ".cache", "micropuzzles");

/// Same theme as the rest of the app's code-block highlighting so
/// drills feel like the same product as the lesson body.
const SHIKI_THEME = "github-dark";

/// Map our LanguageId values to Shiki's. Most are 1:1; a few aliases.
function shikiLang(language) {
  switch (language) {
    case "reactnative":
      return "tsx";
    case "threejs":
      return "javascript";
    case "vyper":
      return "python"; // Shiki has no vyper grammar; python's close enough
    case "bun":
      return "typescript";
    case "assembly":
      return "asm";
    default:
      return language;
  }
}

const SLOT_RE = /__SLOT_([A-Za-z0-9_-]+)__/g;

/// Pre-render one card's line into highlighted HTML with `<span
/// data-mp-slot="...">` placeholders where the slot markers were.
/// The renderer measures these placeholders and overlays a tappable
/// chip in the same flow.
async function prerenderLine(line, language) {
  // Replace each marker with a sentinel that survives Shiki's escape
  // pass — we put `__FBSLOT0__` style tokens into the source so
  // Shiki sees identifier-shaped tokens, then post-process to insert
  // the real slot spans.
  const slotIds = [];
  const sentinel = (idx) => `__FBSLOT${idx}__`;
  let prepared = line.replace(SLOT_RE, (_m, id) => {
    const idx = slotIds.length;
    slotIds.push(id);
    return sentinel(idx);
  });
  let html;
  try {
    html = await codeToHtml(prepared, {
      lang: shikiLang(language),
      theme: SHIKI_THEME,
    });
  } catch (e) {
    // Unknown language → plain pre. Better than failing the whole
    // merge because one card's language string is unfamiliar.
    html = `<pre><code>${escapeHtml(prepared)}</code></pre>`;
  }
  for (let i = 0; i < slotIds.length; i++) {
    const span = `<span data-mp-slot="${slotIds[i]}" class="m-mp__chip m-mp__chip--empty"></span>`;
    html = html.replace(sentinel(i), span);
  }
  return html;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  if (!existsSync(CACHE)) {
    console.error(
      `[merge-micropuzzle-sidecars] no cache at ${CACHE} — run the authoring agents first.`,
    );
    process.exit(1);
  }
  if (!existsSync(STAGED)) {
    console.error(
      `[merge-micropuzzle-sidecars] no staged courses at ${STAGED} — run \`node scripts/extract-starter-courses.mjs\`.`,
    );
    process.exit(1);
  }

  const sidecars = (await readdir(CACHE)).filter((f) => f.endsWith(".json"));
  if (sidecars.length === 0) {
    console.log("[merge-micropuzzle-sidecars] no sidecars found, nothing to merge.");
    return;
  }

  let totalCourses = 0;
  let totalDrills = 0;
  let totalCards = 0;
  let totalSkipped = 0;

  for (const f of sidecars) {
    const sidecarPath = join(CACHE, f);
    const sidecar = JSON.parse(await readFile(sidecarPath, "utf-8"));
    if (!sidecar.courseId || !Array.isArray(sidecar.drills)) {
      console.warn(`  ⚠ ${f}: malformed sidecar, skipping`);
      continue;
    }
    const coursePath = join(STAGED, `${sidecar.courseId}.json`);
    if (!existsSync(coursePath)) {
      console.warn(
        `  ⚠ ${f}: no staged course at ${coursePath}, skipping`,
      );
      continue;
    }
    const course = JSON.parse(await readFile(coursePath, "utf-8"));
    if (!course.chapters) continue;

    let inserted = 0;
    let cardsForCourse = 0;
    let skipped = 0;

    // Build a list of lesson locations PER id (not a Map keyed by id —
    // many courses reuse short ids like "e1" / "e2" across chapters).
    // We consume locations in order: the first sidecar entry for
    // afterLessonId="e1" lands after the FIRST e1, the second after
    // the SECOND e1, etc. Without this, every same-id drill collides
    // on the last-seen lesson and ends up either overwriting a
    // previous insert or hitting the idempotency-skip path.
    function buildLocations() {
      const locs = new Map(); // id → array of { ci, li }
      for (let ci = 0; ci < course.chapters.length; ci++) {
        const ch = course.chapters[ci];
        for (let li = 0; li < ch.lessons.length; li++) {
          const id = ch.lessons[li].id;
          if (!locs.has(id)) locs.set(id, []);
          locs.get(id).push({ ci, li });
        }
      }
      return locs;
    }
    let lessonLocations = buildLocations();
    // Per-id consumption cursor — index into the list of locations
    // we've already used. Reset on rebuild because a fresh location
    // list reflects the post-insert state.
    let consumed = new Map(); // id → next index to use

    // Walk drills in source-order so each `e1` reference consumes
    // the next-available `e1` chapter location. We rebuild the
    // location index after every insert because a splice shifts
    // every later li within that chapter.
    for (const entry of sidecar.drills) {
      if (!entry || !entry.afterLessonId || !entry.drill) {
        skipped += 1;
        continue;
      }
      const candidates = lessonLocations.get(entry.afterLessonId);
      const used = consumed.get(entry.afterLessonId) ?? 0;
      const where = candidates?.[used];
      if (!where) {
        console.warn(
          `  ⚠ ${sidecar.courseId}: afterLessonId="${entry.afterLessonId}" exhausted (${candidates?.length ?? 0} matches consumed)`,
        );
        skipped += 1;
        continue;
      }
      const chapter = course.chapters[where.ci];
      // Disambiguate the drill id by chapter so two same-source-id
      // drills (e.g. two `e1__drill` from different chapters) don't
      // collide on insertion. Suffix with a 4-char chapter slug.
      const chapterSlug = (chapter.id || `c${where.ci}`)
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 6)
        .toLowerCase();
      const baseDrillId = entry.drill.id;
      // If multiple chapters use the same source id, the drill id
      // must include the chapter slug. Detect duplicates by checking
      // the candidates list length.
      if ((candidates?.length ?? 0) > 1) {
        entry.drill.id = `${baseDrillId}__${chapterSlug}`;
      }
      // Idempotency — if a drill with this final id already exists
      // anywhere in the chapter, skip.
      if (chapter.lessons.some((l) => l.id === entry.drill.id)) {
        consumed.set(entry.afterLessonId, used + 1);
        skipped += 1;
        continue;
      }
      // Pre-render each card's line via Shiki.
      for (const card of entry.drill.challenges ?? []) {
        if (!card.lineHtml) {
          card.lineHtml = await prerenderLine(card.line, entry.drill.language);
        }
      }
      chapter.lessons.splice(where.li + 1, 0, entry.drill);
      consumed.set(entry.afterLessonId, used + 1);
      // Rebuild locations because the splice shifted indices.
      lessonLocations = buildLocations();
      // The consumed cursor still points at "next" within the same
      // id — but the list got rebuilt so we have to RE-FIND the
      // already-used positions and skip them. Easiest: increment
      // the cursor in the new list to match what we consumed before.
      // (Already incremented above.)
      inserted += 1;
      cardsForCourse += entry.drill.challenges?.length ?? 0;
    }

    if (inserted > 0) {
      await writeFile(coursePath, JSON.stringify(course, null, 2), "utf-8");
    }

    console.log(
      `  ✓ ${sidecar.courseId.padEnd(38)} +${inserted} drill(s), ${cardsForCourse} cards${skipped ? ` (${skipped} skipped)` : ""}`,
    );

    totalCourses += 1;
    totalDrills += inserted;
    totalCards += cardsForCourse;
    totalSkipped += skipped;
  }

  console.log("");
  console.log(
    `[merge-micropuzzle-sidecars] processed ${totalCourses} sidecar(s), inserted ${totalDrills} drill(s) (${totalCards} cards)${totalSkipped ? `, skipped ${totalSkipped}` : ""}`,
  );
}

main().catch((err) => {
  console.error("[merge-micropuzzle-sidecars] failed:", err);
  process.exit(1);
});
