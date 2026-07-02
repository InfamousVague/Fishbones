#!/usr/bin/env node
/// One-off: fill the `collections.<id>.{title,blurb}` i18n namespace.
/// Writes the English source into en.json and LLM-translates it into the
/// target locales (one API call per locale — the whole namespace as JSON).
/// Idempotent: skips any locale file that already has a `collections` key.
///
///   ANTHROPIC_API_KEY=... node scripts/translate-collections.mjs
///   (or: node --env-file=.env scripts/translate-collections.mjs)
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "src/i18n/locales";
const MODEL = "claude-sonnet-5";
const KEY = process.env.ANTHROPIC_API_KEY;

// English source — mirrors COLLECTIONS in
// src/components/templates/Library/collections.ts (title + blurb only).
const EN = {
  rust: { title: "Rust", blurb: "Everything Rust — the books, the Exercism track, Rustlings, and the challenge pack." },
  python: { title: "Python", blurb: "Everything Python — the in-house books, the Exercism track, the koans, and the challenge pack." },
  go: { title: "Go", blurb: "Everything Go — the book, the Exercism track, Golings, and the challenge pack." },
  zig: { title: "Zig", blurb: "Everything Zig — the book, the Exercism track, Ziglings, and the challenge pack." },
  web: { title: "Web", blurb: "The front-end stack — JavaScript & TypeScript fundamentals, the frameworks, and the drills." },
  mobile: { title: "Mobile", blurb: "Build for phones — React Native, Swift, and Dart, with their tracks and challenge packs." },
  jvm: { title: "JVM", blurb: "The JVM family — Java, Kotlin, and Scala tracks, koans, and challenge packs." },
  functional: { title: "Functional", blurb: "Think in functions — Haskell, Elixir, Scala, Clojure, and F#, plus functional JavaScript." },
  systems: { title: "Systems", blurb: "Close to the metal — C, C++, and ARM assembly, with their tracks and drills." },
  algorithms: { title: "Algorithms & CS", blurb: "Computer-science foundations — algorithms, data structures, interpreters, and crypto theory." },
};

const LANGS = { hi: "Hindi", es: "Spanish", kr: "Korean", jp: "Japanese" };

function blockFor(map) {
  const rows = Object.entries(map).map(
    ([id, v]) =>
      `    ${JSON.stringify(id)}: { "title": ${JSON.stringify(v.title)}, "blurb": ${JSON.stringify(v.blurb)} }`,
  );
  return `  "collections": {\n${rows.join(",\n")}\n  },`;
}

function insert(loc, map) {
  const path = `${DIR}/${loc}.json`;
  const raw = readFileSync(path, "utf8");
  if (JSON.parse(raw).collections) {
    console.log(`${loc}: skip (already present)`);
    return;
  }
  const lines = raw.split("\n"); // line 0 is "{"
  lines.splice(1, 0, blockFor(map));
  const out = lines.join("\n");
  JSON.parse(out); // validate before writing
  writeFileSync(path, out);
  console.log(`${loc}: ✓ inserted`);
}

async function translate(lang) {
  const system = `You are a UI-string localizer. Translate the string VALUES of the given JSON into ${lang}.
Rules:
- Return ONLY valid JSON with the exact same keys and structure. No prose, no code fences.
- Keep programming-language names, product/tool names, and technical identifiers in their original form: Rust, Go, Python, Zig, JVM, Java, Kotlin, Scala, Haskell, Elixir, Clojure, F#, C, C++, ARM, JavaScript, TypeScript, React Native, Swift, Dart, Web, Exercism, Rustlings, Golings, Ziglings, koans.
- Translate ordinary words (e.g. "Everything", "the book", "the challenge pack", "Mobile", "Functional", "Systems", "Computer-science foundations").
- Keep it concise and natural.`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, messages: [{ role: "user", content: JSON.stringify(EN, null, 2) }] }),
    });
    if (resp.status === 429 || resp.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const json = await resp.json();
    const text = (json.content || []).find((b) => b.type === "text")?.text ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON in response");
    return JSON.parse(m[0]);
  }
  throw new Error("translate failed after retries");
}

// 1) English source into en.json (deterministic).
insert("en", EN);

// 2) Translate into each target locale (one call each).
if (!KEY) {
  console.error("ANTHROPIC_API_KEY not set — wrote en.json only; skipped translations.");
  process.exit(1);
}
for (const [loc, lang] of Object.entries(LANGS)) {
  try {
    const map = await translate(lang);
    // guard: same keys as EN
    const ok = Object.keys(EN).every((k) => map[k]?.title && map[k]?.blurb);
    if (!ok) throw new Error("translated map missing keys");
    insert(loc, map);
  } catch (e) {
    console.error(`${loc}: FAIL ${e.message} (left to fall back to English)`);
  }
}
