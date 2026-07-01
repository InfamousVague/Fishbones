/// Post-update "What's new" modal. Pops once after the app updates to
/// a new version (gated by useChangelogGate). Shows the curated
/// highlights for the version, or a generic line + a link to the full
/// GitHub release notes when there's no curated entry.
///
/// Chrome is localized (title / buttons); the highlight bullets are
/// English release-note content (see data/changelog.ts).

import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import { Icon } from "@base/primitives/icon";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { useT } from "@/i18n/i18n";
import { openExternal } from "@/lib/openExternal";
import { type ChangelogEntry } from "@/data/changelog";
import "./ChangelogModal.css";

const RELEASES_BASE =
  "https://github.com/InfamousVague/Libre.academy/releases/tag/v";

interface Props {
  entry: ChangelogEntry;
  onDismiss: () => void;
}

export default function ChangelogModal({ entry, onDismiss }: Props) {
  const t = useT();
  return (
    <ModalBackdrop onDismiss={onDismiss} zIndex={10020} className="libre-changelog-backdrop">
      <div
        className="libre-changelog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="libre-changelog-title"
      >
        <div className="libre-changelog__head">
          <span className="libre-changelog__mark" aria-hidden>
            <Icon icon={sparkles} size="lg" color="currentColor" />
          </span>
          <span className="libre-changelog__eyebrow">{t("changelog.eyebrow")}</span>
          <h2 id="libre-changelog-title" className="libre-changelog__title">
            {t("changelog.title", { version: entry.version })}
          </h2>
        </div>

        {entry.highlights.length > 0 ? (
          <ul className="libre-changelog__list">
            {entry.highlights.map((h, i) => (
              <li key={i} className="libre-changelog__item">
                {h}
              </li>
            ))}
          </ul>
        ) : (
          <p className="libre-changelog__generic">
            {t("changelog.generic", { version: entry.version })}
          </p>
        )}

        <div className="libre-changelog__actions">
          <button
            type="button"
            className="libre-changelog__link"
            onClick={() => void openExternal(`${RELEASES_BASE}${entry.version}`)}
          >
            {t("changelog.viewOnGitHub")}
          </button>
          <button
            type="button"
            className="libre-changelog__cta"
            onClick={onDismiss}
            autoFocus
          >
            {t("changelog.gotIt")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
