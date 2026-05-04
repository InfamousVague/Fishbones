#!/usr/bin/env node
/// Download the pinned `soljson` build (the official Solidity compiler
/// compiled to asm.js / WASM) into the shipped vendor directory so
/// the desktop and web builds can run Solidity lessons fully offline.
///
/// Why this exists: until v0.1.16 the runtime fetched soljson from
/// `https://binaries.soliditylang.org/...` on first compile. That
/// works on a permissive network but blew up on:
///   - Strict / corporate firewalls (the host file is a 14MB JS blob
///     with WASM inside; some filtering proxies refuse the download).
///   - The Tauri production CSP — `script-src 'self' 'wasm-unsafe-eval'`
///     blocks any cross-origin <script src=...> fetch, including
///     `binaries.soliditylang.org`. The error surfaced as
///     "Couldn't load Solidity compiler" with no path forward for the
///     learner since the network wasn't actually broken — the CSP was.
///
/// Now: `npm run vendor` (or `npm run vendor:soljson`) downloads the
/// pinned version into `src-tauri/resources/vendor/soljson-<ver>.js`.
/// `copy-vendor-to-public.mjs` mirrors it into `public/vendor/` for
/// the web build. The Solidity runtime loads same-origin from there;
/// no CDN involvement, no CSP relaxation needed.
///
/// Idempotent: if the file already exists with the right size we skip
/// the download. Bump SOLC_VERSION below to roll the compiler.

import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "src-tauri", "resources", "vendor");

/// Keep this in lockstep with `SOLC_VERSION` in
/// `src/runtimes/solidity.ts`. The runtime's `loadSolc()` builds the
/// `soljson-<SOLC_VERSION>.js` filename from that constant, then
/// resolves it against `${BASE_URL}vendor/`.
const SOLC_VERSION = "v0.8.26+commit.8a97fa7a";
const SOURCE_URL = `https://binaries.soliditylang.org/bin/soljson-${SOLC_VERSION}.js`;
const OUT_FILE = join(OUT_DIR, `soljson-${SOLC_VERSION}.js`);

/// soljson is a chunky binary asset — measured at ~14MB unmin'd.
/// Anything under a few MB is almost certainly a captive-portal HTML
/// stub or a CDN error page; we treat that as a download failure.
const MIN_BYTES = 5 * 1024 * 1024;

async function downloadIfMissing() {
  await mkdir(OUT_DIR, { recursive: true });
  if (existsSync(OUT_FILE)) {
    const info = await stat(OUT_FILE);
    if (info.size >= MIN_BYTES) {
      console.log(
        `[vendor-soljson] already present: ${OUT_FILE} (${(info.size / 1024 / 1024).toFixed(1)} MB)`,
      );
      return;
    }
    console.log(
      `[vendor-soljson] existing file is suspiciously small (${info.size} B); re-downloading`,
    );
  }

  console.log(`[vendor-soljson] downloading ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${SOURCE_URL}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < MIN_BYTES) {
    throw new Error(
      `Downloaded file is only ${buf.byteLength} bytes — looks like a captive-portal HTML page, not soljson.`,
    );
  }
  await writeFile(OUT_FILE, buf);
  console.log(
    `[vendor-soljson] wrote ${OUT_FILE} (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`,
  );
}

downloadIfMissing().catch((err) => {
  console.error("[vendor-soljson] failed:", err);
  process.exit(1);
});
