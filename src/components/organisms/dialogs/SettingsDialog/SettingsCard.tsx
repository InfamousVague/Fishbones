/// Card wrapper for grouping settings rows. Renders the
/// rounded-panel chrome the Cipher pattern uses: subtle border,
/// faint inner-rim highlight, soft drop shadow. Optional title
/// label sits inside the card at the top as a small uppercase
/// chip (e.g. "MASTER" / "WHAT COUNTS" / "DO NOT DISTURB").
///
/// Children are typically a series of `SettingsRow` components.
/// The first row sits flush against the card top (no leading
/// border) and subsequent rows are separated by a hairline rule
/// via the `:not(:first-child)` selector in CSS.

import type { ReactNode } from "react";

interface Props {
  /// Optional uppercase title chip rendered at the top of the
  /// card. When omitted, the card has no header and the first
  /// row sits directly under the top border.
  title?: string;
  children: ReactNode;
}

export default function SettingsCard({ title, children }: Props) {
  return (
    <div className="libre-settings-card">
      {title && <div className="libre-settings-card__title">{title}</div>}
      {children}
    </div>
  );
}

/// Page wrapper for a single settings section. Renders the
/// header (h2 + paragraph blurb) and constrains the column to a
/// readable max-width. Children are a stack of `SettingsCard`s.
///
/// Replaces the old "section > h3 + blurb + content" pattern that
/// every pane reimplements — using `SettingsPage` keeps the
/// spacing + max-width consistent across panes.
interface PageProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function SettingsPage({ title, description, children }: PageProps) {
  return (
    <div className="libre-settings-page">
      <header className="libre-settings-page__head">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </div>
  );
}
