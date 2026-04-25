#!/usr/bin/env node
/// Bulk-generate challenge packs for languages that don't have one yet.
/// Calls the Anthropic API directly (key read from the app's settings.json)
/// and writes each pack as a `course.json` under
/// `~/Library/Application Support/com.mattssoftware.kata/courses/`,
/// using the same shape the in-app challenge generator produces.
///
/// Usage:
///   node scripts/bulk-generate-challenges.mjs              # all missing
///   node scripts/bulk-generate-challenges.mjs assembly     # one language
///   node scripts/bulk-generate-challenges.mjs c java       # several
///
/// Env:
///   PER_TIER=10        — challenges per (language, tier). Default 10.
///   DRY_RUN=1          — log what would be generated, don't call API.
///   MODEL=claude-sonnet-4-5  — override the default model.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_SUPPORT = path.join(
  os.homedir(),
  "Library/Application Support/com.mattssoftware.kata",
);
const COURSES_DIR = path.join(APP_SUPPORT, "courses");
const SETTINGS_PATH = path.join(APP_SUPPORT, "settings.json");

const PER_TIER = Number(process.env.PER_TIER ?? 10);
const DRY_RUN = !!process.env.DRY_RUN;
const MODEL = process.env.MODEL ?? "claude-sonnet-4-5";
const TIERS = ["easy", "medium", "hard"];

/// Topic seeds per language. Keeps the generator from repeating the
/// same problem 30 times — each (lang, tier) call cycles through
/// topics so the pack covers a breadth of concepts.
const TOPICS = {
  javascript: ["arrays", "strings", "objects", "closures", "promises", "iteration", "recursion", "regex", "DOM-free utilities", "functional combinators"],
  typescript: ["generics", "discriminated unions", "type guards", "mapped types", "iterators", "promises", "async patterns", "tuple manipulation", "branded types", "utility types"],
  python: ["lists", "dictionaries", "iteration", "comprehensions", "decorators", "generators", "string parsing", "recursion", "classes", "regex"],
  swift: ["optionals", "structs", "enums with associated values", "protocols", "closures", "collections", "string manipulation", "result types", "extensions", "generics"],
  c: ["arrays", "pointers", "strings", "bit manipulation", "structs", "linked lists", "memory layout", "stdio formatting", "math utilities", "loops"],
  cpp: ["std::vector", "std::string", "std::map", "iterators", "lambdas", "templates", "RAII", "smart pointers", "algorithms", "operator overloading"],
  java: ["arrays", "strings", "ArrayList", "HashMap", "OOP basics", "interfaces", "exceptions", "streams", "recursion", "generics"],
  kotlin: ["data classes", "collections", "extensions", "scope functions", "sealed classes", "null safety", "lambdas", "string templates", "coroutines (sync)", "destructuring"],
  csharp: ["LINQ", "lists", "dictionaries", "strings", "records", "pattern matching", "tuples", "extension methods", "delegates", "async (sync demo)"],
  assembly: ["arithmetic exit codes", "conditional logic", "loops with counters", "bit manipulation", "stack frames", "function calls", "memory load/store", "comparisons", "shifts", "register allocation"],
};

const SUPPORTED = Object.keys(TOPICS);

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    throw new Error(`settings.json not found at ${SETTINGS_PATH}`);
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
}

function existingChallengeLanguages() {
  if (!fs.existsSync(COURSES_DIR)) return new Set();
  const out = new Set();
  for (const d of fs.readdirSync(COURSES_DIR)) {
    if (!d.startsWith("challenges-")) continue;
    const m = /^challenges-([a-z]+)-/.exec(d);
    if (m) out.add(m[1]);
  }
  return out;
}

const SYSTEM_PROMPT = `You author ONE stand-alone kata-style coding challenge for the Fishbones app. Given a language, a difficulty tier, and a topic, return a single JSON object:

  {
    "title": "short descriptive title (≤ 60 chars)",
    "body": "markdown problem statement: what to build, input/output shape, 1-2 examples, edge cases",
    "starter": "runnable starter code containing a function stub the learner fills in",
    "solution": "reference solution — MUST pass every assertion in \`tests\`",
    "tests": "language-appropriate test code (see TEST HARNESS rules below)",
    "hints": ["optional", "progressive", "hints"]
  }

DIFFICULTY GUIDE:
  easy   — one concept, ~5-10 lines of solution, obvious approach.
  medium — two concepts composed, 10-25 lines, one non-obvious step.
  hard   — algorithmic or subtle edge cases, 25-60 lines, multiple concepts interacting.

TEST HARNESS — STRONG RULES (non-negotiable):
  - Every test MUST contain at least one real assertion exercising learner code with a specific input and a specific expected output.
  - BANNED: tests that just call the function and assert nothing; tests that only check existence/type signature.
  - Provide ≥ 3 assertions covering: normal case, edge case (empty/zero/boundary), and an unusual case.

Per-language harness:

  TypeScript / JavaScript:
    \`test("name", () => { ... })\` and \`expect(x).toBe(y)\` / \`.toEqual(y)\` / \`.toThrow()\`.
    Solution + starter MUST end with \`module.exports = { ... }\`. Tests import via \`require('./user')\`.

  Python:
    Use the harness: \`@test("name") def fn(): expect(x).to_be(y)\`.
    User code is exposed as \`user\` module; tests do \`from user import thing\`.

  Swift:
    Run-only. Set \`tests\` to "". Solution must compile and exit 0.

  C / C++ / Java / Kotlin / C#:
    Single self-contained translation unit (combine learner code + tests).
    The combined source's \`main()\` (or \`Main\`/static main) MUST iterate all assertions and print EXACTLY:
      \`KATA_TEST::<name>::PASS\` on success
      \`KATA_TEST::<name>::FAIL::<short one-line reason>\` on failure
    The test runner greps stdout for these lines.
    For Java/Kotlin: pick a single public class name; the test runner names the source file accordingly (\`Main.java\` / \`Main.kt\`). Solution and tests must coexist in this single class.

  Assembly (arm64 macOS):
    Run-only. Set \`tests\` to "".
    The challenge body asks the learner to compute some value and EXIT WITH IT as the process exit code (via \`mov x16, #1; svc #0x80\` on macOS arm64 — the BSD exit syscall).
    The exercise PASSES iff the binary exits with code 0 — phrase the challenge so the correct algorithm naturally produces exit code 0 (e.g. "exit 0 if the bitwise XOR of these three constants equals 42, else exit 1").
    Solution must be a single .s file with \`.global _main\` + \`_main:\` entry, idiomatic AAPCS64. No external libraries.

WRITING GUIDELINES:
  - Title: concrete verb phrase ("Reverse a String", "Implement LRU Cache").
  - Body: lead with what to build, then I/O examples, then constraints. ≤ 150 words of prose.
  - Starter: function signature + a TODO comment. MUST compile.
  - Solution: must pass every assertion you wrote.
  - Hints: 1-3 short progressive nudges. Optional.

Return ONLY the JSON object. Begin with \`{\`, end with \`}\`. No markdown fences, no preamble.`;

async function callAnthropic({ apiKey, language, difficulty, topic }) {
  const userPrompt = `Language: ${language}\nDifficulty: ${difficulty}\nTopic: ${topic}\n\nGenerate one challenge matching the constraints above. Return ONLY the JSON.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  const text = body.content?.[0]?.text ?? "";
  return { text, usage: body.usage };
}

function parseJsonTolerant(raw) {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* fall through */ }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

function packIdFor(language) {
  // Random suffix mirrors the existing `challenges-go-mo9kijkd` pattern.
  const suffix = Math.random().toString(36).slice(2, 10);
  return `challenges-${language}-${suffix}`;
}

function lessonIdFor(language, tier, topic, idx) {
  return `${tier}-${slugify(topic)}-${idx}`;
}

function chapterIdFor(tier) {
  return tier;
}

async function generatePack(apiKey, language) {
  console.log(`\n=== ${language} ===`);
  const lessons = { easy: [], medium: [], hard: [] };
  const topics = TOPICS[language];
  for (const tier of TIERS) {
    for (let i = 0; i < PER_TIER; i++) {
      const topic = topics[i % topics.length];
      const tag = `${language}/${tier}/${topic}#${i + 1}`;
      if (DRY_RUN) {
        console.log(`  [dry] would generate ${tag}`);
        continue;
      }
      try {
        const { text, usage } = await callAnthropic({ apiKey, language, difficulty: tier, topic });
        const parsed = parseJsonTolerant(text);
        if (!parsed) {
          console.log(`  FAIL ${tag}: unparseable response`);
          continue;
        }
        const lesson = {
          id: lessonIdFor(language, tier, topic, i + 1),
          kind: "exercise",
          title: parsed.title || `${tier} ${topic} ${i + 1}`,
          body: parsed.body || "",
          language,
          difficulty: tier,
          topic,
          starter: parsed.starter || "",
          solution: parsed.solution || "",
          tests: parsed.tests ?? "",
          hints: parsed.hints || [],
        };
        lessons[tier].push(lesson);
        console.log(`  ok ${tag}: "${lesson.title}" (in=${usage?.input_tokens} out=${usage?.output_tokens})`);
      } catch (e) {
        console.log(`  FAIL ${tag}: ${e.message}`);
      }
    }
  }
  if (DRY_RUN) return;

  const totalLessons = lessons.easy.length + lessons.medium.length + lessons.hard.length;
  if (totalLessons === 0) {
    console.log(`  no lessons generated for ${language} — skipping pack write`);
    return;
  }

  const packId = packIdFor(language);
  const packDir = path.join(COURSES_DIR, packId);
  fs.mkdirSync(packDir, { recursive: true });
  const course = {
    id: packId,
    title: `${language[0].toUpperCase() + language.slice(1)} Challenges`,
    author: "Fishbones",
    language,
    description: `Bulk-generated kata challenges for ${language}.`,
    chapters: TIERS.map((tier) => ({
      id: chapterIdFor(tier),
      title: `${tier[0].toUpperCase() + tier.slice(1)}`,
      lessons: lessons[tier],
    })),
  };
  fs.writeFileSync(path.join(packDir, "course.json"), JSON.stringify(course, null, 2) + "\n");
  console.log(`  wrote ${packDir}/course.json (${totalLessons} lessons)`);
}

async function main() {
  const requestedLangs = process.argv.slice(2).filter((a) => SUPPORTED.includes(a));
  const existing = existingChallengeLanguages();
  const missing = SUPPORTED.filter((l) => !existing.has(l));
  const langs = requestedLangs.length > 0 ? requestedLangs : missing;

  console.log(`bulk challenge generator`);
  console.log(`  model:    ${MODEL}`);
  console.log(`  per-tier: ${PER_TIER}`);
  console.log(`  dry-run:  ${DRY_RUN}`);
  console.log(`  existing: ${[...existing].sort().join(", ") || "(none)"}`);
  console.log(`  target:   ${langs.join(", ") || "(none — all langs already have packs)"}`);

  if (langs.length === 0) return;

  const settings = readSettings();
  const apiKey = settings.anthropic_api_key;
  if (!apiKey) throw new Error("no anthropic_api_key in settings.json");

  for (const lang of langs) {
    await generatePack(apiKey, lang);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
