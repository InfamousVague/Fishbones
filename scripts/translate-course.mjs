#!/usr/bin/env node
/// Translate one Libre-authored course into the supported non-EN
/// locales using the Anthropic Claude API. Idempotent — re-running
/// only fills in the locales / lessons that don't already have a
/// translation, so a partial run can resume seamlessly.
///
/// Usage:
///   ANTHROPIC_API_KEY=sk-ant-... \
///     node scripts/translate-course.mjs \
///       <courseId-or-path-to-course.json> \
///       --locales ru,es,fr,kr,jp \
///       [--limit 5] \
///       [--force-relock] \
///       [--dry-run]
///
/// Flags:
///   --locales      Comma-separated locales to fill in. Defaults to the
///                  full set (`ru,es,fr,kr,jp`). Use a subset to do one
///                  language at a time and inspect the output.
///   --limit        Cap the number of lessons translated per locale this
///                  run (useful for dry runs or rate-limit budgets).
///                  Defaults to no limit.
///   --force-relock Re-translate every lesson even if a translation
///                  already exists. Off by default — the script skips
///                  lessons where every translatable field is already
///                  populated for the locale.
///   --dry-run      Print what WOULD be translated without making any
///                  API calls or writing any files.
///
/// Output:
///   Mutates `<courseFile>` in place, adding `translations` overlays on
///   the course root, on each chapter, and on each lesson. The shape
///   matches `src/data/locales.ts` (CourseTranslation / ChapterTranslation
///   / LessonTranslation).
///
/// Recipe for translating ALL Libre-authored courses in one pass:
///   for c in a-to-zig a-to-ts hellotrade learning-ledger \
///            challenges-{ruby,lua,dart,haskell,scala,sql,elixir,zig,move,cairo,sway}-handwritten \
///            {rust,go,javascript,python,react-native,c,cpp,java,kotlin,csharp,swift}-challenges \
///            typescript-challenge-pack assembly-challenges-arm64-macos; do
///     node scripts/translate-course.mjs "$c" --locales ru,es,fr,kr,jp
///   done
///
/// API cost notes:
///   - Each lesson sends ~3-5 messages (title, body, objectives, hints/
///     questions). At ~500 input + ~600 output tokens per lesson per
///     locale, a 50-lesson course in 5 locales runs ~$2-4 with Sonnet.
///   - The script serialises requests with a 200ms delay between calls
///     to stay well under the per-minute rate limit. Override with
///     FB_TRANSLATE_DELAY_MS if you have a higher tier.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ─── Locale config (mirrors src/data/locales.ts) ────────────────
const LOCALE_ENGLISH_NAMES = {
  ru: "Russian",
  es: "Spanish",
  fr: "French",
  kr: "Korean",
  jp: "Japanese",
  hi: "Hindi",
  ar: "Arabic",
  ur: "Urdu",
  tr: "Turkish",
  bn: "Bengali",
  tl: "Filipino (Tagalog)",
  fa: "Dari (Afghan Persian)",
  ne: "Nepali",
  vi: "Vietnamese",
  id: "Indonesian",
  sw: "Swahili",
};
const ALL_NON_EN = Object.keys(LOCALE_ENGLISH_NAMES);

// ─── CLI parse ──────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.log(`Usage: translate-course.mjs <courseId-or-path> [options]

Options:
  --locales <list>   Comma-separated: ru,es,fr,kr,jp (default: all)
  --limit <n>        Cap lessons translated per locale this run
  --concurrency <n>  Lessons translated in flight at once (default 6,
                     or TRANSLATE_CONCURRENCY env)
  --force-relock     Re-translate even already-translated lessons
  --dry-run          Don't call the API, don't write files
`);
  process.exit(args[0] === "--help" ? 0 : 1);
}

const courseRef = args[0];
const optLocales = parseFlag(args, "--locales") || ALL_NON_EN.join(",");
const optLimit = parseFlag(args, "--limit");
const optConcurrency = parseFlag(args, "--concurrency");
const optForce = args.includes("--force-relock");
const optDry = args.includes("--dry-run");

const targetLocales = optLocales
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
for (const l of targetLocales) {
  if (!LOCALE_ENGLISH_NAMES[l]) {
    console.error(`Unknown locale: ${l}`);
    console.error(`Supported: ${ALL_NON_EN.join(", ")}`);
    process.exit(1);
  }
}

const limit = optLimit ? Number(optLimit) : Infinity;
const delayMs = Number(process.env.FB_TRANSLATE_DELAY_MS || 200);
// Bounded internal concurrency: translate up to N lessons in flight at once
// within THIS single process/event loop. Because the API latency (~20s/call)
// dominates, overlapping several in-flight `await`s is a large speedup while
// staying safe — there is still only one course object and one serialised
// writer. `--concurrency` beats TRANSLATE_CONCURRENCY beats the default of 6.
const concurrency = Math.max(
  1,
  Number(optConcurrency || process.env.TRANSLATE_CONCURRENCY || 6),
);

// ─── Resolve the course file ────────────────────────────────────
function resolveCourseFile(ref) {
  // 1. Absolute / relative path that exists → use as-is.
  if (ref.endsWith(".json") && existsSync(ref)) return ref;
  if (ref.endsWith(".json") && existsSync(path.resolve(ref)))
    return path.resolve(ref);
  // 2. Treat as course id and look in `public/starter-courses/`.
  const starter = path.join(REPO_ROOT, "public", "starter-courses", `${ref}.json`);
  if (existsSync(starter)) return starter;
  throw new Error(`Course not found: ${ref}`);
}

const courseFile = resolveCourseFile(courseRef);
console.log(`📖 Course: ${path.relative(REPO_ROOT, courseFile)}`);
console.log(`🌍 Locales: ${targetLocales.join(", ")}`);
console.log(`⚙️  Concurrency: ${concurrency} lesson(s) in flight`);
if (optDry) console.log(`(dry run — no API calls, no writes)`);

// ─── Anthropic client (raw fetch, no SDK dep) ───────────────────
// Using fetch directly so this script doesn't add @anthropic-ai/sdk
// to package.json — translation is a once-per-content-update task,
// not part of the runtime, and the SDK's only value here would be a
// thin wrapper around the same JSON POST.
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
const SYSTEM_PROMPT = (locale) => `You translate technical educational content from English into ${LOCALE_ENGLISH_NAMES[locale]}.

Strict rules:
1. Preserve ALL markdown formatting exactly: headings, lists, blockquotes, links, images, tables, horizontal rules.
2. Preserve ALL code blocks (\`\`\` fences) VERBATIM. Do not translate code, identifiers, comments inside code, language tags, or anything between the fences.
3. Preserve ALL inline backticks: do not translate the text inside backticks (\`like_this\`).
4. Preserve ALL HTML tags and attributes verbatim.
5. Preserve ALL link URLs verbatim (translate only the visible link text).
6. Translate natural-language prose, headings, list items, captions, alt text, and link visible text.
7. Do not translate function names, variable names, file names, paths, URLs, or technical identifiers (whether inline or in prose).
8. Keep the same paragraph structure, bullet count, and numbered-list ordering as the source.
9. Output ONLY the translated text. Do not add commentary, do not wrap in code fences, do not preface with "Here is the translation".

If the input is short (a title, a single phrase, a list item), return ONLY the translated phrase with no extra punctuation or context.`;

// Inline base64 images (`data:image/…;base64,<blob>`) must NEVER be sent to
// the model: a single hero image is tens of thousands of tokens, so the body
// blows past `max_tokens` and the response is truncated mid-lesson — silently
// dropping every code block and paragraph after the first image. We swap each
// data-URI for a short sentinel before translating and swap the originals back
// after, so the model only ever sees (and has to reproduce) the prose + code.
const IMG_DATAURI_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const IMG_TOKEN_RE = /LIBRE_IMG_PLACEHOLDER_(\d+)/g;
function maskImages(text) {
  const imgs = [];
  const masked = text.replace(IMG_DATAURI_RE, (m) => {
    const token = `LIBRE_IMG_PLACEHOLDER_${imgs.length}`;
    imgs.push(m);
    return token;
  });
  return { masked, imgs };
}
function restoreImages(text, imgs) {
  return text.replace(IMG_TOKEN_RE, (whole, i) => imgs[Number(i)] ?? whole);
}

let apiCallCount = 0;
async function translateOne(text, locale) {
  if (!text || !text.trim()) return text;
  apiCallCount += 1;
  if (optDry) return `[${locale}] ${text}`;
  // Strip heavy base64 images out of the payload; restore them verbatim on the
  // way back so the translated markdown is byte-identical around each image.
  const { masked, imgs } = maskImages(text);
  await new Promise((r) => setTimeout(r, delayMs));
  // Retry on transient 429/5xx with capped exponential backoff.
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
        max_tokens: 8192,
        system: SYSTEM_PROMPT(locale),
        messages: [{ role: "user", content: masked }],
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
    if (json.stop_reason === "max_tokens") {
      // Never persist a truncated translation — fail loudly so the lesson is
      // retried (and, if it recurs, flagged as needing chunking) rather than
      // silently losing every block past the cutoff.
      throw new Error(
        `response truncated at max_tokens (${masked.length} input chars) — too long for one call`,
      );
    }
    const block = (json.content || []).find((b) => b.type === "text");
    return restoreImages(block ? block.text.trim() : "", imgs);
  }
  throw lastErr || new Error("translation failed");
}

async function translateLessonFields(lesson, locale) {
  const out = {};
  if (lesson.title) out.title = await translateOne(lesson.title, locale);
  if (lesson.body) out.body = await translateOne(lesson.body, locale);
  if (Array.isArray(lesson.objectives) && lesson.objectives.length > 0) {
    out.objectives = [];
    for (const o of lesson.objectives) {
      out.objectives.push(await translateOne(o, locale));
    }
  }
  if (Array.isArray(lesson.hints) && lesson.hints.length > 0) {
    out.hints = [];
    for (const h of lesson.hints) {
      out.hints.push(await translateOne(h, locale));
    }
  }
  if (Array.isArray(lesson.questions) && lesson.questions.length > 0) {
    out.questions = [];
    for (const q of lesson.questions) {
      const tq = {};
      if (q.prompt) tq.prompt = await translateOne(q.prompt, locale);
      if (Array.isArray(q.options) && q.options.length > 0) {
        tq.options = [];
        for (const op of q.options) {
          tq.options.push(await translateOne(op, locale));
        }
      }
      if (q.explanation)
        tq.explanation = await translateOne(q.explanation, locale);
      out.questions.push(tq);
    }
  }
  return out;
}

function isLessonFullyTranslated(lesson, locale) {
  const t = lesson?.translations?.[locale];
  if (!t) return false;
  if (lesson.title && !t.title) return false;
  if (lesson.body && !t.body) return false;
  if (Array.isArray(lesson.objectives) && lesson.objectives.length > 0)
    if (
      !Array.isArray(t.objectives) ||
      t.objectives.length !== lesson.objectives.length
    )
      return false;
  if (Array.isArray(lesson.hints) && lesson.hints.length > 0)
    if (!Array.isArray(t.hints) || t.hints.length !== lesson.hints.length)
      return false;
  if (Array.isArray(lesson.questions) && lesson.questions.length > 0)
    if (!Array.isArray(t.questions) || t.questions.length !== lesson.questions.length)
      return false;
  return true;
}

// ─── Serialised, debounced checkpoint writer ────────────────────
// Under concurrency, many lessons finish close together, so we must NOT
// let two writeFile calls race (that would interleave two serialisations
// of the same object onto disk and corrupt it). This writer guarantees:
//   • at most ONE writeFile in flight at any moment (single-in-flight guard),
//   • at most one checkpoint every WRITE_DEBOUNCE_MS while work is ongoing
//     (so we're not re-serialising a 10 MB file after every single lesson),
//   • a coalesced trailing write if requests arrived while one was in flight,
//   • a guaranteed final flush via flushWrites() at the very end.
// Every completed lesson is captured by whichever checkpoint lands after it,
// so a kill mid-run still leaves a valid file that `isLessonFullyTranslated`
// resumes from on the next invocation.
const WRITE_DEBOUNCE_MS = Number(process.env.FB_TRANSLATE_WRITE_MS || 3000);
let writing = false; // a writeFile is currently in flight
let pendingWrite = false; // a checkpoint was requested while writing
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
    // Snapshot synchronously — JSON.stringify cannot be interrupted by
    // another async task, so the serialised string is a consistent view.
    const snapshot = JSON.stringify(course, null, 2);
    await writeFile(courseFile, snapshot);
  } while (pendingWrite); // coalesce anything requested mid-write
  writing = false;
}

// Request a checkpoint. Debounced: if we wrote recently, schedule one for
// later instead of writing now. Returns immediately (fire-and-forget).
function requestCheckpoint() {
  if (optDry) return;
  const since = Date.now() - lastWriteAt;
  if (!writing && since >= WRITE_DEBOUNCE_MS) {
    void doWrite();
    return;
  }
  if (scheduledTimer) return; // one is already queued
  const wait = Math.max(0, WRITE_DEBOUNCE_MS - since);
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    void doWrite();
  }, wait);
  // Don't let a pending checkpoint keep the process alive on its own.
  if (typeof scheduledTimer.unref === "function") scheduledTimer.unref();
}

// Guaranteed final write — clears any pending debounce and waits for the
// in-flight write (plus any coalesced trailing write) to fully settle.
async function flushWrites() {
  if (optDry) return;
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
  await doWrite(); // write current state
  while (writing) await new Promise((r) => setTimeout(r, 25));
}

// ─── Bounded-concurrency worker pool ────────────────────────────
// Runs the async `worker` over `items` with at most `poolSize` in flight.
// A small `stagger` between launches spreads the initial burst so we don't
// fire N requests on the exact same tick (keeps us gentle on rate limits;
// steady-state pacing is still handled by FB_TRANSLATE_DELAY_MS per call).
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
const lessonCount = course.chapters.reduce(
  (n, c) => n + c.lessons.length,
  0,
);
console.log(`📚 ${course.chapters.length} chapters, ${lessonCount} lessons`);

const startedAt = Date.now();
let writeCount = 0;

for (const locale of targetLocales) {
  console.log(`\n── ${locale.toUpperCase()} (${LOCALE_ENGLISH_NAMES[locale]}) ──`);
  let translatedThisLocale = 0;

  // Course root.
  course.translations ??= {};
  course.translations[locale] ??= {};
  if (optForce || !course.translations[locale].title) {
    if (course.title) {
      course.translations[locale].title = await translateOne(course.title, locale);
    }
  }
  if (optForce || !course.translations[locale].description) {
    if (course.description) {
      course.translations[locale].description = await translateOne(
        course.description,
        locale,
      );
    }
  }

  // Chapter titles (small, translated inline in document order).
  for (const chapter of course.chapters) {
    chapter.translations ??= {};
    chapter.translations[locale] ??= {};
    if (optForce || !chapter.translations[locale].title) {
      if (chapter.title)
        chapter.translations[locale].title = await translateOne(
          chapter.title,
          locale,
        );
    }
  }

  // Collect the lessons that still need work, in document order. `--limit`
  // caps the number of lessons translated per locale this run (unchanged
  // semantics) — apply it here, after the idempotent skip, so we dispatch
  // exactly that many to the pool.
  const pending = [];
  for (const chapter of course.chapters) {
    for (const lesson of chapter.lessons) {
      lesson.translations ??= {};
      if (!optForce && isLessonFullyTranslated(lesson, locale)) continue;
      pending.push({ chapter, lesson });
    }
  }
  const work = Number.isFinite(limit) ? pending.slice(0, limit) : pending;
  if (Number.isFinite(limit) && pending.length > limit) {
    console.log(`  (limit ${limit} of ${pending.length} pending)`);
  }

  // Translate up to `concurrency` lessons in flight. Each finished lesson
  // requests a debounced checkpoint; the serialised writer guarantees no
  // two writeFile calls ever overlap. A small launch stagger spreads the
  // initial burst across workers.
  await runPool(
    work,
    concurrency,
    async ({ chapter, lesson }) => {
      const tag = `${chapter.id}/${lesson.id}`;
      try {
        const t = await translateLessonFields(lesson, locale);
        lesson.translations[locale] = t;
        translatedThisLocale += 1;
        writeCount += 1;
        process.stdout.write(
          `  [${writeCount}] ${tag} → ${locale} ok\n`,
        );
        requestCheckpoint();
      } catch (err) {
        process.stdout.write(`  ${tag} → ${locale} FAIL: ${err.message}\n`);
      }
    },
    delayMs,
  );

  // Flush this locale's work to disk before moving to the next one, so a
  // kill between locales leaves a fully-persisted checkpoint.
  await flushWrites();
  console.log(`  ${translatedThisLocale} lesson(s) translated for ${locale}`);
}

// Guaranteed final write (covers any trailing debounced checkpoint).
await flushWrites();

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `\n✅ Done. ${writeCount} lessons translated, ${apiCallCount} API call(s), ${elapsed}s elapsed.`,
);
console.log(`   Output: ${path.relative(REPO_ROOT, courseFile)}`);

// ─── Helpers ────────────────────────────────────────────────────
function parseFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || null;
}
