/// Settings control for the learner's default download languages — the set
/// pre-selected in the install picker and fetched by the bulk web seed.
/// English is the base and always on; the rest toggle. Backed by
/// `useDownloadLocales`, so changes take effect immediately everywhere.

import {
  LOCALE_FLAGS,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/data/locales";
import { useDownloadLocales } from "@/hooks/useDownloadLocales";
import { useT } from "@/i18n/i18n";
import "./DownloadLocalesSelect.css";

export default function DownloadLocalesSelect() {
  const t = useT();
  const [selected, setSelected] = useDownloadLocales();
  const set = new Set<Locale>(selected);

  const toggle = (l: Locale) => {
    if (l === "en") return; // base — always included
    const next = new Set(set);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    setSelected([...next]);
  };

  return (
    <div className="libre-dl-locales">
      {SUPPORTED_LOCALES.map((l) => {
        const isEn = l === "en";
        return (
          <label
            key={l}
            className={
              "libre-dl-locales__opt" +
              (isEn ? " libre-dl-locales__opt--required" : "")
            }
          >
            <input
              type="checkbox"
              checked={set.has(l)}
              disabled={isEn}
              onChange={() => toggle(l)}
            />
            <span className="libre-dl-locales__flag" aria-hidden>
              {LOCALE_FLAGS[l]}
            </span>
            <span className="libre-dl-locales__name">{LOCALE_NAMES[l]}</span>
            {isEn && (
              <span className="libre-dl-locales__req">
                {t("installLanguages.englishRequired")}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
