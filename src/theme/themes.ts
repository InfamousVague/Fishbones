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
  | "cipher-light"
  | "cipher-dark"
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
    label: "Libre Dark",
    description:
      "The default dark theme — ghostly seafoam green on near-black glass, with a drifting aurora and halftone-dot splash.",
    monacoTheme: "vs-dark",
  },
  {
    id: "cipher-light",
    label: "Libre Light",
    description:
      "Cool-grey glass on cream paper with the Libre amber accent — daytime layout chrome, brand-orange highlights.",
    monacoTheme: "vs",
  },
  {
    id: "cipher-dark",
    label: "Cipher Dark",
    description:
      "Deep navy chrome with the Libre amber accent — slate-blue text on a near-black app surface, no sidebar lift.",
    monacoTheme: "vs-dark",
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
    description:
      "Clean off-white app chrome with the Libre amber accent (Ayu's stock orange swapped for the brand colour).",
    // Light themes intentionally pair with the DARK Monaco theme:
    // syntax-highlighting palettes designed for white backgrounds
    // tend to be low-saturation pastels that wash out next to the
    // app's chrome, while a dark editor frames the code as a
    // distinct surface and keeps tokens crisp.
    monacoTheme: "vs-dark",
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
    description: "Pastel lavender + green app chrome with dark code editor.",
    // Light app chrome paired with dark Monaco — see the comment on
    // ayu-light for the rationale.
    monacoTheme: "vs-dark",
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

const STORAGE_KEY = "libre:theme";

/// Read the user's stored theme choice. First-run default is the
/// dark theme (Libre Dark) regardless of the OS `prefers-color-scheme`
/// setting — the app's visual identity is dark-first (monochrome code
/// surfaces, accent-on-black brand palette), and users on light-mode
/// OSes were getting a jarring Ayu Light first paint that didn't
/// match any of the marketing screenshots. They can still switch to
/// any of the light themes from Settings; once they do, that choice
/// is stored here and survives reloads.
export function loadTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch {
    /* private mode / SSR — fall through */
  }
  return "default-dark";
}

/// Theme IDs that render as a LIGHT app surface. Used to flip the
/// legacy `data-theme="light"` attribute the base-UI kit reads, and
/// to gate any other "is this a light theme?" logic in the app
/// (Monaco theme picking, Shiki dual-theme variants, image variants).
const LIGHT_THEMES: ReadonlySet<ThemeName> = new Set([
  "ayu-light",
  "catppuccin-latte",
  "cipher-light",
]);

/// Predicate exposed for consumers that need to branch on light vs
/// dark without re-importing the set. Cheap O(1) lookup. Defaults
/// to `false` for unknown names — anything not explicitly tagged
/// light is treated as dark, which is the safer default for code
/// surfaces (light text on dark background reads OK on a dark
/// app; the inverse reads as broken).
export function isLightTheme(name: ThemeName): boolean {
  return LIGHT_THEMES.has(name);
}

/// Apply a theme by setting attributes on <html>. We set BOTH the legacy
/// `data-theme` (light|dark — base kit reads this) and a new
/// `data-theme-name` that our custom themes.css keys off of.
export function applyTheme(name: ThemeName) {
  const meta = THEMES.find((t) => t.id === name) ?? THEMES[0];
  const doc = document.documentElement;
  doc.setAttribute("data-theme-name", meta.id);
  // Keep the base kit happy by also setting the light/dark attribute.
  const isLight = LIGHT_THEMES.has(meta.id);
  doc.setAttribute("data-theme", isLight ? "light" : "dark");
  try {
    localStorage.setItem(STORAGE_KEY, meta.id);
  } catch {
    /* ignore */
  }
}

/// ---- GhostWire accent hue (default-dark only) ----------------------------
/// The default-dark theme's whole palette (accent, white→accent gradients,
/// glows, glass rims, aurora + halftone) derives from a single `--gg-hue`
/// custom property in themes.css. These helpers let Settings change that hue
/// live + persist it. The hue only affects default-dark (the only theme whose
/// CSS reads --gg-hue), but it's stored globally so it survives theme swaps.
const HUE_STORAGE_KEY = "libre:ghostwire-hue";

/// First-run accent hue. 18 = soft peach (≈ #FEA47F).
export const DEFAULT_GG_HUE = 18;

/// Normalise any number into the 0–359 hue range.
function normaliseHue(n: number): number {
  return ((Math.round(n) % 360) + 360) % 360;
}

/// Read the persisted accent hue (0–359), falling back to the pink default.
export function loadHue(): number {
  try {
    const raw = localStorage.getItem(HUE_STORAGE_KEY);
    if (raw != null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return normaliseHue(n);
    }
  } catch {
    /* private mode — fall through */
  }
  return DEFAULT_GG_HUE;
}

/// Apply + persist the accent hue. Writes `--gg-hue` inline on <html>, which
/// overrides the themes.css default and cascades to every hue-derived token,
/// recolouring the default-dark theme instantly.
export function applyHue(hue: number) {
  const h = normaliseHue(hue);
  try {
    document.documentElement.style.setProperty("--gg-hue", String(h));
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(HUE_STORAGE_KEY, String(h));
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
