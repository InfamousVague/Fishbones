#!/usr/bin/env node
/// Generate practice-only review questions (`reviewQuestions`) for the
/// code lessons of one Libre course using the Anthropic Claude API.
/// Idempotent — re-running only fills in lessons that don't already
/// carry a valid set, so a partial run can resume seamlessly.
///
/// For every CODE lesson (kind "exercise" or "mixed") lacking
/// `reviewQuestions`, generates exactly 3 questions: 2 multiple-choice
/// + 1 short-answer, reviewing the lesson's core concept. Questions
/// must be answerable WITHOUT the code on screen — they are harvested
/// into the Practice deck when the lesson is completed, and are never
/// rendered in the lesson flow itself.
///
/// Usage:
///   node --env-file=.env scripts/generate-review-questions.mjs \
///       <courseId-or-path-to-course.json> \
///       [--limit 5] \
///       [--concurrency 5] \
///       [--include-readings] \
///       [--force] \
///       [--dry-run]
///
/// Flags:
///   --limit N            Cap the number of lessons generated this run.
///   --concurrency N      Lessons in flight at once within this ONE
///                        process (default 5, or REVIEWQ_CONCURRENCY).
///   --include-readings   Also generate for reading-only lessons (no
///                        solution context). Off by default.
///   --force              Regenerate even lessons that already have
///                        valid reviewQuestions.
///   --dry-run            Print what WOULD be generated without making
///                        any API calls or writing any files.
///
/// Output:
///   Mutates `<courseFile>` in place, adding `reviewQuestions` (an
///   array of QuizQuestion — see src/data/types.ts) on each generated
///   lesson. Quiz lessons are always skipped (they ARE question
///   material already).

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ─── CLI parse ──────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.log(`Usage: generate-review-questions.mjs <courseId-or-path> [options]

Options:
  --limit <n>         Cap lessons generated this run
  --concurrency <n>   Lessons in flight at once (default 5, or
                      REVIEWQ_CONCURRENCY env)
  --include-readings  Also generate for reading lessons (default off)
  --force             Regenerate even lessons with existing reviewQuestions
  --dry-run           Don't call the API, don't write files
`);
  process.exit(args[0] === "--help" ? 0 : 1);
}

const courseRef = args[0];
const optLimit = parseFlag(args, "--limit");
const optConcurrency = parseFlag(args, "--concurrency");
const optForce = args.includes("--force");
const optDry = args.includes("--dry-run");
const optReadings = args.includes("--include-readings");

const limit = optLimit ? Number(optLimit) : Infinity;
const delayMs = Number(process.env.REVIEWQ_DELAY_MS || 200);
// Bounded internal concurrency: generate up to N lessons in flight at once
// within THIS single process/event loop. API latency dominates, so a few
// overlapping awaits is a large speedup while staying safe — there is still
// only one course object and one serialised writer.
const concurrency = Math.max(
  1,
  Number(optConcurrency || process.env.REVIEWQ_CONCURRENCY || 5),
);

// Prompt-context truncation caps. The body is reference material only —
// the model needs the concept, not the whole lesson.
const BODY_CAP = 3000;
const SOLUTION_CAP = 4000;

// ─── Resolve the course file ────────────────────────────────────
function resolveCourseFile(ref) {
  if (ref.endsWith(".json") && existsSync(ref)) return ref;
  if (ref.endsWith(".json") && existsSync(path.resolve(ref)))
    return path.resolve(ref);
  const starter = path.join(REPO_ROOT, "public", "starter-courses", `${ref}.json`);
  if (existsSync(starter)) return starter;
  throw new Error(`Course not found: ${ref}`);
}

const courseFile = resolveCourseFile(courseRef);
console.log(`📖 Course: ${path.relative(REPO_ROOT, courseFile)}`);
console.log(`⚙️  Concurrency: ${concurrency} lesson(s) in flight`);
if (optReadings) console.log(`📚 Including reading lessons`);
if (optDry) console.log(`(dry run — no API calls, no writes)`);

// ─── Anthropic client (raw fetch, no SDK dep) ───────────────────
// Same deliberate pattern as translate-course.mjs: content generation is a
// once-per-content-update task, not part of the runtime, so we avoid adding
// @anthropic-ai/sdk to package.json for a thin JSON POST wrapper.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
let apiKey = null;
if (!optDry) {
  apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set in env.");
    process.exit(1);
  }
}

const MODEL = "claude-sonnet-5";
const SYSTEM_PROMPT = `You write spaced-repetition review questions for a learn-to-code app. Given ONE lesson (title, body excerpt, reference solution), return EXACTLY 3 review questions as a STRICT JSON array: two multiple-choice first, then one short-answer.

Question shapes (match these exactly):
  { "kind": "mcq", "prompt": "...", "options": ["...","...","...","..."], "correctIndex": 0, "explanation": "one sentence" }
  { "kind": "short", "prompt": "...", "accept": ["answer", "variant"], "explanation": "one sentence" }

Rules:
- Review the lesson's CORE concept. Questions are shown later WITHOUT the lesson or its code on screen, so they must be conceptual — never "what does line 3 say", never referencing the exercise's variable names, file names, or specific code layout.
- mcq: exactly 4 options. All four must be plausible to someone who half-learned the material; exactly ONE is correct (correctIndex 0-3). Vary which position holds the correct answer across questions.
- short: the answer is a single 1-2 word term. "accept" lists 2-4 lowercase variants of it (synonyms, alternate spellings, with/without punctuation). All accept entries MUST be lowercase.
- explanation: exactly 1 sentence reinforcing WHY the answer is correct.
- Output ONLY the JSON array. No preamble, no markdown fences. Begin with [ and end with ].`;

// ─── Validation ─────────────────────────────────────────────────
// Hard-validates the QuizQuestion shapes from src/data/types.ts:
//   QuizMcq   { kind:"mcq", prompt, options[4], correctIndex 0-3, explanation? }
//   QuizShort { kind:"short", prompt, accept[] (lowercase), explanation? }
// Returns a NEW array containing only known fields (drops any junk keys the
// model may have added). Throws with a precise reason on any violation —
// the caller feeds that reason back to the model for the single retry.
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function validateQuestions(raw) {
  if (!Array.isArray(raw)) throw new Error("output is not a JSON array");
  if (raw.length !== 3)
    throw new Error(`expected exactly 3 questions, got ${raw.length}`);

  const out = [];
  let mcqCount = 0;
  let shortCount = 0;

  raw.forEach((q, i) => {
    if (q === null || typeof q !== "object")
      throw new Error(`question ${i} is not an object`);
    if (!isNonEmptyString(q.prompt))
      throw new Error(`question ${i}: prompt must be a non-empty string`);

    if (q.kind === "mcq") {
      mcqCount += 1;
      if (!Array.isArray(q.options) || q.options.length !== 4)
        throw new Error(`question ${i}: options must be an array of exactly 4`);
      if (!q.options.every(isNonEmptyString))
        throw new Error(`question ${i}: every option must be a non-empty string`);
      if (
        !Number.isInteger(q.correctIndex) ||
        q.correctIndex < 0 ||
        q.correctIndex >= 4
      )
        throw new Error(`question ${i}: correctIndex must be an integer 0-3`);
      const clean = {
        kind: "mcq",
        prompt: q.prompt.trim(),
        options: q.options.map((o) => o.trim()),
        correctIndex: q.correctIndex,
      };
      if (isNonEmptyString(q.explanation)) clean.explanation = q.explanation.trim();
      out.push(clean);
    } else if (q.kind === "short") {
      shortCount += 1;
      if (!Array.isArray(q.accept) || q.accept.length === 0)
        throw new Error(`question ${i}: accept must be a non-empty array`);
      if (!q.accept.every(isNonEmptyString))
        throw new Error(`question ${i}: every accept entry must be a non-empty string`);
      // Matching in the app is case-insensitive, but the schema contract is
      // lowercase — normalise deterministically, then dedupe.
      const accept = [...new Set(q.accept.map((a) => a.trim().toLowerCase()))];
      const clean = { kind: "short", prompt: q.prompt.trim(), accept };
      if (isNonEmptyString(q.explanation)) clean.explanation = q.explanation.trim();
      out.push(clean);
    } else {
      throw new Error(`question ${i}: kind must be "mcq" or "short", got ${JSON.stringify(q.kind)}`);
    }
  });

  if (mcqCount !== 2 || shortCount !== 1)
    throw new Error(`expected 2 mcq + 1 short, got ${mcqCount} mcq + ${shortCount} short`);
  return out;
}

function hasValidReviewQuestions(lesson) {
  if (!Array.isArray(lesson.reviewQuestions)) return false;
  try {
    validateQuestions(lesson.reviewQuestions);
    return true;
  } catch {
    return false;
  }
}

// ─── JSON extraction ────────────────────────────────────────────
// The system prompt demands a bare array, but strip fences / prose
// belt-and-suspenders: take the outermost [ ... ] span and parse that.
function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start)
    throw new Error("no JSON array found in response");
  return JSON.parse(text.slice(start, end + 1));
}

// ─── API call ───────────────────────────────────────────────────
let apiCallCount = 0;
async function callClaude(userPrompt) {
  apiCallCount += 1;
  await new Promise((r) => setTimeout(r, delayMs));
  // Retry transient 429/5xx with capped exponential backoff.
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (resp.status === 429 || resp.status >= 500) {
      const wait = 1000 * Math.pow(2, attempt);
      lastErr = new Error(`HTTP ${resp.status}, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const json = await resp.json();
    if (json.stop_reason === "max_tokens")
      throw new Error("response truncated at max_tokens");
    const block = (json.content || []).find((b) => b.type === "text");
    return block ? block.text.trim() : "";
  }
  throw lastErr || new Error("generation failed");
}

// ─── Per-lesson generation (with one validation retry) ──────────
function buildLessonPrompt(course, lesson) {
  const language = lesson.language || course.language || "";
  const body = (lesson.body || "").slice(0, BODY_CAP);
  // Multi-file lessons keep a flat `solution` concatenation; prefer it.
  const solution = (lesson.solution || "").slice(0, SOLUTION_CAP);
  let prompt = `Language: ${language}\nLesson title: ${lesson.title}\n\nLesson body (excerpt):\n${body}`;
  if (solution) {
    prompt += `\n\nReference solution:\n\`\`\`\n${solution}\n\`\`\``;
  }
  prompt += `\n\nWrite the 3 review questions now. Return ONLY the JSON array.`;
  return prompt;
}

async function generateForLesson(course, lesson) {
  const prompt = buildLessonPrompt(course, lesson);
  let rawText = await callClaude(prompt);
  try {
    return validateQuestions(extractJsonArray(rawText));
  } catch (firstErr) {
    // One corrective retry: show the model its own output and the exact
    // validation failure, then re-validate. After that, give up (caller warns).
    const retryPrompt = `${prompt}\n\nYour previous output was INVALID: ${firstErr.message}\n\nPrevious output:\n${rawText.slice(0, 2000)}\n\nReturn a corrected STRICT JSON array of exactly 3 questions (2 "mcq" + 1 "short") matching the required shapes. Begin with [ and end with ].`;
    rawText = await callClaude(retryPrompt);
    return validateQuestions(extractJsonArray(rawText));
  }
}

// ─── Serialised, debounced checkpoint writer ────────────────────
// Identical guarantees to translate-course.mjs: at most ONE writeFile in
// flight, debounced checkpoints while work is ongoing, a coalesced trailing
// write, and a guaranteed final flush. A kill mid-run leaves a valid file
// that the idempotent skip resumes from.
const WRITE_DEBOUNCE_MS = Number(process.env.REVIEWQ_WRITE_MS || 3000);
let writing = false;
let pendingWrite = false;
let lastWriteAt = 0;
let scheduledTimer = null;

async function doWrite() {
  if (writing) {
    pendingWrite = true;
    return;
  }
  writing = true;
  do {
    pendingWrite = false;
    lastWriteAt = Date.now();
    // Snapshot synchronously — JSON.stringify can't be interleaved with
    // another async task, so the string is a consistent view.
    const snapshot = JSON.stringify(course, null, 2);
    await writeFile(courseFile, snapshot);
  } while (pendingWrite);
  writing = false;
}

function requestCheckpoint() {
  if (optDry) return;
  const since = Date.now() - lastWriteAt;
  if (!writing && since >= WRITE_DEBOUNCE_MS) {
    void doWrite();
    return;
  }
  if (scheduledTimer) return;
  const wait = Math.max(0, WRITE_DEBOUNCE_MS - since);
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    void doWrite();
  }, wait);
  if (typeof scheduledTimer.unref === "function") scheduledTimer.unref();
}

async function flushWrites() {
  if (optDry) return;
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
  await doWrite();
  while (writing) await new Promise((r) => setTimeout(r, 25));
}

// ─── Bounded-concurrency worker pool ────────────────────────────
async function runPool(items, poolSize, worker, stagger = 0) {
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      if (stagger && i < poolSize && i > 0) {
        await new Promise((r) => setTimeout(r, stagger * i));
      }
      await worker(items[i], i);
    }
  }
  const runners = [];
  for (let k = 0; k < Math.min(poolSize, items.length); k++) {
    runners.push(runner());
  }
  await Promise.all(runners);
}

// ─── Walk the course ────────────────────────────────────────────
const course = JSON.parse(await readFile(courseFile, "utf8"));
const lessonCount = course.chapters.reduce((n, c) => n + c.lessons.length, 0);
console.log(`📚 ${course.chapters.length} chapters, ${lessonCount} lessons`);

function isEligible(lesson) {
  // Quiz lessons are already question material — always skip.
  if (lesson.kind === "quiz") return false;
  if (lesson.kind === "exercise" || lesson.kind === "mixed") return true;
  if (lesson.kind === "reading") return optReadings;
  return false;
}

const pending = [];
let skippedExisting = 0;
for (const chapter of course.chapters) {
  for (const lesson of chapter.lessons) {
    if (!isEligible(lesson)) continue;
    if (!optForce && hasValidReviewQuestions(lesson)) {
      skippedExisting += 1;
      continue;
    }
    pending.push({ chapter, lesson });
  }
}
if (skippedExisting > 0) {
  console.log(`⏭️  ${skippedExisting} lesson(s) already have valid reviewQuestions`);
}
const work = Number.isFinite(limit) ? pending.slice(0, limit) : pending;
if (Number.isFinite(limit) && pending.length > limit) {
  console.log(`  (limit ${limit} of ${pending.length} pending)`);
}
console.log(`🎯 ${work.length} lesson(s) to generate`);

const startedAt = Date.now();
let okCount = 0;
let failCount = 0;

if (optDry) {
  for (const { chapter, lesson } of work) {
    console.log(`  would generate: ${chapter.id}/${lesson.id} (${lesson.kind}) — ${lesson.title}`);
  }
} else {
  await runPool(
    work,
    concurrency,
    async ({ chapter, lesson }) => {
      const tag = `${chapter.id}/${lesson.id}`;
      try {
        const questions = await generateForLesson(course, lesson);
        lesson.reviewQuestions = questions;
        okCount += 1;
        process.stdout.write(`  [${okCount}] ${tag} ok (2 mcq + 1 short)\n`);
        requestCheckpoint();
      } catch (err) {
        failCount += 1;
        process.stdout.write(`  ⚠️  ${tag} SKIPPED after retry: ${err.message}\n`);
      }
    },
    delayMs,
  );
  await flushWrites();
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `\n✅ Done. ${okCount} lesson(s) generated, ${failCount} skipped, ${apiCallCount} API call(s), ${elapsed}s elapsed.`,
);
console.log(`   Output: ${path.relative(REPO_ROOT, courseFile)}`);

// ─── Helpers ────────────────────────────────────────────────────
function parseFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || null;
}
