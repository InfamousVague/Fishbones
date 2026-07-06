/// Data-driven catalogue of the Settings dialog's panes. The nav
/// rail, the search filter, the body's render switch, and any
/// future deep-link / URL-fragment scheme all derive their state
/// from this one table.
///
/// Previously each new pane meant editing five places: the union
/// type, the inline JSX in the rail, the body's `if (section === …)`
/// ladder, the hint copy, and an icon import you'd inevitably
/// forget. Pulling everything into a single array means new panes
/// are a single object literal, search "just works" because every
/// pane registers its own searchable vocabulary alongside its
/// definition, and grouping is purely a render-time concern.
///
/// One thing this module deliberately doesn't do: render the pane
/// bodies. Those still live in their own components (AiPane.tsx,
/// ShortcutsPane.tsx, etc.) and the dialog wires them up by `id`.
/// Keeping the table render-free means it can be imported from a
/// search-only surface (a future command-palette setting jump-list)
/// without dragging the heavy pane bodies along.

import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { palette } from "@base/primitives/icon/icons/palette";
import { volume2 } from "@base/primitives/icon/icons/volume-2";
import { vibrate } from "@base/primitives/icon/icons/vibrate";
import { keyboard } from "@base/primitives/icon/icons/keyboard";
import { settings2 } from "@base/primitives/icon/icons/settings-2";
import { user } from "@base/primitives/icon/icons/user";
import { users } from "@base/primitives/icon/icons/users";
import { database } from "@base/primitives/icon/icons/database";
import { terminal } from "@base/primitives/icon/icons/terminal";

/// Every pane the dialog can render. The body's `if (section === …)`
/// ladder still gates the actual JSX, so keep this in lockstep with
/// the render switch in SettingsDialog.tsx.
export type PaneId =
  | "general"
  | "ai"
  | "theme"
  | "sounds"
  | "haptics"
  | "shortcuts"
  | "data"
  | "developer"
  | "accounts"
  | "account";

/// Top-level groupings shown as small headers in the nav rail. The
/// order here is the order they appear top-to-bottom. Each group
/// title is rendered ABOVE its panes, not inside a collapsible
/// — at 10 panes the dialog isn't tall enough to need collapse,
/// and a static header is easier to scan.
export type GroupId = "app" | "ai" | "cloud" | "advanced";

export interface GroupDef {
  id: GroupId;
  /// i18n key — resolved via `t()` by the rendering component.
  label: string;
}

export const GROUPS: ReadonlyArray<GroupDef> = [
  { id: "app", label: "settings.navGroupApp" },
  { id: "ai", label: "settings.navGroupAi" },
  { id: "cloud", label: "settings.navGroupCloud" },
  { id: "advanced", label: "settings.navGroupAdvanced" },
];

export interface PaneDef {
  id: PaneId;
  group: GroupId;
  /// i18n key for the pane's title — resolved via `t()` by the
  /// rendering component (this module stays hook-free).
  label: string;
  /// i18n key for the one-line summary shown under the label in
  /// the rail. Should resolve to something scannable at a glance —
  /// "what does this section contain?" in 4-7 words.
  hint: string;
  /// Lucide icon component imported at the top of this file. Used
  /// both in the nav rail and as the pane's title icon in the
  /// body header.
  icon: string;
  /// Extra terms the search filter should match against beyond the
  /// label + hint. Use this for vocabulary the user might reach
  /// for that doesn't appear in the visible label — "anthropic"
  /// and "claude" for the AI pane, "mute" and "sfx" for Sounds.
  /// Lowercase by convention; the matcher lower-cases the query
  /// before comparing.
  searchTerms: ReadonlyArray<string>;
}

export const PANES: ReadonlyArray<PaneDef> = [
  // ── App ─────────────────────────────────────────────────────────
  {
    id: "general",
    group: "app",
    label: "settings.general",
    hint: "settings.paneHintGeneral",
    icon: settings2,
    searchTerms: ["version", "update", "auto-update", "build", "release", "about"],
  },
  {
    id: "theme",
    group: "app",
    label: "settings.theme",
    hint: "settings.paneHintTheme",
    icon: palette,
    searchTerms: [
      "color",
      "colour",
      "dark",
      "light",
      "appearance",
      "language",
      "locale",
      "translation",
      "monaco",
    ],
  },
  {
    id: "sounds",
    group: "app",
    label: "settings.soundsTitle",
    hint: "settings.paneHintSounds",
    icon: volume2,
    searchTerms: ["audio", "mute", "volume", "sfx", "noise", "chime", "click"],
  },
  {
    id: "haptics",
    group: "app",
    label: "settings.paneHaptics",
    hint: "settings.paneHintHaptics",
    icon: vibrate,
    searchTerms: [
      "buzz",
      "vibration",
      "tactile",
      "feedback",
      "rumble",
      "taptic",
      "mobile",
      "phone",
      "intensity",
    ],
  },
  {
    id: "shortcuts",
    group: "app",
    label: "settings.shortcuts",
    hint: "settings.paneHintShortcuts",
    icon: keyboard,
    searchTerms: [
      "key",
      "binding",
      "hotkey",
      "rebind",
      "cmd",
      "ctrl",
      "shortcut",
      "chord",
    ],
  },

  // ── AI ──────────────────────────────────────────────────────────
  {
    id: "ai",
    group: "ai",
    label: "settings.paneAiApi",
    hint: "settings.paneHintAi",
    icon: sparkles,
    searchTerms: [
      "anthropic",
      "claude",
      "openai",
      "gpt",
      "api",
      "key",
      "model",
      "tutor",
      "assistant",
      "llm",
    ],
  },

  // ── Cloud ───────────────────────────────────────────────────────
  {
    id: "accounts",
    group: "cloud",
    label: "settings.accountsTitle",
    hint: "settings.paneHintAccounts",
    icon: users,
    searchTerms: [
      "account",
      "accounts",
      "profile",
      "profiles",
      "sign in",
      "switch",
      "multiple",
      "separate",
      "isolate",
      "workspace",
      "family",
    ],
  },
  {
    id: "account",
    group: "cloud",
    label: "settings.account",
    hint: "settings.paneHintAccount",
    icon: user,
    searchTerms: [
      "sign in",
      "sign out",
      "login",
      "logout",
      "profile",
      "delete account",
      "google",
      "apple",
      "email",
      "password",
    ],
  },

  // ── Advanced ────────────────────────────────────────────────────
  {
    // Combined "Data & storage" pane. Replaces the previously-
    // separate `data`, `sync`, and `diagnostics` panes — they
    // were three short rails entries that all answered some
    // version of "where is my stuff stored?", so folding them
    // into one panel matches the way the user actually thinks
    // about storage. The body groups the three concerns into
    // distinct cards (Sync · Storage · Toolchains) so each
    // surface is still discoverable.
    id: "data",
    group: "advanced",
    label: "settings.dataAndStorage",
    hint: "settings.paneHintData",
    icon: database,
    searchTerms: [
      "cache",
      "reset",
      "start fresh",
      "wipe",
      "courses",
      "library",
      "storage",
      "indexeddb",
      "sqlite",
      "cloud",
      "progress",
      "pull",
      "push",
      "diff",
      "resync",
      "websocket",
      "ws",
      "realtime",
      "sync",
      "toolchain",
      "compiler",
      "rustc",
      "go",
      "node",
      "python",
      "swift",
      "diagnostic",
      "probe",
      "install",
      "resources",
    ],
  },
  {
    id: "developer",
    group: "advanced",
    label: "settings.developer",
    hint: "settings.paneHintDeveloper",
    icon: terminal,
    searchTerms: [
      "console",
      "log",
      "debug",
      "celebration",
      "confetti",
      "tester",
      "dev",
      "flag",
    ],
  },
];

/// Helper: which panes survive a given search query? Returns the
/// unfiltered list when `query` is empty so callers don't have to
/// branch.
///
/// Match logic: case-insensitive substring against the joined
/// haystack of `label + hint + searchTerms`. We don't do fuzzy
/// matching here — the search vocabulary is small enough (~10
/// panes, ~80 total terms) that exact substring is plenty, and
/// fuzzy would surface false positives ("ac" matching "Account",
/// "Cache", AND "Account" again via "delete account").
///
/// Account pane is included in the table but the dialog gates its
/// visibility on the `accountAvailable` flag (web build with no
/// sign-in path hides it). The filter doesn't care about that —
/// the caller is responsible for first slicing the list to "panes
/// the user can actually open" before calling here.
export function filterPanes(
  panes: ReadonlyArray<PaneDef>,
  query: string,
): ReadonlyArray<PaneDef> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return panes;
  return panes.filter((p) => {
    const haystack = [p.label, p.hint, ...p.searchTerms]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/// Helper: group a (possibly filtered) pane list into its category
/// buckets, dropping any group that ended up with zero panes after
/// the filter. Used by the nav rail to render category headers
/// without empty sections under a search query.
export function groupPanes(
  panes: ReadonlyArray<PaneDef>,
): ReadonlyArray<{ group: GroupDef; panes: ReadonlyArray<PaneDef> }> {
  return GROUPS.map((group) => ({
    group,
    panes: panes.filter((p) => p.group === group.id),
  })).filter((g) => g.panes.length > 0);
}

/// Lookup helper — used by the title bar inside the body to render
/// the active pane's icon + label together.
export function getPane(id: PaneId): PaneDef | undefined {
  return PANES.find((p) => p.id === id);
}
