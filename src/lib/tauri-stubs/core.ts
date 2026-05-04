/// Web-build stub for `@tauri-apps/api/core`.
///
/// Vite's resolve.alias swaps `@tauri-apps/api/core` for this module
/// when `FISHBONES_TARGET=web`. Calls throw a recognisable error so
/// any code path that hasn't been gated by `isWeb` fails loudly
/// rather than silently no-op'ing — easier to spot during the rollout.
///
/// Phases 2-4 progressively replace the still-thrown sites with real
/// web implementations:
///   - Phase 2: storage commands → IndexedDB.
///   - Phase 3: runtime gate (`runtimes/index.ts`) short-circuits
///     before invoke fires, so the stub is never reached for native
///     toolchain languages.
///   - Phase 4: AI / cloud commands → direct HTTPS calls.
///
/// Until then, any thrown `TAURI_UNAVAILABLE` indicates a feature
/// that still needs porting (or a place where `isWeb` should gate
/// the call).
export async function invoke<T>(cmd: string, _args?: unknown): Promise<T> {
  throw new Error(
    `TAURI_UNAVAILABLE: invoke("${cmd}") was called on the web build. ` +
      `Either gate this call site with platform.ts isWeb, or replace ` +
      `it with a web-compatible implementation.`,
  );
}

/// Some callers also pull `Channel` / `convertFileSrc` from the same
/// module. Re-export minimal stubs for those that compile but throw
/// on use.
export class Channel<T> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onmessage: (response: T) => void = () => {};
  constructor() {
    // No-op. The real Channel pipes Tauri IPC messages; on web we
    // never wire one up, so nothing comes through.
  }
}

export function convertFileSrc(filePath: string, _protocol?: string): string {
  // On desktop this rewrites a fs path to an asset:// URL the
  // webview can fetch. There's no equivalent on web — the caller
  // should already be using a public URL.
  return filePath;
}

/// Resource — needed by `@tauri-apps/plugin-updater`'s `Update` class
/// (it extends Resource for its rid-based lifecycle). On the web
/// build the updater plugin is never reached at runtime (the
/// auto-update flow is gated on Tauri presence), but the stub still
/// has to compile cleanly through Rollup's static analysis.
///
/// Real Resource manages a Tauri-side resource id with `close()`.
/// We give the stub the same shape: any `rid` field + a no-op
/// close. Anything that hits `_doClose()` on the web throws via
/// `invoke` above, which is the right loud-fail behaviour for an
/// unintended path.
export class Resource {
  protected _rid: number;

  constructor(rid: number) {
    this._rid = rid;
  }

  get rid(): number {
    return this._rid;
  }

  async close(): Promise<void> {
    // No real resource exists on the web build, so close() has
    // nothing to release. Resolve so callers' `defer`-style cleanup
    // logic completes without surfacing a noisy reject.
  }
}

/// PluginListener — surface area for `@tauri-apps/api/core`'s event
/// listener helpers when called via plugin packages. The web build
/// returns a no-op stop handle; nothing fires anyway because
/// invoke() throws.
export class PluginListener {
  plugin: string;
  event: string;
  channelId: number;

  constructor(plugin: string, event: string, channelId: number) {
    this.plugin = plugin;
    this.event = event;
    this.channelId = channelId;
  }

  async unregister(): Promise<void> {
    // No-op — nothing was registered.
  }
}

/// addPluginListener — used by some plugins. On web, return a
/// PluginListener with channelId=0 and never fire.
export async function addPluginListener<T>(
  plugin: string,
  event: string,
  cb: (payload: T) => void,
): Promise<PluginListener> {
  void cb;
  return new PluginListener(plugin, event, 0);
}

/// SERIALIZE_TO_IPC_FN — internal sentinel symbol Tauri uses to mark
/// objects with a custom IPC serialiser. Stub it as a real Symbol so
/// `[SERIALIZE_TO_IPC_FN]?: () => unknown` member declarations on
/// classes (e.g. plugin types) compile.
export const SERIALIZE_TO_IPC_FN = Symbol("__TAURI_TO_IPC_KEY__");

/// transformCallback — used by Channel / event listener wiring on
/// desktop. On web we just return -1 so the call site sees an
/// "invalid" id and bails before trying to fire IPC.
export function transformCallback<T>(
  callback?: (response: T) => void,
  once?: boolean,
): number {
  void callback;
  void once;
  return -1;
}
