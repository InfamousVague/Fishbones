import { useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { search as searchIcon } from "@base/primitives/icon/icons/search";
import "@base/primitives/icon/icon.css";
import { FISHBONES_DOCS } from "../../docs/pages";

/// Docs-mode sidebar body — replaces the course tree when the user is
/// on the docs route. Renders a search input + section/page list driven
/// by `FISHBONES_DOCS`. Selecting a page calls back to App-level state
/// so the main pane (DocsView) re-renders with the matching body.
///
/// Search filter is local — only the sidebar list reacts to it; the
/// main pane keeps showing whatever page is selected. Empty filter =
/// the full list. We compare against title and tagline so a learner
/// looking for "shortcut" finds the keyboard-shortcuts page even
/// though that's not in the title.
export default function DocsSidebarNav({
  activeId,
  onSelect,
}: {
  activeId?: string;
  onSelect?: (pageId: string) => void;
}) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return FISHBONES_DOCS;
    const needle = filter.trim().toLowerCase();
    return FISHBONES_DOCS.map((s) => ({
      ...s,
      pages: s.pages.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          (p.tagline ?? "").toLowerCase().includes(needle),
      ),
    })).filter((s) => s.pages.length > 0);
  }, [filter]);

  return (
    <nav className="fishbones__docs-nav" aria-label="Documentation">
      <div className="fishbones__docs-search">
        <Icon icon={searchIcon} size="xs" color="currentColor" />
        <input
          type="text"
          placeholder="Search docs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
          // Don't autofocus — clicking the Docs nav item shouldn't
          // steal focus from the main pane's keyboard shortcuts. The
          // user can click into the box themselves when they want to
          // search.
        />
      </div>
      <div className="fishbones__docs-nav-body">
        {filtered.map((section) => (
          <div className="fishbones__docs-nav-section" key={section.id}>
            <div className="fishbones__docs-nav-section-title">
              {section.title}
            </div>
            <ul className="fishbones__docs-nav-list">
              {section.pages.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    className={`fishbones__docs-nav-item ${
                      page.id === activeId
                        ? "fishbones__docs-nav-item--active"
                        : ""
                    }`}
                    onClick={() => onSelect?.(page.id)}
                    title={page.tagline}
                  >
                    {page.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="fishbones__docs-nav-empty">
            No pages match "{filter}"
          </div>
        )}
      </div>
    </nav>
  );
}

/// Vertical nav-list row at the top of the sidebar. Icon + label, full
/// width. `active` controls the highlighted pill state for persistent
/// destinations (Profile, Playground) so the learner always knows which
/// main-pane route they're on.
export function SidebarNavItem({
  icon,
  label,
  onClick,
  active,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`fishbones__sidebar-nav-item ${active ? "fishbones__sidebar-nav-item--active" : ""}`}
      onClick={onClick}
    >
      <span className="fishbones__sidebar-nav-icon" aria-hidden>
        <Icon icon={icon} size="sm" color="currentColor" />
      </span>
      <span className="fishbones__sidebar-nav-label">{label}</span>
    </button>
  );
}
