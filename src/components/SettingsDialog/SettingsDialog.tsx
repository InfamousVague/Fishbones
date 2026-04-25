import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@base/primitives/icon";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import "@base/primitives/icon/icon.css";
import { THEMES, applyTheme, loadTheme, type ThemeName } from "../../theme/themes";
import "./SettingsDialog.css";

interface Props {
  onDismiss: () => void;
}

interface Settings {
  anthropic_api_key: string | null;
  anthropic_model: string;
  openai_api_key: string | null;
}

type SectionId = "ai" | "theme" | "data";

const SECTIONS: Array<{ id: SectionId; label: string; hint: string }> = [
  { id: "ai", label: "AI & API", hint: "Anthropic key + model" },
  { id: "theme", label: "Theme", hint: "App + editor colors" },
  { id: "data", label: "Data", hint: "Caches + courses" },
];

const MODEL_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  {
    id: "claude-sonnet-4-5",
    label: "Sonnet 4.5 (balanced)",
    hint: "Default. ~$3 in / $15 out per 1M tokens. Great for most books.",
  },
  {
    id: "claude-opus-4-5",
    label: "Opus 4.5 (top quality)",
    hint: "~$15 in / $75 out per 1M tokens. ~5× cost, best pedagogy + test design.",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5 (fastest)",
    hint: "~$1 in / $5 out per 1M tokens. Quick + cheap but weaker structured output.",
  },
];

/// Two-column settings dialog with a left-rail section nav and a right-side
/// scrollable pane. Keeps the panel at a bounded max-height so additional
/// sections never push the Save button off the screen.
export default function SettingsDialog({ onDismiss }: Props) {
  const [section, setSection] = useState<SectionId>("ai");
  const [apiKey, setApiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [model, setModel] = useState<string>("claude-sonnet-4-5");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearingCourses, setClearingCourses] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [confirmClearCourses, setConfirmClearCourses] = useState(false);
  const [theme, setTheme] = useState<ThemeName>(() => loadTheme());

  function handleThemeChange(next: ThemeName) {
    setTheme(next);
    applyTheme(next);
  }

  useEffect(() => {
    invoke<Settings>("load_settings")
      .then((s) => {
        setApiKey(s.anthropic_api_key ?? "");
        setOpenaiKey(s.openai_api_key ?? "");
        if (s.anthropic_model) setModel(s.anthropic_model);
      })
      .catch(() => { /* not in tauri — ignore */ });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await invoke("save_settings", {
        settings: {
          anthropic_api_key: apiKey.trim() || null,
          anthropic_model: model,
          openai_api_key: openaiKey.trim() || null,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function clearAllCourses() {
    setClearingCourses(true);
    setError(null);
    try {
      const entries = await invoke<Array<{ id: string }>>("list_courses");
      for (const e of entries) {
        await invoke("delete_course", { courseId: e.id });
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setClearingCourses(false);
    }
  }

  async function clearIngestCache() {
    setClearingCache(true);
    setError(null);
    try {
      await invoke("cache_clear", { bookId: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingCache(false);
    }
  }

  return (
    <div className="fishbones-settings-backdrop" onClick={onDismiss}>
      <div className="fishbones-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="fishbones-settings-header">
          <span className="fishbones-settings-title">Settings</span>
          <button className="fishbones-settings-close" onClick={onDismiss}>×</button>
        </div>

        <div className="fishbones-settings-columns">
          <nav className="fishbones-settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`fishbones-settings-nav-item ${
                  section === s.id ? "fishbones-settings-nav-item--active" : ""
                }`}
                onClick={() => setSection(s.id)}
              >
                <span className="fishbones-settings-nav-label">{s.label}</span>
                <span className="fishbones-settings-nav-hint">{s.hint}</span>
              </button>
            ))}
          </nav>

          <div className="fishbones-settings-body">
            {section === "ai" && (
              <section>
                <h3 className="fishbones-settings-section">AI-assisted ingest</h3>
                <p className="fishbones-settings-blurb">
                  Paste an Anthropic API key to enable Claude-powered structuring
                  when you import a book. Without a key, the import falls back to
                  the deterministic splitter (chapter/section breaks only).
                </p>
                <label className="fishbones-settings-field">
                  <span className="fishbones-settings-label">Anthropic API key</span>
                  <input
                    type="password"
                    className="fishbones-settings-input"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
                <p className="fishbones-settings-note">
                  Stored at <code>&lt;app_data_dir&gt;/settings.json</code>. Never
                  leaves your machine except in requests to api.anthropic.com.
                </p>

                <label className="fishbones-settings-field">
                  <span className="fishbones-settings-label">Model</span>
                  <div className="fishbones-settings-model-group">
                    {MODEL_OPTIONS.map((opt) => (
                      <label
                        key={opt.id}
                        className={`fishbones-settings-model ${model === opt.id ? "is-active" : ""}`}
                      >
                        <input
                          type="radio"
                          name="anthropic-model"
                          value={opt.id}
                          checked={model === opt.id}
                          onChange={() => setModel(opt.id)}
                        />
                        <div>
                          <div className="fishbones-settings-model-label">{opt.label}</div>
                          <div className="fishbones-settings-model-hint">{opt.hint}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </label>

                {/* Separate second provider for AI cover-art generation.
                    Anthropic doesn't ship image generation, so we use
                    OpenAI's gpt-image-1. Optional — without a key the
                    cover-art button in Course Settings surfaces a
                    friendly "add a key" message instead of crashing. */}
                <h3 className="fishbones-settings-section fishbones-settings-section--sub">
                  AI cover art
                </h3>
                <p className="fishbones-settings-blurb">
                  Optional. When set, a <strong>Generate artwork with AI</strong>{" "}
                  button appears in Course Settings → Appearance. Uses OpenAI's{" "}
                  <code>gpt-image-1</code> model (~$0.04 per cover) with a fixed
                  editorial style so every book in your library shares the same
                  visual language.
                </p>
                <label className="fishbones-settings-field">
                  <span className="fishbones-settings-label">OpenAI API key</span>
                  <input
                    type="password"
                    className="fishbones-settings-input"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
                <p className="fishbones-settings-note">
                  Stored next to the Anthropic key in{" "}
                  <code>&lt;app_data_dir&gt;/settings.json</code>. Only used for
                  image requests to api.openai.com.
                </p>
              </section>
            )}

            {section === "theme" && (
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
                        onChange={() => handleThemeChange(t.id)}
                      />
                      <div>
                        <div className="fishbones-settings-model-label">{t.label}</div>
                        <div className="fishbones-settings-model-hint">{t.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {section === "data" && (
              <section>
                <h3 className="fishbones-settings-section">Data</h3>
                <p className="fishbones-settings-blurb">
                  Clears local content. Your API key and preferences stay.
                </p>
                <div className="fishbones-settings-data-row">
                  <div>
                    <div className="fishbones-settings-data-label">Ingest cache</div>
                    <div className="fishbones-settings-data-hint">
                      Clearing forces the next AI import to re-call Claude for every stage.
                    </div>
                  </div>
                  <button
                    className="fishbones-settings-danger"
                    onClick={clearIngestCache}
                    disabled={clearingCache}
                  >
                    {clearingCache ? "…" : "Clear cache"}
                  </button>
                </div>
                <div className="fishbones-settings-data-row">
                  <div>
                    <div className="fishbones-settings-data-label">All courses + progress</div>
                    <div className="fishbones-settings-data-hint">
                      Deletes every course from disk and resets lesson completion. Cannot be undone.
                    </div>
                  </div>
                  {confirmClearCourses ? (
                    <div className="fishbones-settings-confirm">
                      <button
                        className="fishbones-settings-secondary"
                        onClick={() => setConfirmClearCourses(false)}
                        disabled={clearingCourses}
                      >
                        Cancel
                      </button>
                      <button
                        className="fishbones-settings-danger"
                        onClick={clearAllCourses}
                        disabled={clearingCourses}
                      >
                        {clearingCourses ? "Clearing…" : "Really clear"}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="fishbones-settings-danger"
                      onClick={() => setConfirmClearCourses(true)}
                    >
                      Clear all courses
                    </button>
                  )}
                </div>
              </section>
            )}

            {error && <div className="fishbones-settings-error">{error}</div>}
          </div>
        </div>

        {/* Footer sits outside the scroll body so the Save button is always
            visible regardless of section length. Only the AI section has a
            committable field; on other sections the Save button is hidden
            to avoid implying unsaved state. */}
        <div className="fishbones-settings-footer">
          {saved && (
            <span className="fishbones-settings-saved">
              <Icon icon={checkIcon} size="xs" color="currentColor" />
              saved
            </span>
          )}
          {section === "ai" && (
            <button
              className="fishbones-settings-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          {section !== "ai" && (
            <span className="fishbones-settings-footer-hint">
              Changes on this tab apply immediately.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
