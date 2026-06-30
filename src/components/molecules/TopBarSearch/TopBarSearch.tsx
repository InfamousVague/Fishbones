// TopBar search affordance — visually styled as a search input but
// functionally a button that opens the full CommandPalette. Clicking
// anywhere on the bar (including the trailing ⌘K hint) fires
// `onOpenFullSearch`, which the parent has wired to the same toggle
// Cmd/Ctrl+K already binds.
//
// Why a button (and not a real <input> any more):
//   * The CommandPalette already has its own search input, ranking, and
//     keyboard navigation that handle every result kind (course,
//     lesson, action). Maintaining a parallel dropdown here meant two
//     code paths for the same feature.
//   * Users expect Cmd/Ctrl+K and clicking the search bar to land them
//     in the same place. Routing both through the palette removes a
//     surprise.
//
// Visually we keep the input shape (rounded muted bar with a leading
// magnifying glass and trailing ⌘K kbd hint) so the topbar looks
// familiar. The bar is ~40% of its earlier width so it doesn't
// dominate the topbar — the palette is the real surface.
//
// Props kept for backward compatibility — `courses` and `onOpenLesson`
// are no longer used here (the palette handles them) but earlier
// callers still pass them; rather than changing every call site we
// simply ignore the extras.
import { Icon } from "@base/primitives/icon";
import { search as searchIcon } from "@base/primitives/icon/icons/search";
import "@base/primitives/icon/icon.css";
import {
  ShortcutHint,
  formatShortcutForTitle,
} from "@/components/atoms/ShortcutHint/ShortcutHint";
import { useT } from "@/i18n/i18n";
import type { Course } from "@/data/types";
import "./TopBarSearch.css";

interface Props {
  /** Unused now (kept so existing call sites compile); the palette
   *  builds its own course pool from App.tsx's loaded list. */
  courses?: Course[];
  /** Unused now — see `courses`. The palette routes lesson selection
   *  through the same App-level handler. */
  onOpenLesson?: (courseId: string, lessonId: string) => void;
  /** Required: open the CommandPalette. Wired by App.tsx to
   *  `setPaletteOpen(true)`. */
  onOpenFullSearch?: () => void;
}

export default function TopBarSearch({ onOpenFullSearch }: Props) {
  const t = useT();
  return (
    <div
      className="libre__tbsearch"
      data-tauri-drag-region={false}
    >
      <button
        type="button"
        className="libre__tbsearch-input-row"
        onClick={() => onOpenFullSearch?.()}
        aria-label={t("topBar.searchAriaLabel")}
        title={formatShortcutForTitle(
          t("topBar.searchTooltip"),
          "app.command-palette",
        )}
      >
        <Icon
          icon={searchIcon}
          size="sm"
          color="currentColor"
          className="libre__tbsearch-icon"
        />
        <span className="libre__tbsearch-placeholder">
          {t("topBar.searchPlaceholder")}
        </span>
        {/* Trailing chord chip — same registry-driven label as the
            button's tooltip so the visible hint and the actual
            binding never drift apart. The old hardcoded "⌘K"
            string was wrong on Windows + didn't update if the
            user rebound the action in Settings → Shortcuts. */}
        <ShortcutHint
          actionId="app.command-palette"
          variant="muted"
          className="libre__tbsearch-kbd"
        />
      </button>
    </div>
  );
}
