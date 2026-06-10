/// Conversation compaction — keeps the wire payload small so
/// local-model turns stay fast.
///
/// On a 7B Ollama model, prompt evaluation is the dominant
/// latency: every KB of history re-sent each turn is wall-clock
/// the learner waits. A 10-turn agent run accumulates dozens of
/// tool results (file bodies, run logs) that the model needed
/// ONCE and never again — yet the old stack re-sent all of them
/// every turn, growing quadratically.
///
/// Strategy (applied to the wire payload only — the UI's message
/// log keeps everything verbatim):
///
///   1. The system message is NEVER touched. It's also first, so
///      Ollama's prefix KV-cache keeps it warm across turns —
///      mutating it would invalidate the cache every turn.
///   2. Everything from the LAST user message onward is verbatim
///      (the current request + this run's working context).
///   3. The most recent `keepRecentTurns` assistant/tool rows
///      before that stay verbatim too (the model often refers
///      back one or two steps).
///   4. Older tool results get truncated to `maxToolChars` with
///      an explicit marker so the model knows content was elided
///      and can re-read through its tools if needed.
///   5. Older assistant prose gets the same truncation.
///   6. If the payload still exceeds `budgetChars`, the oldest
///      non-system rows are dropped entirely (front-first) until
///      it fits — with a one-line tombstone noting the elision.

export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface CompactionOptions {
  /// Assistant/tool rows this many positions before the last user
  /// message stay verbatim.
  keepRecentRows: number;
  /// Truncation cap for older tool results + assistant prose.
  maxToolChars: number;
  /// Hard total-payload budget (chars). ~24k chars ≈ 6k tokens —
  /// comfortable inside an 8k num_ctx with room for the reply.
  budgetChars: number;
}

export const DEFAULT_COMPACTION: CompactionOptions = {
  keepRecentRows: 4,
  maxToolChars: 600,
  budgetChars: 24_000,
};

/// Compact a wire payload. Pure: returns a new array, never
/// mutates the input rows.
export function compactWireMessages(
  messages: readonly WireMessage[],
  options: Partial<CompactionOptions> = {},
): WireMessage[] {
  const opts = { ...DEFAULT_COMPACTION, ...options };
  if (messages.length === 0) return [];

  // Find the last user message — the live request. Everything
  // from there on is untouchable.
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  // Defensive: no user message at all (shouldn't happen) — return
  // as-is rather than guessing.
  if (lastUserIdx === -1) return [...messages];

  const verbatimFrom = Math.max(0, lastUserIdx - opts.keepRecentRows);

  const out: WireMessage[] = messages.map((m, i) => {
    if (m.role === "system") return m;
    if (i >= verbatimFrom) return m;
    if (m.content.length <= opts.maxToolChars) return m;
    if (m.role === "tool" || m.role === "assistant") {
      const elided = m.content.length - opts.maxToolChars;
      return {
        ...m,
        content:
          m.content.slice(0, opts.maxToolChars) +
          `\n…[${elided} chars elided — re-read via tools if needed]`,
      };
    }
    return m;
  });

  // Budget pass: drop oldest non-system rows until under budget.
  // We never drop anything at/after verbatimFrom — if the recent
  // window alone exceeds the budget, we accept the overage (the
  // current request must survive intact).
  let total = out.reduce((n, m) => n + m.content.length, 0);
  if (total <= opts.budgetChars) return out;

  const kept: WireMessage[] = [];
  const droppedRows: WireMessage[] = [];
  // Walk from the front; system rows always kept.
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.role === "system" || i >= verbatimFrom) {
      kept.push(m);
      continue;
    }
    if (total > opts.budgetChars) {
      total -= m.content.length;
      droppedRows.push(m);
      continue;
    }
    kept.push(m);
  }
  if (droppedRows.length > 0) {
    // Informative tombstone right after the system message: an
    // extractive summary of what was elided (first request + tool
    // outcome tallies) so the model keeps the GIST of early
    // history instead of a bare "N messages deleted". This is
    // what stops a model 15 turns into a build from re-creating a
    // project it already created in turn 1.
    const sysIdx = kept.findIndex((m) => m.role === "system");
    kept.splice(sysIdx + 1, 0, {
      role: "user",
      content: summarizeDropped(droppedRows),
    });
  }
  return kept;
}

/// Build the one-paragraph extractive summary of elided rows:
/// the first user request (the run's original goal) + per-tool
/// outcome tallies parsed from tool-result payloads.
export function summarizeDropped(rows: readonly WireMessage[]): string {
  const firstUser = rows.find((m) => m.role === "user");
  const goal = firstUser
    ? `Original request: "${truncateLine(firstUser.content, 140)}". `
    : "";

  // Tally tool outcomes by name. Tool-result payloads follow the
  // `{ok:boolean}` / `{error:true}` conventions; anything
  // unparseable counts as ok (neutral).
  const tally = new Map<string, { ok: number; fail: number }>();
  for (const m of rows) {
    if (m.role !== "tool" || !m.name) continue;
    const entry = tally.get(m.name) ?? { ok: 0, fail: 0 };
    if (/"error"\s*:\s*true|"ok"\s*:\s*false/.test(m.content)) {
      entry.fail += 1;
    } else {
      entry.ok += 1;
    }
    tally.set(m.name, entry);
  }
  const toolBits = Array.from(tally.entries()).map(([name, t]) => {
    const parts: string[] = [];
    if (t.ok > 0) parts.push(`${t.ok} ok`);
    if (t.fail > 0) parts.push(`${t.fail} failed`);
    return `${name} (${parts.join(", ")})`;
  });
  const tools =
    toolBits.length > 0 ? `Tools already run: ${toolBits.join("; ")}. ` : "";

  return `[${rows.length} earlier message${rows.length === 1 ? "" : "s"} elided to keep this conversation fast. ${goal}${tools}Don't redo completed work; re-read files via tools if you need details.]`;
}

function truncateLine(s: string, max: number): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max)}…`;
}
