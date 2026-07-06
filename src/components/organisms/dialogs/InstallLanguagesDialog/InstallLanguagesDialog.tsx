/// Shown when a learner installs a book that ships translations, so they
/// choose which languages to download rather than pulling every locale.
/// English is the authoring base and always included; the app's current
/// language is pre-checked when the book offers it. The selected set is
/// handed back to the install handler, which prunes the fetched course to
/// those locales (`stripCourseToLocales`) before persisting — so the reader's
/// per-book language picker later offers exactly what was downloaded.

import { useState } from "react";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import { LOCALE_FLAGS, LOCALE_NAMES, type Locale } from "@/data/locales";
import { useDownloadLocales } from "@/hooks/useDownloadLocales";
import { useT } from "@/i18n/i18n";
import "./InstallLanguagesDialog.css";

interface Props {
  /// Book title — woven into the description.
  title: string;
  /// Languages the book is available in (EN-first). English is always
  /// present + required; the rest are opt-in.
  locales: Locale[];
  /// Per-locale download-overlay sizes (bytes), for the "+X KB" hint.
  localeSizes?: Partial<Record<Locale, number>>;
  /// Locales to pre-check. Passed by the "Additional languages" flow on an
  /// already-installed book (the locales already on disk). When omitted (a
  /// fresh Discover install) we fall back to the app's download-language
  /// default. English is always added regardless.
  preselected?: Locale[];
  onCancel: () => void;
  onConfirm: (selected: Locale[]) => void;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export default function InstallLanguagesDialog({
  title,
  locales,
  localeSizes,
  preselected,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT();
  const [downloadLocales] = useDownloadLocales();
  // English always kept. Seed the checkboxes with the explicit `preselected`
  // set when given (the "Additional languages" flow passes the book's
  // already-installed locales); otherwise fall back to the app's
  // download-language default. Only ever pre-check locales the book offers.
  const [selected, setSelected] = useState<Set<Locale>>(() => {
    const init = new Set<Locale>(["en"]);
    const seed = preselected ?? downloadLocales;
    for (const l of seed) if (locales.includes(l)) init.add(l);
    return init;
  });

  const toggle = (l: Locale) => {
    if (l === "en") return; // required — can't be unchecked
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  };

  return (
    <ModalBackdrop onDismiss={onCancel} zIndex={200}>
      <div
        className="libre-install-langs-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="libre-install-langs-title"
      >
        <div className="libre-install-langs-title" id="libre-install-langs-title">
          {t("installLanguages.title")}
        </div>
        <div className="libre-install-langs-description">
          {t("installLanguages.description", { title })}
        </div>
        <div className="libre-install-langs-list">
          {locales.map((l) => {
            const isEn = l === "en";
            return (
              <label
                key={l}
                className={
                  "libre-install-langs-option" +
                  (isEn ? " libre-install-langs-option--required" : "")
                }
              >
                <input
                  type="checkbox"
                  checked={selected.has(l)}
                  disabled={isEn}
                  onChange={() => toggle(l)}
                />
                <span className="libre-install-langs-flag" aria-hidden>
                  {LOCALE_FLAGS[l]}
                </span>
                <span className="libre-install-langs-name">
                  {LOCALE_NAMES[l]}
                </span>
                {isEn ? (
                  <span className="libre-install-langs-required">
                    {t("installLanguages.englishRequired")}
                  </span>
                ) : (
                  localeSizes?.[l] != null && (
                    <span className="libre-install-langs-size">
                      +{formatBytes(localeSizes[l]!)}
                    </span>
                  )
                )}
              </label>
            );
          })}
        </div>
        <div className="libre-install-langs-actions">
          <button
            type="button"
            className="libre-install-langs-btn"
            onClick={onCancel}
          >
            {t("installLanguages.cancel")}
          </button>
          <button
            type="button"
            className="libre-install-langs-btn libre-install-langs-btn--primary"
            onClick={() => onConfirm([...selected])}
          >
            {t("installLanguages.download")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
