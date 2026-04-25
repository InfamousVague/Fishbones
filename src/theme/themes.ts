/// Theme registry. Each theme overrides the base kit's CSS variables via a
/// `[data-theme-name="…"]` attribute we set on <html>. Monaco gets a matching
/// built-in theme name (vs-dark for the dark themes; future work can define
/// custom Monaco themes to pair more precisely with the app chrome).
///
/// The palettes below are approximations of the popular VSCode themes of the
/// same name. Exact hex values aren't fetchable without the theme JSON, so
/// these are eyeball-close. Edit themes.css directly to refine.

export type ThemeName =
  | "default-dark"
  | "default-light"
  | "synthwave"
  | "claude-code-dark"
  | "ayu-light"
  | "ayu-mirage"
  | "ayu-dark"
  | "catppuccin-latte"
  | "catppuccin-frappe"
  | "catppuccin-macchiato"
  | "catppuccin-mocha"
  | "tokyo-night"
  | "rose-pine"
  | "ubuntu-dark"
  | "absent-contrast"
  | "vesper"
  | "word";

export interface ThemeMeta {
  id: ThemeName;
  label: string;
  description: string;
  /// The theme name Monaco should use. For now every custom theme maps to
  /// vs-dark — wire up Monaco's defineTheme when we're ready to match the
  /// editor palette to the app chrome.
  monacoTheme: "vs" | "vs-dark";
}

export const THEMES: ThemeMeta[] = [
  {
    id: "default-dark",
    label: "Fishbones Dark",
    description: "The default monochrome dark theme.",
    monacoTheme: "vs-dark",
  },
  {
    id: "default-light",
    label: "Fishbones Light",
    description: "System-matched light variant.",
    monacoTheme: "vs",
  },
  {
    id: "synthwave",
    label: "Synesthesia Synthwave",
    description: "Neon magenta + cyan on deep violet. Loud and happy.",
    monacoTheme: "vs-dark",
  },
  {
    id: "claude-code-dark",
    label: "Claude Code Dark",
    description: "Warm terracotta accents on deep brown — Anthropic-flavored.",
    monacoTheme: "vs-dark",
  },
  {
    id: "ayu-light",
    label: "Ayu Light",
    description: "Clean off-white with saturated orange + green syntax.",
    monacoTheme: "vs",
  },
  {
    id: "ayu-mirage",
    label: "Ayu Mirage",
    description: "Muted dusty dark with soft cyan + orange accents.",
    monacoTheme: "vs-dark",
  },
  {
    id: "ayu-dark",
    label: "Ayu Dark",
    description: "Near-black base with warm orange highlights.",
    monacoTheme: "vs-dark",
  },
  {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    description: "Pastel lavender + green on cream. Catppuccin's light flavor.",
    monacoTheme: "vs",
  },
  {
    id: "catppuccin-frappe",
    label: "Catppuccin Frappé",
    description: "Milkier dark — indigo base with soft pastel syntax.",
    monacoTheme: "vs-dark",
  },
  {
    id: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    description: "Middle-dark flavor. Slightly cooler than Mocha.",
    monacoTheme: "vs-dark",
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    description: "Soothing pastel pink-and-lavender on deep indigo.",
    monacoTheme: "vs-dark",
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    description: "Deep midnight blue with electric purple + cyan accents.",
    monacoTheme: "vs-dark",
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    description: "Soft natural palette — rose, gold, foam — on muted plum.",
    monacoTheme: "vs-dark",
  },
  {
    id: "ubuntu-dark",
    label: "Ubuntu Dark",
    description: "Ubuntu aubergine base with the signature warm orange accent.",
    monacoTheme: "vs-dark",
  },
  {
    id: "absent-contrast",
    label: "Absent Contrast",
    description: "Daylerees Rainglow — cool teal accents on slate; sage green for support tokens.",
    monacoTheme: "vs-dark",
  },
  {
    id: "vesper",
    label: "Vesper",
    description: "Rauno Freiberg's monochrome dark — warm peach accents and mint strings on near-black.",
    monacoTheme: "vs-dark",
  },
  {
    id: "word",
    label: "Word",
    description: "Microsoft Word 5.5 for DOS — deep blue document on gray chrome, magenta keywords + cyan constants.",
    monacoTheme: "vs-dark",
  },
];

const STORAGE_KEY = "kata:theme";

/// Read the user's stored theme choice. Falls back to the system preference
/// between the two default variants, so first-run still feels right.
export function loadTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch {
    /* private mode / SSR — fall through */
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "default-dark" : "default-light";
}

/// Apply a theme by setting attributes on <html>. We set BOTH the legacy
/// `data-theme` (light|dark — base kit reads this) and a new
/// `data-theme-name` that our custom themes.css keys off of.
export function applyTheme(name: ThemeName) {
  const meta = THEMES.find((t) => t.id === name) ?? THEMES[0];
  const doc = document.documentElement;
  doc.setAttribute("data-theme-name", meta.id);
  // Keep the base kit happy by also setting the light/dark attribute.
  const isLight = meta.id === "default-light";
  doc.setAttribute("data-theme", isLight ? "light" : "dark");
  try {
    localStorage.setItem(STORAGE_KEY, meta.id);
  } catch {
    /* ignore */
  }
}

/// Read the currently-applied theme from <html data-theme-name>. Used by
/// components (like Monaco) that need to pick up theme changes without being
/// in the settings dialog's direct state.
export function readActiveTheme(): ThemeName {
  const attr = document.documentElement.getAttribute("data-theme-name") as ThemeName | null;
  if (attr && THEMES.some((t) => t.id === attr)) return attr;
  return loadTheme();
}
