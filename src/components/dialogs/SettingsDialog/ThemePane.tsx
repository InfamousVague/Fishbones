import { THEMES, type ThemeName } from "../../../theme/themes";

interface ThemePaneProps {
  theme: ThemeName;
  onThemeChange: (next: ThemeName) => void;
}

export default function ThemePane({ theme, onThemeChange }: ThemePaneProps) {
  return (
    <section>
      <h3 className="fishbones-settings-section">Theme</h3>
      <p className="fishbones-settings-blurb">
        Applied immediately. Preference is stored locally; it syncs with
        your machine's light/dark setting only for the default Fishbones themes.
      </p>
      <div className="fishbones-settings-model-group fishbones-settings-model-group--scroll">
        {THEMES.map((t) => (
          <label
            key={t.id}
            className={`fishbones-settings-model ${theme === t.id ? "is-active" : ""}`}
          >
            <input
              type="radio"
              name="fishbones-theme"
              value={t.id}
              checked={theme === t.id}
              onChange={() => onThemeChange(t.id)}
            />
            <div>
              <div className="fishbones-settings-model-label">{t.label}</div>
              <div className="fishbones-settings-model-hint">{t.description}</div>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
