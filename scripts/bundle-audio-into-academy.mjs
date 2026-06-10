#!/usr/bin/env node
/// Produce a SELF-CONTAINED `.academy` for a course: the normal
/// archive (course.json + cover) PLUS a re-encoded, offline copy of
/// its narration, so a desktop install can play audio with no
/// network.
///
/// ── Why this exists ──────────────────────────────────────────────
/// Audio normally streams from libre.academy/audio/ and is cached in
/// IndexedDB after first play. That's great for web + online desktop,
/// but doesn't cover "downloaded the course on wifi, want narration
/// on a plane". This script bakes the audio into the archive for the
/// desktop bundle. It is DESKTOP-ONLY by construction:
///   - the web extract (extract-starter-courses.mjs) only reads
///     course.json + cover out of the zip, so it ignores `audio/`;
///   - the Discover remote-download archives hosted on mattssoftware
///     stay slim (you upload those separately) — only the copies the
///     desktop installer bundles get the audio.
///
/// ── Source of truth for the MP3s ─────────────────────────────────
/// The live audio manifest at libre.academy/audio/manifest.json (NOT
/// the local dist/audio/, which any `vite build` wipes). We fetch the
/// course's section MP3s straight off the CDN — wherever the audio
/// was last uploaded from, the bundler agrees with what's live.
///
/// ── Size ─────────────────────────────────────────────────────────
/// Narration is 128 kbps CBR MP3 (~150-190 MB/course). We transcode
/// to Opus mono (default 32 kbps) — speech-tuned, ~4x smaller
/// (~35-45 MB/course). Opus-in-Ogg plays in WebView2 (Win) and
/// WebKitGTK (Linux); modern WKWebView (macOS) supports it too. Pass
/// `--codec aac` for a universally-safe AAC/m4a fallback (~2.7x
/// smaller) if a target webview can't decode Opus.
///
/// ── Output ───────────────────────────────────────────────────────
/// Writes to a GITIGNORED build dir (default
/// src-tauri/resources/bundled-packs-full/<id>.academy) so the
/// ~40 MB audio-laden archives never bloat git. The slim archives in
/// bundled-packs/ stay the committed source of truth + feed the web
/// build and the remote download. A release step points the Tauri
/// bundler's `resources` at the -full dir (see PLAN notes).
///
/// In-zip layout added on top of course.json + cover:
///   audio/manifest.json                 — same shape as the runtime
///                                          manifest, but each section
///                                          `url` is a RELATIVE path
///                                          and `format` records the
///                                          codec. `local: true` flags
///                                          it for the runtime overlay.
///   audio/<lessonId>/NN.<sha7>.<ext>     — the transcoded sections.
///
/// USAGE:
///   node scripts/bundle-audio-into-academy.mjs <id> [<id> ...]
///   node scripts/bundle-audio-into-academy.mjs --core   # all narrated core courses
///   node scripts/bundle-audio-into-academy.mjs open-data-structures --codec aac --bitrate 48k
///   node scripts/bundle-audio-into-academy.mjs a-to-zig --out /tmp/out --keep-mp3

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PACKS_DIR = join(ROOT, "src-tauri", "resources", "bundled-packs");
const DEFAULT_OUT = join(ROOT, "src-tauri", "resources", "bundled-packs-full");
const AUDIO_MANIFEST_URL =
  process.env.LIBRE_AUDIO_MANIFEST_URL ??
  "https://libre.academy/audio/manifest.json";

// Narrated courses that ship in the desktop installer (the CORE set).
// Mirrors CORE_PACK_IDS ∩ courses-with-audio; kept short so `--core`
// bundles exactly the offline-relevant set.
const CORE_NARRATED = [
  "a-to-ts",
  "a-to-zig",
  "javascript-typescript",
  "learning-go",
  "the-rust-programming-language",
];

const ARCHIVE_EXTS = ["academy", "libre", "kata"];

// ── arg parsing ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const has = (name) => argv.includes(name);

const CODEC = (flag("--codec") ?? "opus").toLowerCase();
const BITRATE = flag("--bitrate") ?? (CODEC === "aac" ? "48k" : "32k");
const OUT_DIR = flag("--out") ?? DEFAULT_OUT;
const KEEP_MP3 = has("--keep-mp3");
const EXT = CODEC === "aac" ? "m4a" : "opus";

if (CODEC !== "opus" && CODEC !== "aac") {
  console.error(`[bundle-audio] unknown --codec ${CODEC} (use opus|aac)`);
  process.exit(2);
}

// Positional args = course ids. Skip flags and the values that
// follow value-taking flags (--codec/--bitrate/--out).
const VALUE_FLAGS = new Set(["--codec", "--bitrate", "--out"]);
let ids = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    if (VALUE_FLAGS.has(a)) i++; // skip its value
    continue;
  }
  ids.push(a);
}
if (has("--core")) ids = [...new Set([...CORE_NARRATED, ...ids])];
if (ids.length === 0) {
  console.error(
    "[bundle-audio] no course ids. Pass ids, or --core for the narrated core set.",
  );
  process.exit(2);
}

// ── tool checks ──────────────────────────────────────────────────
function have(cmd, versionArg = "-version") {
  try {
    execFileSync(cmd, [versionArg], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
if (!have("ffmpeg")) {
  console.error("[bundle-audio] ffmpeg not found — needed to transcode. `brew install ffmpeg`.");
  process.exit(2);
}
if (!have("zip", "--version")) {
  console.error("[bundle-audio] `zip` not found.");
  process.exit(2);
}

function findSlimArchive(id) {
  for (const ext of ARCHIVE_EXTS) {
    const p = join(PACKS_DIR, `${id}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function downloadTo(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}

function sha7(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 7);
}

function transcode(srcMp3, dstPath) {
  // -vn: no video. -ac 1: mono (speech). Opus: libopus VBR; AAC:
  // native encoder. -map_metadata -1 strips tags so files are
  // deterministic-ish and lean.
  const common = ["-y", "-loglevel", "error", "-i", srcMp3, "-vn", "-ac", "1", "-map_metadata", "-1"];
  const codecArgs =
    CODEC === "aac"
      ? ["-c:a", "aac", "-b:a", BITRATE, "-movflags", "+faststart"]
      : ["-c:a", "libopus", "-b:a", BITRATE, "-application", "audio"];
  execFileSync("ffmpeg", [...common, ...codecArgs, dstPath], { stdio: "pipe" });
}

async function bundleCourse(id) {
  const slim = findSlimArchive(id);
  if (!slim) {
    console.error(`[bundle-audio] ${id}: no slim archive in bundled-packs/ — skip`);
    return null;
  }

  console.error(`\n[bundle-audio] ${id}: codec=${CODEC} bitrate=${BITRATE}`);
  const liveManifest = await fetchJson(AUDIO_MANIFEST_URL);
  const cdnBase = (liveManifest.cdnBase || "https://libre.academy/audio").replace(/\/+$/, "");
  // Pull this course's composite entries.
  const entries = Object.entries(liveManifest.lessons || {}).filter(
    ([k, v]) => k.startsWith(`${id}/`) && v && Array.isArray(v.sections),
  );
  if (entries.length === 0) {
    console.error(`[bundle-audio] ${id}: no narrated lessons in the live manifest — skip`);
    return null;
  }

  const work = mkdtempSync(join(tmpdir(), `fb-bundle-${id}-`));
  try {
    // 1. Unzip the slim archive (course.json + cover) into work/.
    execFileSync("unzip", ["-q", slim, "-d", work], { stdio: "pipe" });

    // 2. For each lesson/section, download the CDN MP3 and transcode
    //    into work/audio/<lessonId>/NN.<sha7>.<ext>. Rebuild the
    //    in-zip manifest with relative urls.
    const localLessons = {};
    let srcBytes = 0;
    let outBytes = 0;
    let nSections = 0;
    for (const [key, entry] of entries) {
      const lessonId = key.slice(id.length + 1);
      const outSections = [];
      for (let i = 0; i < entry.sections.length; i++) {
        const sec = entry.sections[i];
        // Resolve the absolute CDN url for this section.
        const url = sec.url.startsWith("http")
          ? sec.url
          : `${cdnBase}/${sec.url.replace(/^\/+/, "")}`;
        const seq = String(i + 1).padStart(2, "0");
        const mp3Tmp = join(work, `_dl.mp3`);
        srcBytes += await downloadTo(url, mp3Tmp);

        const lessonDir = join(work, "audio", lessonId);
        mkdirSync(lessonDir, { recursive: true });
        // Transcode, then content-hash the OUTPUT for the filename so
        // a re-bundle with the same bytes is stable.
        const dstTmp = join(lessonDir, `_${seq}.${EXT}`);
        transcode(mp3Tmp, dstTmp);
        const outBuf = readFileSync(dstTmp);
        const h = sha7(outBuf);
        const fileRel = `audio/${lessonId}/${seq}.${h}.${EXT}`;
        const fileAbs = join(work, fileRel);
        writeFileSync(fileAbs, outBuf);
        rmSync(dstTmp, { force: true });
        outBytes += outBuf.length;
        nSections++;

        outSections.push({
          // Relative path inside the extracted course dir — the
          // runtime overlay resolves this against the course folder.
          url: fileRel,
          format: CODEC === "aac" ? "aac" : "opus",
          sizeBytes: outBuf.length,
          durationSec: sec.durationSec, // unchanged by transcode
          textHash: sec.textHash,
          voice: sec.voice,
          voiceId: sec.voiceId,
          model: sec.model,
          blockStart: sec.blockStart,
          blockEnd: sec.blockEnd,
          headingText: sec.headingText,
          headingLevel: sec.headingLevel,
        });
      }
      localLessons[key] = {
        courseId: id,
        voice: entry.voice,
        model: entry.model,
        local: true,
        sections: outSections,
      };
      process.stderr.write(`  ${lessonId}: ${entry.sections.length} sections\r`);
    }
    rmSync(join(work, "_dl.mp3"), { force: true });

    // 3. Write the in-zip audio manifest.
    const audioManifest = {
      version: 2,
      local: true,
      codec: CODEC,
      bitrate: BITRATE,
      voice: liveManifest.voice,
      model: liveManifest.model,
      generatedFrom: AUDIO_MANIFEST_URL,
      lessons: localLessons,
    };
    writeFileSync(
      join(work, "audio", "manifest.json"),
      JSON.stringify(audioManifest, null, 2),
    );

    // 4. Repack everything in work/ into the output archive.
    mkdirSync(OUT_DIR, { recursive: true });
    const outPath = join(OUT_DIR, `${id}.academy`);
    rmSync(outPath, { force: true });
    // zip from inside work/ so paths are archive-root-relative.
    execFileSync("zip", ["-q", "-r", "-X", outPath, "course.json", "cover.jpg", "cover.png", "audio"], {
      cwd: work,
      stdio: "pipe",
    }).toString?.();

    const slimSize = statSync(slim).size;
    const fullSize = statSync(outPath).size;
    console.error(
      `\n[bundle-audio] ✓ ${id}: ${nSections} sections, ` +
        `${(srcBytes / 1e6).toFixed(0)}MB MP3 → ${(outBytes / 1e6).toFixed(0)}MB ${CODEC} ` +
        `(${(srcBytes / outBytes).toFixed(1)}× smaller). ` +
        `archive ${(slimSize / 1e3).toFixed(0)}KB → ${(fullSize / 1e6).toFixed(1)}MB → ${outPath}`,
    );
    return { id, outPath, slimSize, fullSize, srcBytes, outBytes, nSections };
  } finally {
    if (!KEEP_MP3) rmSync(work, { recursive: true, force: true });
    else console.error(`[bundle-audio] kept work dir: ${work}`);
  }
}

const results = [];
for (const id of ids) {
  try {
    const r = await bundleCourse(id);
    if (r) results.push(r);
  } catch (e) {
    console.error(`[bundle-audio] ${id}: FAILED — ${e instanceof Error ? e.message : e}`);
  }
}

if (results.length) {
  const total = results.reduce((a, r) => a + r.fullSize, 0);
  console.error(
    `\n[bundle-audio] done: ${results.length} archive(s), ` +
      `${(total / 1e6).toFixed(0)}MB total → ${OUT_DIR}`,
  );
  console.error(
    "[bundle-audio] NOTE: these are gitignored. Point the Tauri bundler's `resources` at\n" +
      "  bundled-packs-full/ for a release build to ship them in the installer.",
  );
}
