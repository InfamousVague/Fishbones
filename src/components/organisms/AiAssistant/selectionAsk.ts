/// "Ask AI about this selection" — the in-sandbox co-creation
/// gesture. The user highlights code in the editor and picks an
/// action; the editor dispatches a `libre:ask-ai` event with this
/// payload, and AiAssistant turns it into a prompt.
///
/// Three actions, two routes:
///   - explain → CHAT (a read-only walkthrough; never touches files)
///   - improve → AGENT (edits the open project in place)
///   - comment → AGENT (adds comments/docs in place)
///
/// Pure module so the prompt/route logic is unit-tested; the editor
/// wiring (Monaco actions) and the AiAssistant dispatch consume it.

import type { TFunction } from "@/i18n/i18n";

export type SelectionAction = "explain" | "improve" | "comment";

export interface SandboxSelectionAsk {
  kind: "sandbox-selection";
  action: SelectionAction;
  /// The highlighted code (or the whole file when nothing is selected).
  selectedText: string;
  /// Project-relative path of the file the selection lives in.
  filePath: string;
  language?: string;
  /// Full file content for surrounding context. Optional + capped.
  fileContent?: string;
}

/// Caps so a giant selection / file can't blow out the prompt.
const MAX_SELECTION_CHARS = 4000;
const MAX_FILE_CHARS = 8000;

/// Which surface handles this action. `improve` + `comment` EDIT the
/// open project, so they go to the agent (with its sandbox tools).
/// `explain` is conversational → chat.
export function selectionAskRoutesToAgent(action: SelectionAction): boolean {
  return action === "improve" || action === "comment";
}

function cap(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s;
}

/// Short, plain user-facing bubble (what the chat shows the learner
/// typed). The framed prompt the model receives is `buildSelectionAskPrompt`.
/// Pass the component's `t` to localize; without it the English
/// fallback keeps older call sites working.
export function buildSelectionAskDisplay(
  d: SandboxSelectionAsk,
  t?: TFunction,
): string {
  switch (d.action) {
    case "explain":
      return t
        ? t("ai.displayExplainSelection", { filePath: d.filePath })
        : `Explain this selection from \`${d.filePath}\``;
    case "improve":
      return t
        ? t("ai.displayImproveSelection", { filePath: d.filePath })
        : `Improve the selected code in \`${d.filePath}\``;
    case "comment":
      return t
        ? t("ai.displayCommentSelection", { filePath: d.filePath })
        : `Add comments to the selected code in \`${d.filePath}\``;
  }
}

/// The framed prompt the model receives.
export function buildSelectionAskPrompt(d: SandboxSelectionAsk): string {
  const lang = d.language || "";
  const sel = cap(d.selectedText.trim(), MAX_SELECTION_CHARS);
  const block = `\`\`\`${lang}\n${sel}\n\`\`\``;
  const fileCtx =
    d.fileContent && d.fileContent.trim() && d.fileContent.trim() !== sel
      ? `\n\nFor context, the full file \`${d.filePath}\`:\n\`\`\`${lang}\n${cap(
          d.fileContent.trim(),
          MAX_FILE_CHARS,
        )}\n\`\`\``
      : "";

  switch (d.action) {
    case "explain":
      return [
        `Explain this code from \`${d.filePath}\` (the user's open sandbox project):`,
        "",
        block,
        "Walk through what it does, step by step, in plain language a learner can follow. Point out any concept worth understanding. Do NOT edit any files — this is an explanation.",
        fileCtx,
      ].join("\n");
    case "improve":
      return [
        `Improve this code in \`${d.filePath}\`. This is the user's OPEN sandbox project — edit it IN PLACE (do NOT create a new project).`,
        "",
        "The selection to improve:",
        block,
        "Read the file with `read_sandbox_file` first if you need surrounding context, then apply your improvement with `apply_sandbox_patch` (or `write_sandbox_file`) against the open project. Keep it runnable, preserve behaviour unless the user clearly wants a change, and after the edit explain what you changed in 1-2 sentences.",
        fileCtx,
      ].join("\n");
    case "comment":
      return [
        `Add clear, concise comments / docstrings to this code in \`${d.filePath}\`. This is the user's OPEN sandbox project — edit it IN PLACE.`,
        "",
        "The selection to document:",
        block,
        "Use `apply_sandbox_patch` to add explanatory comments WITHOUT changing behaviour. Comment the why, not the obvious. Keep the code runnable.",
        fileCtx,
      ].join("\n");
  }
}
