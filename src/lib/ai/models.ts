/// Curated registry of local Ollama models the learner can pick.
///
/// The local assistant used to be hardcoded to `qwen2.5-coder:7b`.
/// This registry backs a model picker: a short, opinionated list
/// of models that actually run well on a personal machine, with
/// the metadata the UI needs (download size, role, RAM ballpark)
/// and — crucially — an honest tool-calling tier.
///
/// ## Tool-calling tiers
///
/// Agent mode needs the model to emit tool calls. Two realities:
///
///   - `native`   — the model ships an Ollama tool template, so
///                  the structured `tool_calls` channel works. The
///                  agent's happy path. (Qwen 2.5 Coder, Llama 3.x,
///                  Mistral.)
///   - `emulated` — no native tool template. The model can't use
///                  the structured channel, BUT Libre's agent loop
///                  has three recovery layers (inline-JSON, XML-tag,
///                  and fenced-file synthesis) that reconstruct tool
///                  calls from plain text. So these models still
///                  DRIVE the sandbox — just less reliably on long
///                  multi-tool runs. They're great for chat/tutoring
///                  regardless. (Gemma 3, Phi-4, DeepSeek-Coder.)
///
/// The picker surfaces this so a learner who picks Gemma for its
/// reasoning knows agent builds may need a nudge, while chat is
/// first-class. We never block a choice — the recovery layers mean
/// every model is usable.
///
/// Sizes are the approximate Ollama download (default quant) so the
/// UI can warn before a multi-GB pull. RAM is a rough "you want at
/// least this much free" for a comfortable run.

export type ToolTier = "native" | "emulated";
export type ModelRole = "code" | "general";

export interface OllamaModelMeta {
  /// Ollama tag, exactly as `ollama pull` expects it.
  id: string;
  /// Short human label for the picker row.
  label: string;
  /// Model family (groups variants in the UI).
  family: string;
  /// Parameter count label ("7B", "3B", "1.5B").
  params: string;
  /// Approximate download size in GB (default quant).
  sizeGb: number;
  /// Suggested minimum free RAM in GB for a smooth run.
  ramGb: number;
  /// "code" = code-specialist (best for the sandbox), "general" =
  /// broad model (great for tutoring / explanations).
  role: ModelRole;
  /// Tool-calling tier — drives the agent-reliability hint.
  tools: ToolTier;
  /// One-line pitch shown under the label.
  blurb: string;
  /// True for the small set shown by default (the rest live behind
  /// a "show all" affordance so the picker isn't a wall).
  recommended: boolean;
}

/// The default local model — unchanged from the historical
/// hardcode so existing setups keep working and fresh installs get
/// a strong, tool-native code model.
export const DEFAULT_MODEL_ID = "qwen2.5-coder:7b";

/// The registry. Ordered roughly by "what most people should pick
/// first": the balanced default, then lighter + heavier siblings,
/// then the general-purpose alternatives the user asked for.
export const OLLAMA_MODELS: readonly OllamaModelMeta[] = [
  // ── Qwen 2.5 Coder — the code-specialist family (native tools) ──
  {
    id: "qwen2.5-coder:7b",
    label: "Qwen2.5 Coder 7B",
    family: "Qwen2.5 Coder",
    params: "7B",
    sizeGb: 4.7,
    ramGb: 8,
    role: "code",
    tools: "native",
    blurb: "Balanced default — strong code + reliable tool calls. Best all-round pick.",
    recommended: true,
  },
  {
    id: "qwen2.5-coder:3b",
    label: "Qwen2.5 Coder 3B",
    family: "Qwen2.5 Coder",
    params: "3B",
    sizeGb: 1.9,
    ramGb: 4,
    role: "code",
    tools: "native",
    blurb: "Lighter coder for modest machines — quicker, slightly less precise.",
    recommended: true,
  },
  {
    id: "qwen2.5-coder:1.5b",
    label: "Qwen2.5 Coder 1.5B",
    family: "Qwen2.5 Coder",
    params: "1.5B",
    sizeGb: 1.0,
    ramGb: 3,
    role: "code",
    tools: "native",
    blurb: "Tiniest coder — runs almost anywhere; keep prompts simple.",
    recommended: false,
  },
  {
    id: "qwen2.5-coder:14b",
    label: "Qwen2.5 Coder 14B",
    family: "Qwen2.5 Coder",
    params: "14B",
    sizeGb: 9.0,
    ramGb: 16,
    role: "code",
    tools: "native",
    blurb: "Heavier coder — noticeably sharper on tricky builds if you have the RAM.",
    recommended: true,
  },
  // ── Gemma 3 — Google's general model (emulated tools) ──────────
  {
    id: "gemma3:4b",
    label: "Gemma 3 4B",
    family: "Gemma 3",
    params: "4B",
    sizeGb: 3.3,
    ramGb: 6,
    role: "general",
    tools: "emulated",
    blurb: "Google's compact general model — excellent explanations; agent uses recovery mode.",
    recommended: true,
  },
  {
    id: "gemma3:12b",
    label: "Gemma 3 12B",
    family: "Gemma 3",
    params: "12B",
    sizeGb: 8.1,
    ramGb: 16,
    role: "general",
    tools: "emulated",
    blurb: "Bigger Gemma — strong reasoning for tutoring; agent uses recovery mode.",
    recommended: true,
  },
  {
    id: "gemma3:1b",
    label: "Gemma 3 1B",
    family: "Gemma 3",
    params: "1B",
    sizeGb: 0.8,
    ramGb: 3,
    role: "general",
    tools: "emulated",
    blurb: "Ultra-light Gemma — fast chat on low-spec machines.",
    recommended: false,
  },
  // ── Llama 3.x — Meta's general models (native tools) ───────────
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    family: "Llama",
    params: "8B",
    sizeGb: 4.9,
    ramGb: 8,
    role: "general",
    tools: "native",
    blurb: "Meta's well-rounded 8B — solid chat AND native tool calls.",
    recommended: true,
  },
  {
    id: "llama3.2:3b",
    label: "Llama 3.2 3B",
    family: "Llama",
    params: "3B",
    sizeGb: 2.0,
    ramGb: 4,
    role: "general",
    tools: "native",
    blurb: "Compact Llama with tool support — a nimble all-rounder.",
    recommended: false,
  },
  // ── Mistral — efficient general model (native tools) ───────────
  {
    id: "mistral:7b",
    label: "Mistral 7B",
    family: "Mistral",
    params: "7B",
    sizeGb: 4.4,
    ramGb: 8,
    role: "general",
    tools: "native",
    blurb: "Fast, efficient 7B with native tool calling — a strong agent alternative.",
    recommended: false,
  },
  // ── DeepSeek Coder — heavy code model (emulated tools) ─────────
  {
    id: "deepseek-coder-v2:16b",
    label: "DeepSeek Coder V2 16B",
    family: "DeepSeek Coder",
    params: "16B",
    sizeGb: 8.9,
    ramGb: 16,
    role: "code",
    tools: "emulated",
    blurb: "Powerful code model — great completions; agent uses recovery mode.",
    recommended: false,
  },
  // ── Phi-4 — Microsoft's reasoning model (emulated tools) ───────
  {
    id: "phi4",
    label: "Phi-4 14B",
    family: "Phi",
    params: "14B",
    sizeGb: 9.1,
    ramGb: 16,
    role: "general",
    tools: "emulated",
    blurb: "Microsoft's reasoning-focused 14B — sharp explanations; agent uses recovery mode.",
    recommended: false,
  },
] as const;

/// Look up a model's metadata by id. Returns null for ids not in
/// the registry (a custom model the user pulled by hand) — the UI
/// renders those as a plain "custom model" row.
export function findModelMeta(id: string): OllamaModelMeta | null {
  return OLLAMA_MODELS.find((m) => m.id === id) ?? null;
}

/// True when the id is a known registry model.
export function isKnownModel(id: string): boolean {
  return findModelMeta(id) !== null;
}

/// Compact label for tight chrome (the header dropdown trigger):
/// the family's first word + the parameter size, e.g.
/// "Qwen 7B", "Gemma 4B", "Mistral 7B". Custom (unknown) tags fall
/// back to their base name (sans `:tag`), truncated so the trigger
/// can't blow out the header width.
export function compactModelLabel(id: string): string {
  const meta = findModelMeta(id);
  if (meta) {
    const familyShort = meta.family.split(/[\s-]/)[0];
    return `${familyShort} ${meta.params}`;
  }
  const base = id.split(":")[0];
  return base.length > 16 ? `${base.slice(0, 15)}…` : base;
}

/// Whether a model uses Ollama's native tool-calling channel.
/// Unknown (custom) ids default to `native` optimistically — the
/// recovery layers cover the case where they aren't.
export function isToolNative(id: string): boolean {
  const meta = findModelMeta(id);
  return meta ? meta.tools === "native" : true;
}

/// Normalise an Ollama tag for comparison: `ollama pull qwen2.5-coder`
/// stores it as `qwen2.5-coder:latest`, and a registry id may be
/// `qwen2.5-coder:7b`. Two tags "match" when one is a prefix of the
/// other up to the `:` tag boundary. Mirrors the Rust probe's
/// matching so the UI's "installed?" check agrees with the backend.
export function modelTagMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const base = (s: string) => s.split(":")[0];
  if (base(a) !== base(b)) return false;
  // Same base name; treat `:latest` / bare as wildcard matches.
  const tag = (s: string) => (s.includes(":") ? s.split(":")[1] : "latest");
  const ta = tag(a);
  const tb = tag(b);
  return ta === tb || ta === "latest" || tb === "latest";
}

/// Given the list of installed tags from the probe, is `id`
/// installed? Uses tag-aware matching so `qwen2.5-coder:7b` in the
/// registry matches an installed `qwen2.5-coder:7b` exactly, and a
/// bare `gemma3` install matches `gemma3:latest`.
export function isModelInstalled(
  id: string,
  installed: readonly string[],
): boolean {
  return installed.some((t) => modelTagMatches(t, id));
}
