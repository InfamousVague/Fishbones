#!/usr/bin/env node
/// Replace every Rustlings lesson's hints with the OFFICIAL upstream hints and
/// fix the quiz2 test, operating directly on the bundled `.academy` (the source
/// of truth) so the fix survives `extract-starter-courses`.
///
/// Why this exists: `add-rustlings-hints.mjs` read the hints from
/// `/tmp/rustlings/info.toml`, but Rustlings 6.x moved them to
/// `rustlings-macros/info.toml`. With the file missing the script fell back to
/// generic, unhelpful templated hints ("Mini-checkpoint exercise — apply what
/// you learned…"). This script reads the correct path and uses the real,
/// hand-written upstream hints (e.g. quiz2 → "The `+` operator can concatenate
/// a `String` with a `&str`."), split into progressive steps on `Hint N:`
/// markers / paragraph breaks.
///
/// It also fixes quiz2: the imported test required BOTH `transformer` and
/// `transformer_iter`, but upstream 6.5.0 only tests `transformer` (the iter
/// version is a bonus reference in the solution, not tested). The Libre starter
/// only stubs `transformer`, so a correct single-function answer failed to
/// compile ("cannot find function `transformer_iter`"). We restore the upstream
/// single-function test.
///
/// Prereq: a Rustlings clone at /tmp/rustlings —
///   git clone --depth 1 https://github.com/rust-lang/rustlings.git /tmp/rustlings
///
/// Usage: node scripts/fix-rustlings-hints.mjs
///   Reads + rewrites src-tauri/resources/bundled-packs/rustlings.academy

import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const ARCHIVE = join(ROOT, "src-tauri/resources/bundled-packs/rustlings.academy");
const INFO_TOML = "/tmp/rustlings/rustlings-macros/info.toml";

if (!existsSync(INFO_TOML)) {
  console.error(`Missing ${INFO_TOML}. Clone it first:\n  git clone --depth 1 https://github.com/rust-lang/rustlings.git /tmp/rustlings`);
  process.exit(1);
}

// --- official hints, by exercise name ---
const toml = readFileSync(INFO_TOML, "utf8");
const official = {};
for (const b of toml.split(/\n\[\[exercises\]\]/).slice(1)) {
  const n = b.match(/name\s*=\s*"([^"]+)"/);
  if (!n) continue;
  let h = null;
  const ml = b.match(/hint\s*=\s*"""([\s\S]*?)"""/);
  if (ml) h = ml[1];
  else { const sl = b.match(/hint\s*=\s*"((?:\\.|[^"\\])*)"/); if (sl) h = sl[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"); }
  if (h != null) official[n[1]] = h.trim();
}

/// Split an official hint into progressive steps: on explicit `Hint N:` markers
/// if present, otherwise on blank-line paragraph breaks.
function splitHint(h) {
  if (/\bHint\s*\d+\s*:/i.test(h))
    return h.split(/\n?\s*Hint\s*\d+\s*:\s*/i).map((s) => s.trim()).filter(Boolean);
  const paras = h.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return paras.length ? paras : [h.trim()];
}
const nameFor = (id) =>
  official[id] ? id : (official[id.replace(/-/g, "_")] ? id.replace(/-/g, "_") : null);

const QUIZ2_TEST = [
  "    use super::Command;",
  "    use super::my_module::transformer;",
  "",
  "    #[test]",
  "    fn it_works() {",
  "        let input = vec![",
  '            ("hello".to_string(), Command::Uppercase),',
  '            (" all roads lead to rome! ".to_string(), Command::Trim),',
  '            ("foo".to_string(), Command::Append(1)),',
  '            ("bar".to_string(), Command::Append(5)),',
  "        ];",
  "        let output = transformer(input);",
  "",
  "        assert_eq!(",
  "            output,",
  "            [",
  '                "HELLO",',
  '                "all roads lead to rome!",',
  '                "foobar",',
  '                "barbarbarbarbarbar",',
  "            ]",
  "        );",
  "    }",
  "",
].join("\n");

/// Intersperse the three quizzes at their canonical rustlings checkpoints
/// instead of lumping them in one early "Quizzes" chapter (the import grouped
/// all three right after "If", so quiz2 — which uses Vecs — appeared 8 chapters
/// before the Vecs section). Idempotent: collects the quiz lessons from
/// wherever they currently sit and re-places each one.
///   quiz1 → after If (if3) · quiz2 → after Hashmaps (hashmaps3) · quiz3 → after Traits (traits5)
function reorderQuizzes(course) {
  const quizzes = {};
  for (const ch of course.chapters)
    for (const l of ch.lessons || [])
      if (/^quiz[123]$/.test(l.id)) quizzes[l.id] = l;
  for (const ch of course.chapters)
    ch.lessons = (ch.lessons || []).filter((l) => !/^quiz[123]$/.test(l.id));
  course.chapters = course.chapters.filter((ch) => (ch.lessons || []).length > 0);
  const inserts = [
    { after: "if3", id: "quiz-1", title: "Quiz 1", quiz: "quiz1" },
    { after: "hashmaps3", id: "quiz-2", title: "Quiz 2", quiz: "quiz2" },
    { after: "traits5", id: "quiz-3", title: "Quiz 3", quiz: "quiz3" },
  ];
  for (const ins of inserts) {
    if (!quizzes[ins.quiz]) continue;
    const idx = course.chapters.findIndex((ch) =>
      (ch.lessons || []).some((l) => l.id === ins.after));
    const chapter = { id: ins.id, title: ins.title, lessons: [quizzes[ins.quiz]] };
    if (idx < 0) course.chapters.push(chapter);
    else course.chapters.splice(idx + 1, 0, chapter);
  }
}

// --- extract, fix, re-bake ---
const work = mkdtempSync(join(tmpdir(), "rustlings-fix-"));
try {
  execFileSync("unzip", ["-qo", ARCHIVE, "-d", work], { stdio: "pipe" });
  const coursePath = join(work, "course.json");
  const course = JSON.parse(readFileSync(coursePath, "utf8"));

  let redone = 0;
  const unmatched = [];
  for (const ch of course.chapters)
    for (const l of ch.lessons || []) {
      const name = nameFor(l.id);
      if (!name) { unmatched.push(l.id); continue; }
      l.hints = splitHint(official[name]);
      redone++;
    }

  const quiz2 = course.chapters.flatMap((ch) => ch.lessons || []).find((l) => l.id === "quiz2");
  if (quiz2) quiz2.tests = QUIZ2_TEST;

  reorderQuizzes(course);

  writeFileSync(coursePath, JSON.stringify(course, null, 2));
  const cover = readdirSync(work).find((f) => /^cover\.(jpg|png)$/.test(f));
  execFileSync("zip", ["-q", "-X", ARCHIVE, "course.json", cover], { cwd: work });

  console.log(`✓ rustlings.academy: ${redone}/94 lessons given official hints` + (unmatched.length ? `, unmatched: ${unmatched.join(", ")}` : "") + `; quiz2 test restored to single-function; quizzes moved to their checkpoints.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
