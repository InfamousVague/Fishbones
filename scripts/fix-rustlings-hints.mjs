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

/// Four exercises whose entire task lives INSIDE the upstream test module
/// (slicing, tuple indexing, borrow reordering, if-let/while-let). Libre's
/// model has a non-editable `tests` field, so the importer left their starters
/// empty and dropped the already-SOLVED test in — nothing for the learner to
/// do, and it auto-passes ("primitive_types4 has nothing"). Restructure each so
/// the editable work is a function in the starter, graded by the test. All four
/// are compile-verified (rustc --test). Also refresh the body's stale
/// empty-main preview block to show the new starter.
const BROKEN_EXERCISES = {
  // move_semantics2 is the odd one out: its upstream task is at the CALL
  // SITE (clone `vec0` so it survives the move into `fill_vec`), not inside
  // `fill_vec`. The importer shipped the already-correct code as the starter
  // — `fill_vec` complete, an empty experiment `main` — so it auto-passed
  // with nothing to fix. We restore the canonical challenge in `main`: it
  // moves `vec0` into `fill_vec` and then still uses it, which won't compile
  // until the learner adds `.clone()`. The merged crate compiles `main`
  // (see runtimes/rust.ts joinCodeAndTests), so the broken `main` blocks the
  // test until fixed; the non-editable test already clones, so it passes
  // once `main` does. Matches the lesson's existing move/clone hints.
  "move-semantics2": {
    starter:
      "fn fill_vec(vec: Vec<i32>) -> Vec<i32> {\n    let mut vec = vec;\n\n" +
      "    vec.push(88);\n\n    vec\n}\n\n" +
      "fn main() {\n    let vec0 = vec![22, 44, 66];\n\n" +
      "    // TODO: `vec0` is MOVED into `fill_vec` here, so the lines below\n" +
      "    // that still use `vec0` won't compile. Fix this call so `vec0`\n" +
      "    // stays usable afterwards (hint: it has a method that copies it).\n" +
      "    let vec1 = fill_vec(vec0);\n\n" +
      "    println!(\"{vec0:?} has length {}\", vec0.len());\n" +
      "    println!(\"{vec1:?} has length {}\", vec1.len());\n}\n",
    tests:
      "#[test]\n    fn move_semantics2() {\n        let vec0 = vec![22, 44, 66];\n\n" +
      "        // Cloning `vec0` so that the clone is moved into `fill_vec`,\n" +
      "        // not `vec0` itself.\n" +
      "        let vec1 = fill_vec(vec0.clone());\n\n" +
      "        assert_eq!(vec0, [22, 44, 66]);\n" +
      "        assert_eq!(vec1, [22, 44, 66, 88]);\n    }\n",
    solution:
      "fn fill_vec(vec: Vec<i32>) -> Vec<i32> {\n    let mut vec = vec;\n\n" +
      "    vec.push(88);\n\n    vec\n}\n\n" +
      "fn main() {\n    let vec0 = vec![22, 44, 66];\n\n" +
      "    // Clone so the original `vec0` isn't moved into `fill_vec`.\n" +
      "    let vec1 = fill_vec(vec0.clone());\n\n" +
      "    println!(\"{vec0:?} has length {}\", vec0.len());\n" +
      "    println!(\"{vec1:?} has length {}\", vec1.len());\n}\n",
  },
  "primitive-types4": {
    starter:
      "// TODO: Return the slice `[2, 3, 4]` out of the array `a`.\n" +
      "// Replace `todo!()` with a slice expression — e.g. `&a[start..end]`\n" +
      "// (the end index is excluded).\n" +
      "pub fn middle_three(a: &[i32; 5]) -> &[i32] {\n    todo!()\n}\n\n" +
      "fn main() {\n    // You can optionally experiment here.\n}\n",
    tests:
      "#[test]\nfn slice_out_of_array() {\n    let a = [1, 2, 3, 4, 5];\n" +
      "    assert_eq!(middle_three(&a), &[2, 3, 4]);\n}\n",
    solution:
      "pub fn middle_three(a: &[i32; 5]) -> &[i32] {\n    &a[1..4]\n}\n\nfn main() {}\n",
  },
  "primitive-types6": {
    starter:
      "// TODO: Return the second element of the tuple using tuple indexing\n" +
      "// (e.g. `t.0`, `t.1`, ...).\n" +
      "pub fn second_of(t: (i32, i32, i32)) -> i32 {\n    todo!()\n}\n\n" +
      "fn main() {\n    // You can optionally experiment here.\n}\n",
    tests:
      "#[test]\nfn indexing_tuple() {\n    let second = second_of((1, 2, 3));\n" +
      "    assert_eq!(second, 2, \"This is not the 2nd number in the tuple!\");\n}\n",
    solution:
      "pub fn second_of(t: (i32, i32, i32)) -> i32 {\n    t.1\n}\n\nfn main() {}\n",
  },
  "move-semantics4": {
    starter:
      "// TODO: Make this compile by REORDERING the lines — don't add, change, or\n" +
      "// remove any. Two `&mut` borrows of `x` can't be alive at once, so finish\n" +
      "// using `y` before creating `z`.\n" +
      "pub fn build() -> Vec<i32> {\n    let mut x = Vec::new();\n    let y = &mut x;\n" +
      "    let z = &mut x;\n    y.push(42);\n    z.push(13);\n    x\n}\n\n" +
      "fn main() {\n    // You can optionally experiment here.\n}\n",
    tests:
      "#[test]\nfn move_semantics4() {\n    assert_eq!(build(), [42, 13]);\n}\n",
    solution:
      "pub fn build() -> Vec<i32> {\n    let mut x = Vec::new();\n    let y = &mut x;\n" +
      "    y.push(42);\n    let z = &mut x;\n    z.push(13);\n    x\n}\n\nfn main() {}\n",
  },
  "options2": {
    starter:
      "// options2 — practice `if let` and `while let`.\n\n" +
      "// TODO: Use an `if let` to return the inner value when `opt` is `Some`,\n" +
      "// or `-1` when it's `None`.\n" +
      "pub fn first(opt: Option<i32>) -> i32 {\n    todo!()\n}\n\n" +
      "// TODO: Use a `while let` to pop every `Some(_)` off `stack` and collect\n" +
      "// the inner values in pop order, stopping at the first `None`. `Vec::pop`\n" +
      "// adds another `Option` layer, so match `Some(Some(value))`.\n" +
      "pub fn drain(mut stack: Vec<Option<i32>>) -> Vec<i32> {\n    todo!()\n}\n\n" +
      "fn main() {\n    // You can optionally experiment here.\n}\n",
    tests:
      "#[test]\nfn simple_option() {\n    assert_eq!(first(Some(7)), 7);\n" +
      "    assert_eq!(first(None), -1);\n}\n\n" +
      "#[test]\nfn layered_option() {\n    let stack = vec![None, Some(1), Some(2), Some(3)];\n" +
      "    assert_eq!(drain(stack), vec![3, 2, 1]);\n}\n",
    solution:
      "pub fn first(opt: Option<i32>) -> i32 {\n    if let Some(v) = opt { v } else { -1 }\n}\n\n" +
      "pub fn drain(mut stack: Vec<Option<i32>>) -> Vec<i32> {\n    let mut out = Vec::new();\n" +
      "    while let Some(Some(v)) = stack.pop() {\n        out.push(v);\n    }\n    out\n}\n\nfn main() {}\n",
  },
};

function fixBrokenExercises(course) {
  const EMPTY_MAIN =
    "```rust\nfn main() {\n    // You can optionally experiment here.\n}\n```";
  // Fallback for fixed lessons whose body preview is the FULL starter (not
  // just an empty main) — e.g. move_semantics2, whose challenge lives in a
  // populated `main`. Replace the first fenced ```rust block with the new
  // starter so the article preview matches the editor.
  const RUST_FENCE = /```rust\n[\s\S]*?\n```/;
  for (const ch of course.chapters)
    for (const l of ch.lessons || []) {
      const fx = BROKEN_EXERCISES[l.id];
      if (!fx) continue;
      const newFence = "```rust\n" + fx.starter.trimEnd() + "\n```";
      if (l.body && l.body.includes(EMPTY_MAIN))
        l.body = l.body.replace(EMPTY_MAIN, newFence);
      else if (l.body && RUST_FENCE.test(l.body))
        l.body = l.body.replace(RUST_FENCE, newFence);
      l.starter = fx.starter;
      l.tests = fx.tests;
      l.solution = fx.solution;
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
  fixBrokenExercises(course);

  writeFileSync(coursePath, JSON.stringify(course, null, 2));
  const cover = readdirSync(work).find((f) => /^cover\.(jpg|png)$/.test(f));
  execFileSync("zip", ["-q", "-X", ARCHIVE, "course.json", cover], { cwd: work });

  console.log(`✓ rustlings.academy: ${redone}/94 lessons given official hints` + (unmatched.length ? `, unmatched: ${unmatched.join(", ")}` : "") + `; quiz2 test restored to single-function; quizzes moved to their checkpoints; 4 empty exercises (primitive_types4/6, move_semantics4, options2) restructured to be solvable.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
