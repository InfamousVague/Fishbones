#!/usr/bin/env node
/// Merge inline `translations` overlays from the extracted artifact
/// (`public/starter-courses/<id>.json`) back into the SOURCE `.academy`
/// (or `.libre`) archive's `course.json`, making translations part of the
/// committed source of truth so they survive `extract-starter-courses.mjs`
/// — which otherwise regenerates the artifact fresh from the archive every
/// run and wipes any translation written only to the artifact.
///
///   node scripts/repack-translations.mjs <id> [<id> ...]
///
/// Non-destructive: copies ONLY the `translations` fields (course /
/// chapter / lesson, matched by id), leaving all base content in the
/// archive untouched. `course.json` is rewritten COMPACT to match the
/// archive's existing minified format, and the archive is re-zipped
/// preserving its other entries (e.g. `cover.jpg`). Idempotent.

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS = join(ROOT, "src-tauri", "resources", "bundled-packs");
const ARTIFACTS = join(ROOT, "public", "starter-courses");

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("usage: node scripts/repack-translations.mjs <id> [<id> ...]");
  process.exit(1);
}

function archivePath(id) {
  for (const ext of ["academy", "libre"]) {
    const p = join(PACKS, `${id}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

/// Pull the translation overlays out of the (translated) artifact, keyed so
/// they can be re-attached to the archive's tree. Lessons are keyed by
/// `chapterId/lessonId` because bare lesson slugs can repeat across chapters.
function collect(course) {
  const chapters = new Map();
  const lessons = new Map();
  // Practice review questions ride the same repack: like translations,
  // they're generated into the extracted artifact and must be merged
  // into the archive's course.json or the next extract wipes them.
  const reviews = new Map();
  for (const ch of course.chapters || []) {
    if (ch.translations && Object.keys(ch.translations).length)
      chapters.set(ch.id, ch.translations);
    for (const l of ch.lessons || []) {
      if (l.translations && Object.keys(l.translations).length)
        lessons.set(`${ch.id}/${l.id}`, l.translations);
      if (Array.isArray(l.reviewQuestions) && l.reviewQuestions.length)
        reviews.set(`${ch.id}/${l.id}`, l.reviewQuestions);
    }
  }
  return { course: course.translations, chapters, lessons, reviews };
}

let failures = 0;
for (const id of ids) {
  const artPath = join(ARTIFACTS, `${id}.json`);
  const arch = archivePath(id);
  if (!existsSync(artPath)) {
    console.error(`✗ ${id}: no artifact (${artPath}) — translate first`);
    failures++;
    continue;
  }
  if (!arch) {
    console.error(`✗ ${id}: no .academy/.libre archive in bundled-packs`);
    failures++;
    continue;
  }

  const tr = collect(JSON.parse(readFileSync(artPath, "utf8")));
  if (!tr.course && !tr.chapters.size && !tr.lessons.size && !tr.reviews.size) {
    console.log(`– ${id}: artifact has no translations/reviewQuestions, skipping`);
    continue;
  }

  const work = mkdtempSync(join(tmpdir(), `repack-${id}-`));
  try {
    execFileSync("unzip", ["-q", arch, "-d", work], { stdio: "pipe" });
    const cjPath = join(work, "course.json");
    if (!existsSync(cjPath)) {
      console.error(`✗ ${id}: archive has no course.json`);
      failures++;
      continue;
    }
    const course = JSON.parse(readFileSync(cjPath, "utf8"));

    let mergedLessons = 0;
    let mergedChapters = 0;
    if (tr.course) course.translations = tr.course;
    const archKeys = new Set();
    for (const ch of course.chapters || []) {
      if (tr.chapters.has(ch.id)) {
        ch.translations = tr.chapters.get(ch.id);
        mergedChapters++;
      }
      for (const l of ch.lessons || []) {
        const key = `${ch.id}/${l.id}`;
        archKeys.add(key);
        if (tr.lessons.has(key)) {
          l.translations = tr.lessons.get(key);
          mergedLessons++;
        }
        if (tr.reviews.has(key)) {
          l.reviewQuestions = tr.reviews.get(key);
          mergedLessons++;
        }
      }
    }
    const unmatched = [...tr.lessons.keys()].filter((k) => !archKeys.has(k)).length;

    // Compact, to match the archive's minified course.json.
    writeFileSync(cjPath, JSON.stringify(course));

    // Re-zip every entry in the work dir (updated course.json + cover.jpg …).
    const entries = readdirSync(work).filter((e) => e !== "__repacked.zip");
    const outZip = join(work, "__repacked.zip");
    execFileSync("zip", ["-q", "-X", outZip, ...entries], {
      cwd: work,
      stdio: "pipe",
    });
    copyFileSync(outZip, arch); // cross-fs safe (tmp → repo)

    console.log(
      `✓ ${id}: merged ${mergedLessons} lesson + ${mergedChapters} chapter translations → ${arch.slice(ROOT.length + 1)}` +
        (unmatched ? `  ⚠ ${unmatched} artifact translations had no matching archive lesson` : ""),
    );
  } catch (e) {
    console.error(`✗ ${id}: ${e.message}`);
    failures++;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
process.exit(failures ? 1 : 0);
