/// Persistent learner memory — the AI stops forgetting the
/// learner between sessions.
///
/// Two stores, one localStorage blob (`libre.ai.memory`):
///
///   - facts      Explicit notes the agent saves via the
///                `remember` tool ("prefers terse answers",
///                "building a roguelike as their side project",
///                "confused mutable borrows with aliasing").
///                Capped FIFO so the blob can't grow unbounded.
///   - struggles  Per-topic failure counters fed by the error-
///                diagnosis layer: every diagnosed run failure
///                bumps its code ("rust-E0382": 4). Lets the
///                prompt say "the learner has hit borrow-of-moved
///                -value four times — slow down on ownership"
///                without anyone writing that note by hand.
///
/// `buildMemoryBlock()` renders both into a budgeted prompt block
/// injected into chat + agent system prompts. Pure functions over
/// an injected store make every piece unit-testable; the default
/// store is localStorage (present in the app webview AND jsdom).

export interface MemoryFact {
  id: string;
  text: string;
  /// Epoch ms — used for FIFO eviction and "recent first" render.
  createdAt: number;
}

export interface LearnerMemory {
  facts: MemoryFact[];
  /// topic/diagnosis-code → failure count.
  struggles: Record<string, number>;
}

const STORAGE_KEY = "libre.ai.memory";
/// Fact cap — FIFO eviction beyond this. Enough for a real
/// profile, small enough to never bloat the prompt.
const MAX_FACTS = 24;
/// Render cap inside the prompt block.
const RENDERED_FACTS = 10;
const RENDERED_STRUGGLES = 5;

export const EMPTY_MEMORY: LearnerMemory = { facts: [], struggles: {} };

export function loadMemory(): LearnerMemory {
  if (typeof localStorage === "undefined") return structuredClone(EMPTY_MEMORY);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(EMPTY_MEMORY);
    const parsed = JSON.parse(raw) as Partial<LearnerMemory>;
    return {
      facts: Array.isArray(parsed.facts)
        ? parsed.facts.filter(
            (f): f is MemoryFact =>
              !!f && typeof f.text === "string" && typeof f.id === "string",
          )
        : [],
      struggles:
        parsed.struggles && typeof parsed.struggles === "object"
          ? (parsed.struggles as Record<string, number>)
          : {},
    };
  } catch {
    return structuredClone(EMPTY_MEMORY);
  }
}

export function saveMemory(memory: LearnerMemory): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    /* quota/disabled — memory degrades to session-only */
  }
}

/// Add a fact (deduped on normalised text, FIFO-capped). Returns
/// the updated memory + whether anything changed.
export function addFact(
  memory: LearnerMemory,
  text: string,
  now: number = Date.now(),
): { memory: LearnerMemory; added: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { memory, added: false };
  const norm = trimmed.toLowerCase();
  if (memory.facts.some((f) => f.text.trim().toLowerCase() === norm)) {
    return { memory, added: false };
  }
  const fact: MemoryFact = {
    id: `fact_${now.toString(36)}_${memory.facts.length}`,
    text: trimmed.slice(0, 280),
    createdAt: now,
  };
  const facts = [...memory.facts, fact];
  // FIFO eviction — oldest out.
  while (facts.length > MAX_FACTS) facts.shift();
  return { memory: { ...memory, facts }, added: true };
}

export function removeFact(
  memory: LearnerMemory,
  idOrText: string,
): LearnerMemory {
  const needle = idOrText.trim().toLowerCase();
  return {
    ...memory,
    facts: memory.facts.filter(
      (f) =>
        f.id !== idOrText && f.text.trim().toLowerCase() !== needle,
    ),
  };
}

/// Bump a struggle counter (diagnosis code or topic).
export function recordStruggleIn(
  memory: LearnerMemory,
  topic: string,
): LearnerMemory {
  const key = topic.trim();
  if (!key) return memory;
  return {
    ...memory,
    struggles: { ...memory.struggles, [key]: (memory.struggles[key] ?? 0) + 1 },
  };
}

/// Convenience load-mutate-save used by fire-and-forget callers
/// (the run tool's diagnosis hook). Safe everywhere localStorage
/// exists; silently no-ops otherwise.
export function recordStruggle(topic: string): void {
  saveMemory(recordStruggleIn(loadMemory(), topic));
}

/// Render memory as a prompt block. Empty string when there's
/// nothing to say. Struggles are sorted by count and translated
/// into plain coaching guidance rather than raw counters.
export function buildMemoryBlock(
  memory: LearnerMemory = loadMemory(),
): string {
  const parts: string[] = [];

  if (memory.facts.length > 0) {
    const recent = [...memory.facts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, RENDERED_FACTS)
      .map((f) => `- ${f.text}`);
    parts.push(
      `## Learner memory (notes you saved in earlier sessions)\n${recent.join("\n")}`,
    );
  }

  const struggleEntries = Object.entries(memory.struggles)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, RENDERED_STRUGGLES);
  if (struggleEntries.length > 0) {
    const lines = struggleEntries.map(
      ([topic, n]) => `- ${topic} (${n} failed runs)`,
    );
    parts.push(
      [
        "## Recurring struggles (auto-tracked from failed runs)",
        lines.join("\n"),
        "When one of these topics comes up, slow down: explain the underlying concept before the fix, and prefer guiding questions over finished answers.",
      ].join("\n"),
    );
  }

  return parts.join("\n\n");
}
