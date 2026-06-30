import { isDesktop } from "./platform";

/// Single source for "open this URL outside the app".
///
/// Desktop (Tauri): first try `@tauri-apps/plugin-opener`'s `openUrl`, which
/// hands the URL to the OS default browser. If that ever fails — and it
/// silently did for some installs, which is why "Support us" / Discord didn't
/// open — fall back to our own `open_external_url` command, a direct OS spawn
/// (`open` / `start` / `xdg-open`). The app already spawns child processes for
/// the local runtimes + the relaunch helper, so this path works even where the
/// plugin's command path doesn't. Failures are logged (not swallowed) so the
/// cause shows up in devtools instead of vanishing.
///
/// Web: a `_blank` `window.open` — a NEW tab, not a same-tab navigation, so the
/// SPA's React/IndexedDB state survives.
///
/// Why this matters: the desktop WebView is a one-window-no-back-button
/// surface — letting it navigate to an external URL traps the user with no way
/// back. Routing every external click through here side-steps that.
///
/// Callers can `void openExternal(href)` — there's nothing useful to await on.
export async function openExternal(url: string): Promise<void> {
  if (isDesktop) {
    // Primary: the opener plugin → the OS default browser.
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (e) {
      console.warn(
        "[openExternal] opener plugin failed; trying native open:",
        e,
      );
    }
    // Fallback: a direct OS `open` spawn via our own Rust command.
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url });
      return;
    } catch (e) {
      console.error("[openExternal] native open failed too:", e);
    }
  }
  // Web (or desktop last resort).
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
