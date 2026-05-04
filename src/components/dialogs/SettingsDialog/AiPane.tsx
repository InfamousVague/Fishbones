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

interface AiPaneProps {
  apiKey: string;
  onApiKeyChange: (next: string) => void;
  openaiKey: string;
  onOpenaiKeyChange: (next: string) => void;
  model: string;
  onModelChange: (next: string) => void;
}

export default function AiPane({
  apiKey,
  onApiKeyChange,
  openaiKey,
  onOpenaiKeyChange,
  model,
  onModelChange,
}: AiPaneProps) {
  return (
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
          onChange={(e) => onApiKeyChange(e.target.value)}
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
                onChange={() => onModelChange(opt.id)}
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
          onChange={(e) => onOpenaiKeyChange(e.target.value)}
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
  );
}
