/// Chat-grade markdown rendering for AI assistant messages.
///
/// Deliberately SEPARATE from the lesson renderer (`Lesson/markdown.ts`):
/// that one is tuned for trusted course prose and emits lesson-only
/// chrome — inline-sandbox hydration markers, device-action blocks,
/// section-heading slugs, figure captions, glossary/symbol popovers,
/// and a per-block "ask Libre" badge. None of that belongs in a chat
/// bubble; some of it (the inline-sandbox `<div>`) renders as an
/// EMPTY box when there's no LessonReader to hydrate it. So chat gets
/// its own lean pipeline here.
///
/// What this DOES do: CommonMark + GFM tables/lists, autolinked URLs,
/// `libre://` deep links (the panel intercepts clicks), and fenced
/// code blocks highlighted with the SAME shared Shiki helper the
/// lesson reader uses (`lib/highlightCode`) — wrapped in a compact
/// code shell with a language label, a copy button, and a
/// collapse-when-long affordance.
///
/// Two-pass like the lesson renderer (Shiki is async; markdown-it's
/// `highlight` hook is sync): pass 1 emits a placeholder per fence,
/// pass 2 swaps in the highlighted HTML.

import MarkdownIt from "markdown-it";
import { highlightCode } from "@/lib/highlightCode";
import type { TFunction } from "@/i18n/i18n";

/// Collapse code blocks taller than this into a <details> so a long
/// answer stays scannable (the "show code" dropdown).
const COLLAPSE_CODE_AFTER_LINES = 12;

export interface ChatRenderOptions {
  /// The message is still streaming. Enables removal of UNTERMINATED
  /// trailing control tags (a half-typed `<confidence` / `<tool_call`)
  /// — which would otherwise flash on screen. On a COMPLETED message
  /// we never do the trailing strip, so a stray `<tool>` mention in
  /// prose can't eat the rest of the text.
  streaming?: boolean;
  /// The bubble lives in the AGENT panel, where ```lang:path fenced
  /// blocks ARE file writes (shown as FileWriteChip pills). Only then
  /// do we collapse them to a marker. In CHAT mode a `lang:path`
  /// fence is a normal code block to render.
  agentMode?: boolean;
  /// Localizes the chrome injected into the rendered HTML (the code
  /// shell's copy button). Plain module — no hooks here — so the
  /// consuming component passes its `useT()` result in; when absent
  /// the English fallbacks keep older call sites working.
  t?: TFunction;
}

const md = new MarkdownIt({
  html: false, // model output is untrusted-ish — never inject raw HTML
  linkify: true,
  typographer: false,
  breaks: false, // GFM: blank line for a hard break (don't mangle code)
});

// Permit `libre://` deep links through markdown-it's link validator
// (it blocks unknown schemes by default). The panel's click handler
// turns these into in-app navigation; rendered inert they're harmless.
const defaultValidateLink = md.validateLink.bind(md);
md.validateLink = (url: string): boolean => {
  if (/^libre:\/\//i.test(url.trim())) return true;
  return defaultValidateLink(url);
};

// Fence → pending placeholder (base64 source + lang + optional
// filename). Pass 2 finds these and replaces them with the
// highlighted code shell. The info string may be `lang` or
// `lang:path/to/file` (the latter only reaches here in CHAT mode —
// agent-mode path fences are collapsed away before rendering).
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const first = (token.info || "").trim().split(/\s+/)[0] || "";
  const colon = first.indexOf(":");
  const lang = (colon >= 0 ? first.slice(0, colon) : first) || "text";
  const filename = colon >= 0 ? first.slice(colon + 1) : "";
  const b64 = encodeB64(token.content ?? "");
  return `<pre class="libre-chat-code-pending" data-lang="${escapeAttr(lang)}" data-file="${escapeAttr(filename)}" data-src="${b64}"></pre>`;
};

/// Render assistant message markdown to HTML. Always sanitize the
/// source first (strip confidence tags + tool-call envelopes; in
/// agent mode also collapse path-tagged file fences).
export async function renderChatMarkdown(
  source: string,
  opts: ChatRenderOptions = {},
): Promise<string> {
  const cleaned = sanitizeAssistantText(source ?? "", opts);
  if (!cleaned) return "";
  const html = md.render(closeDanglingFence(cleaned));
  return replaceChatCodePlaceholders(html, opts.t);
}

/// Strip the control plumbing models emit inline so it never reaches
/// the rendered bubble.
///
/// CLOSED tags (a complete `<confidence>…</confidence>` /
/// `<tool_call>…</tool_call>`) are always removed. UNTERMINATED
/// trailing tags are removed ONLY while `streaming` — on a finished
/// message a bare `<tool>`/`<confidence` substring in prose must not
/// swallow the rest of the text. Path-tagged file fences are
/// collapsed ONLY in `agentMode` (where the file-write pills exist).
/// Pure + synchronous so it can run on every streamed chunk.
export function sanitizeAssistantText(
  raw: string,
  opts: ChatRenderOptions = {},
): string {
  let s = raw ?? "";

  // 1. Confidence tags (the agent appends `<confidence>0.8</confidence>`).
  s = s.replace(/<confidence\b[^>]*>[\s\S]*?<\/confidence>/gi, "");

  // 2. Tool-call envelopes (emulated models emit these as text).
  s = s.replace(
    /<(tool[_-]?calls?|tools?|function[_-]?call)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );

  // 3. UNTERMINATED trailing control tags — mid-stream only. Requires
  // a genuine tag-open (`<name …>` with no matching close left) so a
  // completed `<tool>` mention in prose isn't eaten.
  if (opts.streaming) {
    s = s.replace(/<confidence\b[^>]*>[\s\S]*$/i, "");
    s = s.replace(
      /<(?:tool[_-]?calls?|tools?|function[_-]?call)\b[^>]*>[\s\S]*$/i,
      "",
    );
    // Also drop a tag that's still being typed (no closing `>` yet).
    s = s.replace(/<(?:confidence|tool[_-]?calls?|tools?|function[_-]?call)\b[^>]*$/i, "");
  }

  // 4. Path-tagged file fences (```lang:src/App.jsx) — agent mode only.
  // In agent mode these ARE the file writes (the FileWriteChip pills
  // show them), so dumping the raw code in the bubble too is noise.
  if (opts.agentMode) {
    //   closed fence:
    s = s.replace(
      /```[\w+#.-]*:([^\n`]+)\n[\s\S]*?\n```/g,
      (_m, path) => `\n\`▟ ${path.trim()}\`\n`,
    );
    //   open fence still streaming (no closer yet):
    s = s.replace(
      /```[\w+#.-]*:([^\n`]+)\n[\s\S]*$/,
      (_m, path) => `\n\`▟ writing ${path.trim()}…\`\n`,
    );
  }

  return s.trim();
}

/// If the (sanitized) text ends inside an unterminated ``` BLOCK
/// fence, append a closer so markdown-it parses the trailing partial
/// block as code instead of choking. Counts only fence markers that
/// start a line (markdown-it's block-fence rule), so a ``` inside
/// inline code / prose doesn't trip a false "open fence".
function closeDanglingFence(text: string): string {
  let open = 0;
  for (const line of text.split("\n")) {
    if (/^\s{0,3}`{3,}/.test(line)) open ^= 1; // toggle on each block fence
  }
  return open === 1 ? `${text}\n\`\`\`` : text;
}

async function replaceChatCodePlaceholders(
  html: string,
  t?: TFunction,
): Promise<string> {
  const placeholderRe =
    /<pre class="libre-chat-code-pending" data-lang="([^"]*)" data-file="([^"]*)" data-src="([^"]*)"><\/pre>/g;
  // Interleave literal chunks with built shells directly (no
  // string-sentinel round-trip — that could collide with source text).
  const parts: Array<string | Promise<string>> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = placeholderRe.exec(html)) !== null) {
    parts.push(html.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    const lang = decodeAttr(match[1]);
    const filename = decodeAttr(match[2]);
    parts.push(
      buildCodeShell(decodeB64(match[3]), lang, filename, match[3], t),
    );
  }
  parts.push(html.slice(lastIndex));
  const resolved = await Promise.all(parts);
  return resolved.join("");
}

/// Build one code block: a head (language/filename label + copy
/// button) and a Shiki-highlighted body, wrapped in <details> when
/// long enough to warrant collapsing. `srcB64` is the already-encoded
/// source for the copy button (decoded by the panel's click handler).
async function buildCodeShell(
  code: string,
  lang: string,
  filename: string,
  srcB64: string,
  t?: TFunction,
): Promise<string> {
  const highlighted = await highlightCode(code, lang);
  const body =
    highlighted ||
    `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
  const lineCount = code.replace(/\n+$/, "").split("\n").length;
  const label = escapeHtml(filename || (lang === "text" ? "code" : lang));
  // Shared with TipDropdown's copy affordance: common.copy /
  // common.copied / common.copyCode. `data-copied` carries the
  // localized post-click label for the delegated click handler
  // (useBubbleInteractions) to swap in.
  const copyLabel = t ? t("common.copy") : "Copy";
  const copiedLabel = t ? t("common.copied") : "Copied";
  const copyAria = t ? t("common.copyCode") : "Copy code";
  const copyBtn = `<button type="button" class="libre-chat-code-copy" data-copy="${srcB64}" data-copied="${escapeAttr(copiedLabel)}" aria-label="${escapeAttr(copyAria)}">${escapeHtml(copyLabel)}</button>`;

  if (lineCount > COLLAPSE_CODE_AFTER_LINES) {
    return [
      `<details class="libre-chat-code libre-chat-code--long">`,
      `<summary class="libre-chat-code-head">`,
      `<span class="libre-chat-code-lang">${label} · ${lineCount} lines</span>`,
      copyBtn,
      `</summary>`,
      `<div class="libre-chat-code-body">${body}</div>`,
      `</details>`,
    ].join("");
  }
  return [
    `<div class="libre-chat-code">`,
    `<div class="libre-chat-code-head">`,
    `<span class="libre-chat-code-lang">${label}</span>`,
    copyBtn,
    `</div>`,
    `<div class="libre-chat-code-body">${body}</div>`,
    `</div>`,
  ].join("");
}

// ── tiny helpers (self-contained; no lesson-renderer coupling) ──

function encodeB64(raw: string): string {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(raw)));
  }
  return Buffer.from(raw, "utf-8").toString("base64");
}

export function decodeB64(b64: string): string {
  try {
    if (typeof atob === "function") {
      return decodeURIComponent(escape(atob(b64)));
    }
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function decodeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
