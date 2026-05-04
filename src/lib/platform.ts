/// Single source of truth for "where is this code running".
///
/// `isWeb` / `isDesktop` are inlined at build time via Vite's `define`
/// (see vite.config.ts) so dead-code elimination drops the wrong
/// branch from each bundle. Use them everywhere a code path needs to
/// differ between the Tauri shell and the static-hosted build at
/// `mattssoftware.com/play`.
///
/// Phase 1 of the web-build rollout. Later phases consume this module
/// for:
///   - Phase 2: `storage.ts` picks Tauri SQLite vs IndexedDB.
///   - Phase 3: `runtimes/index.ts` short-circuits desktop-only
///     languages to a `desktopOnly` `RunResult`; library hides
///     ingest / Ollama / toolchain probes.
///   - Phase 4: `useAiChat` swaps Tauri streaming for a direct
///     `fetch` against `api.mattssoftware.com`.
///   - Phase 5: `<InstallBanner>` mounts and uses `downloadUrl()` to
///     pick the OS-appropriate primary CTA.

import type { LanguageId } from "../data/types";

/// Build target — either "desktop" (the Tauri shell) or "web" (the
/// static-hosted build on mattssoftware.com/play). Threaded through
/// Vite's `define` from the `FISHBONES_TARGET` env var, so dev /
/// preview / prod all resolve the same way.
export const TARGET: "desktop" | "web" =
  ((import.meta.env.FISHBONES_TARGET as "desktop" | "web" | undefined) ??
    "desktop");

export const isWeb = TARGET === "web";
export const isDesktop = TARGET === "desktop";

/// `isMobile` — true when the chrome should collapse to a phone-sized
/// layout (single column, bottom tab bar, no sidebar, no AI orb).
///
/// We don't have a separate "mobile" build target; the same Tauri
/// binary ships to iOS and macOS Catalyst. We check at runtime via the
/// CSS-like `pointer:coarse` + `max-width` heuristic, plus a sanity
/// check on `navigator.platform` for the iOS sim. Inlined into a const
/// at first read so the rest of the app can branch on it without a
/// hook.
function detectMobile(): boolean {
  if (typeof window === "undefined") return false;
  // Width is the most reliable signal in a Tauri WKWebView. The desktop
  // Tauri config pins `minWidth: 900` (see tauri.conf.json), so a
  // viewport narrower than 768px is structurally only possible on a
  // phone-sized device. UA / platform sniffing is unreliable inside
  // iOS WKWebView under Tauri 2 — Tauri sets a custom UA that doesn't
  // always contain "iPhone".
  return window.innerWidth < 768;
}

export const isMobile = detectMobile();

/// Languages whose runtime needs local processes / system compilers /
/// macOS-only tooling. On web these short-circuit to a "desktop only"
/// upsell instead of attempting to run.
///
/// Kept in a Set so adding / removing a language is one line. When a
/// new browser-runnable language lands (e.g. someone WASM-compiles a
/// Java VM) just remove it here and the runtime gate stops blocking.
///
/// 2026 expansion notes:
///   - Lua + SQL run fully in-browser (Fengari + sql.js) so they're
///     NOT in this set.
///   - Haskell + Scala + Dart hit a public sandbox over HTTPS — same
///     pattern as Rust + Go — so they're also NOT in this set.
///   - Ruby + Elixir + Move + Cairo + Sway need the host's toolchain
///     for now (we'll vendor ruby.wasm + spin up subprocess runners
///     in a follow-up). Web build short-circuits these via the same
///     upsell banner the system-compiler languages get.
const DESKTOP_ONLY_LANGUAGES = new Set<LanguageId>([
  "c",
  "cpp",
  "java",
  "kotlin",
  "csharp",
  "assembly",
  "swift",
  "ruby",
  "elixir",
  "zig",
  "move",
  "cairo",
  "sway",
]);

/// Whether a language has a runtime that fits in a browser tab on
/// the current build. Always `"full"` on desktop (every runtime is
/// available); on web returns `"upsell"` for the systems-language
/// pack which would need a cloud compile service we haven't built.
export type LanguageSupport = "full" | "upsell";

export function languageSupport(lang: LanguageId): LanguageSupport {
  if (isDesktop) return "full";
  return DESKTOP_ONLY_LANGUAGES.has(lang) ? "upsell" : "full";
}

/// Convenience predicate for the runtime gate in `runtimes/index.ts`.
/// Phase 3 wires this up; Phase 1 just exports it ready to use.
export function canRun(lang: LanguageId): boolean {
  return languageSupport(lang) === "full";
}

/// Detected user OS — drives which download button gets primary
/// styling on the install banner. Falls back to "macos" when nothing
/// matches (the banner shows all platforms either way; this is just
/// which one is the default).
export type DetectedOS = "macos" | "windows" | "linux";

export function detectOS(): DetectedOS {
  if (typeof navigator === "undefined") return "macos";
  // Modern API first; falls back to UA string. `userAgentData` is a
  // typed structural extension we cast to since it's not in lib.dom
  // yet on every TS version we support.
  const data = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = (
    data?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    ""
  ).toLowerCase();
  if (platform.includes("win")) return "windows";
  if (
    platform.includes("linux") ||
    platform.includes("ubuntu") ||
    platform.includes("debian") ||
    platform.includes("fedora")
  ) {
    return "linux";
  }
  return "macos";
}

/// Download targets for the desktop install banner + welcome
/// screen. Both consume this so button labels + URLs live in one
/// place.
///
/// We point each per-OS link at GitHub's "latest release" page
/// scoped to that platform's asset suffix. GitHub redirects
/// `/releases/latest/download/<filename>` to the actual asset on
/// the most recent release, so as long as the desktop-build
/// workflow continues uploading bundles with the same naming, the
/// links stay live without code changes per release.
///
/// Naming follows tauri-action's defaults — `<productName>_<version>`
/// suffixed by the platform/arch. Since the version changes per
/// release we can't hard-code the full filename; instead we direct
/// the user to the release PAGE filtered to their platform via the
/// `?utm_*` query (cosmetic — GitHub ignores it). The page lists
/// every asset; the platform-named asset is at the top.
///
/// If we later want one-click downloads (no release page in
/// between), we'd add a small redirect proxy at
/// api.mattssoftware.com that uses GitHub's API to look up the
/// latest asset URL by suffix.
export interface DownloadTarget {
  os: DetectedOS;
  url: string;
  label: string;
}

const RELEASES_LATEST = "https://github.com/InfamousVague/Fishbones/releases/latest";

export function downloadUrl(): {
  primary: DownloadTarget;
  all: DownloadTarget[];
} {
  const all: DownloadTarget[] = [
    { os: "macos", url: `${RELEASES_LATEST}#macos`, label: "Download for macOS" },
    { os: "windows", url: `${RELEASES_LATEST}#windows`, label: "Download for Windows" },
    { os: "linux", url: `${RELEASES_LATEST}#linux`, label: "Download for Linux" },
  ];
  const detected = detectOS();
  const primary = all.find((t) => t.os === detected) ?? all[0];
  return { primary, all };
}
