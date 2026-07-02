#!/usr/bin/env node
/// One-off: translate the `installLanguages.*` UI namespace from en.json
/// into the shipped locales (one API call per locale). Idempotent — skips a
/// locale that already has the key. Mirrors translate-collections.mjs.
///   node --env-file=.env scripts/translate-install-langs.mjs
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "src/i18n/locales";
const MODEL = "claude-sonnet-5";
const KEY = process.env.ANTHROPIC_API_KEY;
const LANGS = { hi: "Hindi", es: "Spanish", kr: "Korean", jp: "Japanese" };

const EN = JSON.parse(readFileSync(`${DIR}/en.json`, "utf8")).installLanguages;

function blockFor(map) {
  const rows = Object.entries(map).map(
    ([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
  );
  return `  "installLanguages": {\n${rows.join(",\n")}\n  },`;
}

function insert(loc, map) {
  const path = `${DIR}/${loc}.json`;
  const raw = readFileSync(path, "utf8");
  if (JSON.parse(raw).installLanguages) {
    console.log(`${loc}: skip (already present)`);
    return;
  }
  const lines = raw.split("\n");
  lines.splice(1, 0, blockFor(map));
  const out = lines.join("\n");
  JSON.parse(out);
  writeFileSync(path, out);
  console.log(`${loc}: ✓ inserted`);
}

async function translate(lang) {
  const system = `Translate the string VALUES of this JSON into ${lang}.
Rules:
- Return ONLY valid JSON, same keys + structure, no prose/code fences.
- Keep the literal placeholder {title} EXACTLY as-is (do not translate or move it).
- Keep the product name "Libre" and the language name "English" natural for ${lang}.
- Keep it concise and natural for a UI dialog.`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: [{ role: "user", content: JSON.stringify(EN, null, 2) }] }),
    });
    if (resp.status === 429 || resp.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); continue; }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const json = await resp.json();
    const text = (json.content || []).find((b) => b.type === "text")?.text ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON in response");
    return JSON.parse(m[0]);
  }
  throw new Error("translate failed");
}

if (!KEY) { console.error("ANTHROPIC_API_KEY not set"); process.exit(1); }
for (const [loc, lang] of Object.entries(LANGS)) {
  try {
    const map = await translate(lang);
    if (!Object.keys(EN).every((k) => typeof map[k] === "string")) throw new Error("missing keys");
    if (!/\{title\}/.test(map.description)) throw new Error("{title} placeholder lost");
    insert(loc, map);
  } catch (e) {
    console.error(`${loc}: FAIL ${e.message} (falls back to English)`);
  }
}
