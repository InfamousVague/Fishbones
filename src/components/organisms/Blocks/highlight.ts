/// Shiki-backed highlighter for the BlocksView. Two surfaces use it:
///
///   1. The template — the read-only code with `__SLOT_<id>__`
///      markers punched out where blocks go. We tokenise the FULL
///      template (markers replaced by sentinel identifiers) so
///      Shiki sees one cohesive expression and gives us correct
///      cross-token highlighting (operators, keywords, function
///      calls all coloured the way they would be in the canonical
///      solution). We then post-process the token stream — sentinel
///      tokens become slot placeholders the renderer swaps for
///      `<SlotZone>` React components, regular tokens stay as
///      coloured spans.
///
///   2. Each block chip — small, self-contained code fragments
///      ("c", "9.0", "32.0"). We highlight each one independently
///      with the same theme + grammar so a placed chip reads as
///      continuous code with the surrounding template.
///
/// Why not `dangerouslySetInnerHTML` + DOM manipulation (the
/// `MobileMicroPuzzle` approach): blocks mode has interactive drop
/// zones inside the highlighted output, with React-managed drag +
/// keyboard + tap state. Token-level rendering keeps everything in
/// React's tree without an imperative-DOM second pass.

import { codeToTokens, type BundledLanguage, type ThemedToken } from "shiki";
import type { LanguageId } from "@/data/types";

/// Theme used everywhere in the app's reading + workbench surfaces.
/// Keep in lockstep with `markdown.ts`'s `SHIKI_THEME` so a chunk of
/// code rendered inside the lesson body and a chunk rendered inside
/// a BlocksView chip use the same colour palette.
const SHIKI_THEME = "github-dark";

/// Map our LanguageId taxonomy to Shiki's. Mirrors `markdown.ts`'s
/// own mapping — kept here as a copy so this module can stand alone
/// (importing from a `.ts` file inside `components/Lesson` would
/// pull markdown-it + the rest of the markdown pipeline into the
/// blocks chunk for no reason).
function shikiLang(lang: string): string {
  switch (lang.toLowerCase()) {
    case "reactnative":
      return "tsx";
    case "threejs":
      return "javascript";
    case "vyper":
      return "python";
    case "bun":
      return "typescript";
    case "assembly":
      return "asm";
    case "sway":
      return "rust";
    case "move":
    case "cairo":
      // Move + Cairo don't have Shiki grammars yet — fall back to a
      // close cousin so we still get keyword/identifier colouring.
      return "rust";
    default:
      return lang;
  }
}

/// One token in the rendered template stream. Either a chunk of
/// highlighted text (rendered as a coloured span) or a slot marker
/// (rendered as a `<SlotZone>` drop target).
export type RenderedToken =
  | {
      kind: "text";
      content: string;
      color?: string;
      fontStyle?: number;
    }
  | { kind: "slot"; slotId: string };

/// One line in the rendered template — an array of tokens. We
/// preserve line boundaries so the renderer can emit them as block
/// elements (`<div>` per line) and keep the visual layout matching
/// what a learner would see in their editor.
export type RenderedLine = RenderedToken[];

/// Tokenise `template` (which may contain `__SLOT_<id>__` markers)
/// into a 2D structure of lines × tokens, ready for React rendering.
/// Slot markers come back as `{ kind: "slot" }` tokens; everything
/// else is `{ kind: "text" }` with Shiki's colour.
///
/// We replace each marker with a sentinel identifier *before*
/// running Shiki so the highlighter sees a syntactically valid
/// program — `__fbs0__` and friends are valid identifiers in every
/// language we ship grammars for, and Shiki tokenises them as
/// single identifier tokens (not split across multiple). The slot
/// id is recovered after tokenisation by mapping the sentinel back
/// to its original id.
export async function highlightTemplate(
  template: string,
  language: LanguageId,
): Promise<RenderedLine[]> {
  // Generate sentinels like `__fbs0__`, `__fbs1__`, … (lowercase
  // identifier-shaped) and remember which one belongs to which
  // slot id. Using the index keeps the sentinel short, and the
  // `__fbs` prefix is unlikely to collide with anything in real
  // course content.
  const slotMap = new Map<string, string>();
  let counter = 0;
  const prepared = template.replace(
    /__SLOT_([A-Za-z0-9_-]+)__/g,
    (_match, slotId: string) => {
      const sentinel = `__fbs${counter++}__`;
      slotMap.set(sentinel, slotId);
      return sentinel;
    },
  );

  let tokenized: ThemedToken[][];
  try {
    const result = await codeToTokens(prepared, {
      lang: shikiLang(language) as BundledLanguage,
      theme: SHIKI_THEME,
    });
    tokenized = result.tokens;
  } catch {
    // Highlighting failure (unsupported language, grammar load
    // error, …) — fall back to one giant text token per line so
    // the puzzle is still playable, just without colour. The
    // sentinels still need to be located so slot zones render in
    // the right places.
    tokenized = template.split("\n").map((line) => [
      { content: line, color: undefined } as ThemedToken,
    ]);
  }

  // Walk the tokenised output and lift sentinels into slot tokens.
  // A sentinel can land mid-token if Shiki splits an identifier
  // (it shouldn't with our chosen pattern, but defence in depth)
  // — we handle that by string-splitting tokens whose `content`
  // contains a sentinel.
  return tokenized.map((line) => {
    const out: RenderedToken[] = [];
    for (const tok of line) {
      const content = tok.content ?? "";
      // Fast path — token contains no sentinel.
      let hasSentinel = false;
      for (const sentinel of slotMap.keys()) {
        if (content.includes(sentinel)) {
          hasSentinel = true;
          break;
        }
      }
      if (!hasSentinel) {
        out.push({
          kind: "text",
          content,
          color: tok.color,
          fontStyle: tok.fontStyle,
        });
        continue;
      }
      // Slow path — split the token at sentinel boundaries.
      let rest = content;
      while (rest.length > 0) {
        let nextSentinel: string | null = null;
        let nextIdx = -1;
        for (const sentinel of slotMap.keys()) {
          const idx = rest.indexOf(sentinel);
          if (idx >= 0 && (nextIdx < 0 || idx < nextIdx)) {
            nextIdx = idx;
            nextSentinel = sentinel;
          }
        }
        if (nextSentinel === null || nextIdx < 0) {
          out.push({
            kind: "text",
            content: rest,
            color: tok.color,
            fontStyle: tok.fontStyle,
          });
          break;
        }
        if (nextIdx > 0) {
          out.push({
            kind: "text",
            content: rest.slice(0, nextIdx),
            color: tok.color,
            fontStyle: tok.fontStyle,
          });
        }
        out.push({ kind: "slot", slotId: slotMap.get(nextSentinel)! });
        rest = rest.slice(nextIdx + nextSentinel.length);
      }
    }
    return out;
  });
}

/// Highlight a single block's code fragment for chip display. Each
/// block is small (one identifier or literal usually), so we
/// tokenise + flatten into a single line of coloured spans. The
/// caller renders each span inside the chip's `<code>` element.
export async function highlightChip(
  code: string,
  language: LanguageId,
): Promise<RenderedToken[]> {
  if (!code.trim()) return [{ kind: "text", content: code }];
  let tokenized: ThemedToken[][];
  try {
    const result = await codeToTokens(code, {
      lang: shikiLang(language) as BundledLanguage,
      theme: SHIKI_THEME,
    });
    tokenized = result.tokens;
  } catch {
    return [{ kind: "text", content: code }];
  }
  // Flatten lines back into one stream — chips are inline elements,
  // and a multi-line block would already break the template's flow
  // so authors should keep them single-line. Newlines preserved as
  // literal `\n` text tokens in case an author does include one.
  const out: RenderedToken[] = [];
  tokenized.forEach((line, i) => {
    for (const tok of line) {
      out.push({
        kind: "text",
        content: tok.content,
        color: tok.color,
        fontStyle: tok.fontStyle,
      });
    }
    if (i < tokenized.length - 1) {
      out.push({ kind: "text", content: "\n" });
    }
  });
  return out;
}
