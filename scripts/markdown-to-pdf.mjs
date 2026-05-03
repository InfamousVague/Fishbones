#!/usr/bin/env node
/**
 * markdown-to-pdf.mjs
 *
 * Tiny utility: renders a Markdown file → PDF via markdown-it (already in
 * the project tree) + headless Chrome. Writes a sibling `.pdf` next to
 * the input by default, or to `--out <path>` if supplied.
 *
 * Usage:
 *   node scripts/markdown-to-pdf.mjs docs/openbook-ingest-tracker.md
 *   node scripts/markdown-to-pdf.mjs docs/foo.md --out /tmp/foo.pdf
 *
 * No new deps — uses the headless Chrome already on the developer's
 * machine. If we ever need to ship this to CI we'd swap in a vendored
 * Chrome (e.g. via puppeteer), but for hand-runs this is the cheapest
 * path.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(path.dirname(__filename));

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith("--")) {
  console.error("usage: markdown-to-pdf.mjs <input.md> [--out <output.pdf>]");
  process.exit(1);
}

const inputArg = args[0];
const outIdx = args.indexOf("--out");
const inputPath = path.isAbsolute(inputArg)
  ? inputArg
  : path.resolve(process.cwd(), inputArg);
const outputPath =
  outIdx >= 0
    ? path.resolve(process.cwd(), args[outIdx + 1])
    : inputPath.replace(/\.md$/i, ".pdf");

const mdSource = readFileSync(inputPath, "utf8");
const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
const bodyHtml = md.render(mdSource);

// Print stylesheet — kept minimal so the PDF looks like a clean
// technical doc, not a Medium article. The cover-art doc reuses this
// same stylesheet so internal docs stay visually consistent.
const css = `
  @page { size: Letter; margin: 0.75in 0.7in; }
  html { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1f1d1a; }
  body { margin: 0; line-height: 1.5; font-size: 11pt; }
  h1 { font-size: 22pt; margin: 0 0 0.4em; border-bottom: 2px solid #2b2420; padding-bottom: 0.15em; }
  h2 { font-size: 15pt; margin-top: 1.4em; border-bottom: 1px solid #c4b594; padding-bottom: 0.1em; }
  h3 { font-size: 12pt; margin-top: 1em; color: #4a3c2c; }
  h4 { font-size: 11pt; margin-top: 0.9em; color: #4a3c2c; }
  p, li { font-size: 10.5pt; }
  em { color: #5a4c3a; }
  hr { border: none; border-top: 1px solid #d6c9aa; margin: 1.4em 0; }
  table { border-collapse: collapse; width: 100%; margin: 0.6em 0; font-size: 9.5pt; }
  th, td { border: 1px solid #c4b594; padding: 4px 8px; vertical-align: top; }
  th { background: #f4ecd9; text-align: left; }
  code { background: #f4ecd9; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5pt; }
  pre { background: #f4ecd9; padding: 8px 12px; border-radius: 4px; overflow-x: auto; }
  pre code { background: transparent; padding: 0; }
  blockquote { border-left: 3px solid #c4b594; margin: 0.6em 0; padding: 0.2em 0.9em; color: #4a3c2c; background: #f9f4e6; }
  a { color: #2b4a8c; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

const fullHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${path.basename(inputPath)}</title>
  <style>${css}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

const tmp = mkdtempSync(path.join(tmpdir(), "md2pdf-"));
const tmpHtml = path.join(tmp, "render.html");
writeFileSync(tmpHtml, fullHtml, "utf8");

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

try {
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${outputPath}`,
      "--no-sandbox",
      "--virtual-time-budget=2000",
      `file://${tmpHtml}`,
    ],
    { stdio: "inherit" },
  );
  console.log(`✓ wrote ${path.relative(projectRoot, outputPath)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
