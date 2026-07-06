/// Shared Ollama install plumbing — probing which models are
/// installed and pulling a new one. Extracted so BOTH the model
/// picker and the "steer to a tool-native model" card can check a
/// model's install state and pull it, without each duplicating the
/// desktop-vs-remote branch.
///
///   - Desktop (Tauri): `ai_chat_probe` lists installed tags and
///     `ai_chat_pull_model` runs `ollama pull`.
///   - Web / mobile: the Tauri commands would throw, so we fetch the
///     configured host's `/api/tags` over HTTP. Pulls are desktop-only
///     (the install happens on the host machine, not from a browser).

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "@/lib/platform";
import { aiHostUrl } from "@/lib/aiHost";

export interface InstallProbe {
  reachable: boolean;
  models: string[];
  error: string | null;
}

/// Translate function shape (matches `TFunction` from `i18n/i18n`).
/// This is a plain lib module — no React hooks — so callers pass
/// their component's `t()` in; the default returns the key, which
/// mirrors `t()`'s own missing-key fallback.
type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;
const keyFallback: Translate = (key) => key;

export interface PullOutcome {
  success: boolean;
  /// stderr/error text on failure; empty on success.
  error: string;
}

interface DesktopProbeResult {
  reachable: boolean;
  models: string[];
  has_default_model: boolean;
  error: string | null;
}

interface DesktopInstallResult {
  success: boolean;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

/// Probe the Ollama daemon for installed models. `currentModel` is a
/// hint passed to the desktop probe so it can confirm the active
/// selection; harmless on the remote path.
export async function probeInstalledModels(
  currentModel?: string,
  translate: Translate = keyFallback,
): Promise<InstallProbe> {
  if (isDesktop) {
    const r = (await invoke("ai_chat_probe", {
      modelHint: currentModel || null,
    })) as DesktopProbeResult;
    return { reachable: r.reachable, models: r.models ?? [], error: r.error };
  }
  const url = aiHostUrl("/api/tags");
  if (!url) {
    return {
      reachable: false,
      models: [],
      error: translate("settings.aiHostNotSet"),
    };
  }
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) {
      return {
        reachable: false,
        models: [],
        error: translate("settings.ollamaHttpError", { status: r.status }),
      };
    }
    const body = (await r.json()) as { models?: Array<{ name: string }> };
    return {
      reachable: true,
      models: (body.models ?? []).map((m) => m.name),
      error: null,
    };
  } catch (e) {
    return {
      reachable: false,
      models: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    window.clearTimeout(t);
  }
}

/// Pull (`ollama pull`) a model by tag. Desktop-only — on web/mobile
/// the host machine owns the install, so this rejects early with a
/// clear message instead of throwing an opaque invoke error.
export async function pullModel(
  id: string,
  translate: Translate = keyFallback,
): Promise<PullOutcome> {
  if (!isDesktop) {
    return {
      success: false,
      error: translate("settings.pullDesktopOnly"),
    };
  }
  try {
    const r = (await invoke("ai_chat_pull_model", {
      model: id,
    })) as DesktopInstallResult;
    return {
      success: r.success,
      error: r.success
        ? ""
        : r.stderr.trim() || "Pull failed — check Ollama is running.",
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
