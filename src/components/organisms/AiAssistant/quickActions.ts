/// Composer quick-actions — one-click co-creation prompts that lean
/// on the project-aware agent (Iter 1). Instead of typing "explain my
/// code" / "fix that error", the user taps a chip and the agent acts
/// on the OPEN sandbox project.
///
/// Pure module: each action declares when it's relevant (`show`) and
/// the prompt it sends (`prompt`). The panel renders the relevant
/// ones above the composer and dispatches the prompt via `onSend`.

export interface QuickActionCtx {
  /// Name of the open sandbox project, if any.
  projectName?: string;
  /// Path of the file focused in the editor, if any.
  openFile?: string;
  /// The most recent run's error text, if the last run failed.
  lastError?: string | null;
}

export interface QuickAction {
  id: string;
  label: string;
  /// Whether to surface this action for the given context.
  show: (ctx: QuickActionCtx) => boolean;
  /// The prompt to send. The agent's "# Open sandbox project" context
  /// means it already knows which project "my project" is.
  prompt: (ctx: QuickActionCtx) => string;
}

const MAX_ERROR_CHARS = 1500;

function capError(e: string): string {
  return e.length > MAX_ERROR_CHARS ? `${e.slice(0, MAX_ERROR_CHARS)}\n…(truncated)` : e;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "fix-error",
    label: "Fix the error",
    show: (c) => !!c.lastError && c.lastError.trim().length > 0,
    prompt: (c) =>
      [
        "The last run of my open project FAILED with this error:",
        "```",
        capError((c.lastError ?? "").trim()),
        "```",
        "Diagnose it, fix it in place in my open project, and run it again to confirm it passes.",
      ].join("\n"),
  },
  {
    id: "explain",
    label: "Explain my code",
    show: (c) => !!c.projectName,
    prompt: (c) =>
      `Explain how my open project${
        c.projectName ? ` "${c.projectName}"` : ""
      } works — go file by file, in plain language a learner can follow. Don't change anything.`,
  },
  {
    id: "comment",
    label: "Add comments",
    show: (c) => !!c.openFile,
    prompt: (c) =>
      `Add clear, concise comments / docstrings to \`${c.openFile}\` in my open project, IN PLACE, without changing behaviour.`,
  },
  {
    id: "add-tests",
    label: "Add tests",
    show: (c) => !!c.projectName,
    prompt: () =>
      "Add a small set of tests for my open project, write them into the project, and run them to confirm they pass.",
  },
];

/// The actions relevant to the current context, in display order.
export function visibleQuickActions(ctx: QuickActionCtx): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => a.show(ctx));
}
