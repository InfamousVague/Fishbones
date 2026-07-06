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
  /// One-line pitch shown under the label. Canonical English —
  /// the picker renders the localized `modelBlurbKey(id)` string
  /// with this as the fallback.
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
  const exact = OLLAMA_MODELS.find((m) => m.id === id);
  if (exact) return exact;
  // Fall back to a tier-canonical match so a hand-pulled quant /
  // instruct variant resolves to its base registry entry — e.g.
  // `deepseek-coder-v2:16b-q4_K_M` → `deepseek-coder-v2:16b`
  // (emulated), `qwen2.5-coder:7b-instruct-q5` → `qwen2.5-coder:7b`
  // (native), `phi4:q8_0` → `phi4`. Without this, every quant tag
  // looked "unknown" and defaulted to the optimistic native path,
  // skipping the emulated prompt + relying on the 400 fallback.
  const canon = canonicalModelId(id);
  return (
    OLLAMA_MODELS.find(
      (m) => m.id === canon || canonicalModelId(m.id) === canon,
    ) ?? null
  );
}

/// Reduce an Ollama tag to its tier-defining form: the base name
/// plus a leading param-size token (`7b`, `1.5b`, `8x7b`, `16b`),
/// dropping quant / instruct / format suffixes (`-q4_K_M`,
/// `-instruct`, `-fp16`, …). A tag with no size token collapses to
/// the bare base name (so `phi4:q8_0` → `phi4`).
function canonicalModelId(id: string): string {
  const colon = id.indexOf(":");
  const base = colon >= 0 ? id.slice(0, colon) : id;
  const tag = colon >= 0 ? id.slice(colon + 1) : "";
  const sizeMatch = /^(\d+(?:\.\d+)?(?:x\d+)?b)/i.exec(tag);
  return sizeMatch ? `${base}:${sizeMatch[1].toLowerCase()}` : base;
}

/// True when the id is a known registry model.
export function isKnownModel(id: string): boolean {
  return findModelMeta(id) !== null;
}

/// i18n key for a registry model's blurb
/// (`settings.modelBlurbs.<id>` with the Ollama tag sanitized —
/// dots/colons would break the dotted-path dictionary lookup, so
/// `qwen2.5-coder:7b` → `settings.modelBlurbs.qwen2_5_coder_7b`).
/// Returns null for custom models not in the registry; callers
/// fall back to `meta.blurb` (or their "custom model" copy).
export function modelBlurbKey(id: string): string | null {
  const meta = findModelMeta(id);
  if (!meta) return null;
  return `settings.modelBlurbs.${meta.id.replace(/[^a-zA-Z0-9]+/g, "_")}`;
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
///
/// NOTE: this is the STATIC registry tier. For the live, daemon-aware
/// answer (a model the user's Ollama version reports as tool-capable)
/// use `resolveToolNative` from `toolCapability.ts`, which falls back
/// to this when no probe result is cached.
export function isToolNative(id: string): boolean {
  const meta = findModelMeta(id);
  return meta ? meta.tools === "native" : true;
}

/// Parse a registry `params` label ("7B", "1.5B", "16B", "8x7B")
/// into an approximate billions-of-params number, or null when
/// unknown. Used to gauge how reliably a model can follow the
/// text-tool-call / fenced-build protocol.
export function modelParamsB(id: string): number | null {
  const meta = findModelMeta(id);
  if (!meta) return null;
  // "8x7b" (MoE) → treat as the 7b expert size for reliability
  // purposes; a leading "NxMb" matches M.
  const m = /(?:\d+x)?(\d+(?:\.\d+)?)\s*b/i.exec(meta.params);
  return m ? parseFloat(m[1]) : null;
}

/// A "strong builder" can be trusted to emit the structured build
/// output reliably — either it has a native tool channel, it's a
/// code specialist, or it's a large general model (>= 7B) that
/// follows the fenced-file / tool-call format well. Weak models
/// (small general models like gemma3:4b) get the gentler treatment:
/// a simpler prompt and post-turn (not live) file landing.
/// Unknown ids are optimistically strong.
export function isStrongBuilder(id: string): boolean {
  if (isToolNative(id)) return true;
  const meta = findModelMeta(id);
  if (!meta) return true;
  if (meta.role === "code") return true;
  const p = modelParamsB(id);
  return p !== null && p >= 7;
}

/// Should files stream into the editor LIVE (char-by-char, mid-turn)
/// for this model, or land validated post-turn? Strong builders
/// stream live like native models; weak emulated models land
/// post-turn through the loop's validated fence synthesis, which is
/// safer against their noisier token streams. ("Auto by model
/// strength" — the chosen build behaviour.)
export function streamsFilesLive(id: string): boolean {
  return isStrongBuilder(id);
}

/// The emulated-prompt tier for a model: how to teach an emulated
/// (non-tool-native) model to act. "strong" → full `<tool_call>`
/// JSON protocol; "weak" → lean on one create call + plain
/// ```lang:path fenced files (which the fence synthesizer lands
/// deterministically). Only meaningful for emulated models.
export function emulatedBuildTier(id: string): "weak" | "strong" {
  return isStrongBuilder(id) ? "strong" : "weak";
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
