/// Daemon-aware tool-capability detection.
///
/// The static registry (`models.ts`) hardcodes each model's tool tier,
/// but that drifts as Ollama ships native tool templates for models we
/// list as "emulated" (deepseek-coder-v2, phi4, …). This module probes
/// the user's ACTUAL Ollama daemon — `/api/show` reports a model's
/// `capabilities` array — and caches whether each model supports the
/// native `tools` channel, so a build uses the structured channel
/// whenever the daemon actually offers it.
///
/// `resolveToolNative(model)` is the cheap SYNC accessor used on the
/// hot path (loop + prompt + UI gates): it returns the cached probe
/// result when known, else the static registry guess. `ensureTool
/// Capability(model)` is the async warmer — call it when the selected
/// model changes so the cache is hot by build time. An UNKNOWN answer
/// (old daemon, unreachable) is never cached, so a later probe against
/// an upgraded daemon can still learn the truth.

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "@/lib/platform";
import { aiHostUrl } from "@/lib/aiHost";
import { isToolNative } from "./models";

interface DesktopCapsResult {
  reachable: boolean;
  supports_tools: boolean;
  known: boolean;
  error: string | null;
}

const STORAGE_KEY = "libre.ai.toolCaps";

// model id → definitively-known native tool capability. Absent =
// not probed (or probed inconclusively).
const cache = new Map<string, boolean>();
// In-flight probes, keyed by model, so concurrent callers ride one
// request instead of spamming the daemon.
const inflight = new Map<string, Promise<boolean | null>>();
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "boolean") cache.set(k, v);
    }
  } catch {
    /* corrupt blob — ignore, re-probe lazily */
  }
}

function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const obj: Record<string, boolean> = {};
    for (const [k, v] of cache) obj[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota / disabled — fine, cache rides in memory this session */
  }
}

/// Cached, daemon-aware "does this model use the native tool channel?"
/// Falls back to the static registry tier when the model has not been
/// (conclusively) probed.
export function resolveToolNative(model: string): boolean {
  hydrate();
  const cached = cache.get(model);
  return cached !== undefined ? cached : isToolNative(model);
}

/// Whether we have a definitive probe result for this model already.
export function hasProbed(model: string): boolean {
  hydrate();
  return cache.has(model);
}

/// Probe the daemon. Resolves to true/false on a definitive answer,
/// or null when unknown (old daemon, unreachable, no capabilities
/// field) so the caller keeps the static guess.
async function probe(model: string): Promise<boolean | null> {
  if (isDesktop) {
    try {
      const r = (await invoke("ai_chat_model_caps", {
        model,
      })) as DesktopCapsResult;
      if (r.reachable && r.known) return r.supports_tools;
      return null;
    } catch {
      return null;
    }
  }
  // Web / mobile: POST the configured host's /api/show directly.
  const url = aiHostUrl("/api/show");
  if (!url) return null;
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { capabilities?: unknown };
    if (!Array.isArray(body.capabilities)) return null;
    return body.capabilities.some(
      (c) => typeof c === "string" && c.toLowerCase() === "tools",
    );
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
  }
}

/// Probe (once) whether `model` supports native tools and cache a
/// definitive result. Idempotent + dedupes concurrent calls. Never
/// caches an inconclusive (null) answer.
export async function ensureToolCapability(model: string): Promise<void> {
  hydrate();
  if (!model || cache.has(model)) return;
  let p = inflight.get(model);
  if (!p) {
    p = probe(model);
    inflight.set(model, p);
  }
  let result: boolean | null = null;
  try {
    result = await p;
  } finally {
    inflight.delete(model);
  }
  if (result !== null) {
    cache.set(model, result);
    persist();
  }
}

/// Test seam: reset all cached state.
export function __resetToolCapabilityCache(): void {
  cache.clear();
  inflight.clear();
  hydrated = false;
}
