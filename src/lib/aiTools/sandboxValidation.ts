/// Strict validation for AI-supplied sandbox PROJECT NAMES and FILE
/// PATHS — the guard that kills the "junk project" failure.
///
/// An emulated model (no native tool calls) emits tool-call JSON as
/// text; the recovery layer can mis-extract a `create_sandbox_project`
/// whose `name` (or a `write_sandbox_file` whose `path`) is a fragment
/// of that JSON — e.g. `"create_sandbox_project", "argu…`. Without a
/// guard, each fragment spawns a real project/file, flooding the
/// sandbox. The editor's `safeMonacoPath` crash-proofs rendering, but
/// the right fix is to NEVER CREATE the junk in the first place: the
/// tools reject a malformed name/path with a clear, actionable error
/// so the model retries with something real.
///
/// Pure + exported so the contract is unit-tested.

export interface NameCheck {
  ok: boolean;
  /// Actionable message the tool returns to the model on rejection.
  reason?: string;
}

/// Tokens that betray tool-call / JSON leakage rather than a real
/// name or path. Matched case-insensitively as whole-ish fragments.
const TOOLCALL_LEAK = /create_sandbox_project|write_sandbox_file|apply_sandbox_patch|run_sandbox_project|"name"|"arguments"|tool_call/i;

const MAX_NAME = 60;
const MAX_PATH = 200;

/// Validate a project NAME (the human-readable label the user sees in
/// the projects panel). Rejects tool-call/JSON garbage, control chars,
/// quotes/brackets/braces/colons, and absurd lengths.
export function validateProjectName(name: unknown): NameCheck {
  if (typeof name !== "string") {
    return { ok: false, reason: "project name must be a string." };
  }
  const n = name.trim();
  if (!n) return { ok: false, reason: "project name is empty." };
  if (n.length > MAX_NAME) {
    return {
      ok: false,
      reason: `project name is too long (max ${MAX_NAME} chars). Use a short title like "Blackjack".`,
    };
  }
  if (/[\u0000-\u001f]/.test(n)) {
    return { ok: false, reason: "project name contains control characters." };
  }
  if (/["'`{}[\]:<>]/.test(n)) {
    return {
      ok: false,
      reason:
        'project name contains illegal characters (quotes, brackets, braces, or ":"). This looks like tool-call JSON, not a real name — pass a plain title like "Blackjack".',
    };
  }
  if (TOOLCALL_LEAK.test(n)) {
    return {
      ok: false,
      reason:
        "project name looks like a tool-call fragment. Pass a real, human-readable title (e.g. \"Blackjack\"), not the tool name or JSON.",
    };
  }
  return { ok: true };
}

/// Disambiguate a project display name against existing projects: on
/// a case-insensitive collision, append " 2" / " 3" / … so a fresh
/// build named "Blackjack" when one already exists becomes "Blackjack
/// 2" rather than a confusing second identical row. (Per-RUN dedupe in
/// the loop already prevents one build from spawning duplicates; this
/// handles a NEW build whose name clashes with a PRIOR one.)
export function dedupeProjectName(
  name: string,
  existingNames: readonly string[],
): string {
  const base = name.trim();
  const taken = new Set(
    existingNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${existingNames.length + 1}`;
}

/// Validate a project-relative FILE PATH. Rejects traversal, absolute
/// paths, colons (which both crash the editor and signal a leaked
/// `lang:path` fence), quotes/brackets, control chars, tool-call
/// fragments, and per-segment garbage. Accepts ordinary paths like
/// `src/App.jsx`, `main.py`, `components/Card.tsx`.
export function validateFilePath(path: unknown): NameCheck {
  if (typeof path !== "string") {
    return { ok: false, reason: "file path must be a string." };
  }
  const p = path.trim();
  if (!p) return { ok: false, reason: "file path is empty." };
  if (p.length > MAX_PATH) {
    return { ok: false, reason: `file path is too long (max ${MAX_PATH} chars).` };
  }
  if (/[\u0000-\u001f]/.test(p)) {
    return { ok: false, reason: "file path contains control characters." };
  }
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) {
    return {
      ok: false,
      reason: "file path must be project-relative (no leading '/' and no drive letter).",
    };
  }
  if (p.split(/[\\/]/).some((seg) => seg === "..")) {
    return { ok: false, reason: "file path must not traverse out of the project ('..')." };
  }
  if (p.includes(":")) {
    return {
      ok: false,
      reason:
        "file path must not contain ':' — that crashes the editor and usually means a 'lang:path' code fence leaked into the path. Pass just the path, e.g. 'src/App.jsx'.",
    };
  }
  if (/["'`{}[\]<>]/.test(p)) {
    return {
      ok: false,
      reason:
        "file path contains illegal characters (quotes, brackets, braces, or angle-brackets). This looks like tool-call/JSON text, not a file path.",
    };
  }
  if (TOOLCALL_LEAK.test(p)) {
    return {
      ok: false,
      reason: "file path looks like a tool-call fragment, not a real path.",
    };
  }
  const segs = p.split("/").filter((s) => s.length > 0);
  if (segs.length === 0) {
    return { ok: false, reason: "file path has no filename." };
  }
  for (const seg of segs) {
    // Conservative per-segment set: letters, digits, dot, dash,
    // underscore, space, plus, hash, @ (npm-scope-ish). No slashes
    // (already split), no the dangerous chars handled above.
    if (!/^[A-Za-z0-9._ +@#-]+$/.test(seg)) {
      return {
        ok: false,
        reason: `file path segment "${seg}" has illegal characters. Use simple names like 'src/App.jsx'.`,
      };
    }
  }
  // The final segment should look like a filename (have an extension
  // or at least not be a lone dot). Be lenient — some langs use
  // extensionless files — but reject a trailing slash / empty leaf.
  const leaf = segs[segs.length - 1];
  if (leaf === "." || leaf === "..") {
    return { ok: false, reason: "file path must end in a filename." };
  }
  return { ok: true };
}
