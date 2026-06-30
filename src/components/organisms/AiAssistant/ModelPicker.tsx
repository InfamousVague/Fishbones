/// Local Ollama model picker — lets the learner choose which model
/// the assistant runs, and pull new ones inline.
///
/// Self-contained: it does its OWN Ollama probe (which models are
/// installed) so the only props it needs are the current selection
/// + an onSelect callback. Works on BOTH surfaces:
///
///   - Desktop (Tauri): probes via the `ai_chat_probe` command and
///     can pull new models via `ai_chat_pull_model` (`ollama pull`).
///   - Web / mobile: the Tauri commands aren't available (they'd
///     throw), so we probe the configured Ollama host's
///     `/api/tags` over fetch (mirroring useAiChatRemote) and
///     hide the pull buttons — remote installs happen on the host
///     machine, not from the browser.
///
/// Rows come from the curated registry (`lib/ai/models.ts`), split
/// into a recommended set (shown by default) and the rest (behind a
/// "show all" toggle). Any model the user pulled by hand that ISN'T
/// in the registry — including the currently-selected one — is
/// surfaced as a "custom" row so it's always selectable + visible.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { check } from "@base/primitives/icon/icons/check";
import { download } from "@base/primitives/icon/icons/download";
import { triangleAlert } from "@base/primitives/icon/icons/triangle-alert";
import "@base/primitives/icon/icon.css";
import {
  OLLAMA_MODELS,
  isModelInstalled,
  type OllamaModelMeta,
} from "@/lib/ai/models";
import { isDesktop } from "@/lib/platform";
import { probeInstalledModels, pullModel } from "@/lib/ai/ollamaInstall";
import "./ModelPicker.css";

interface Props {
  currentModel: string;
  onSelect: (id: string) => void;
}

export default function ModelPicker({ currentModel, onSelect }: Props) {
  const [installed, setInstalled] = useState<string[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullError, setPullError] = useState<{ id: string; msg: string } | null>(
    null,
  );
  // Bumped whenever the user makes a NEW selection — lets a pull's
  // auto-select bail if the user picked something else mid-download
  // (so a slow pull can't silently steal the active model back).
  const selectionGen = useRef(0);

  // Pulls only work on desktop (the `ollama pull` shell command).
  // On web the host machine does the install; we show a hint
  // instead of a Get button.
  const canPull = isDesktop;

  const probe = useCallback(async () => {
    try {
      const r = await probeInstalledModels(currentModel);
      setReachable(r.reachable);
      setInstalled(r.models);
      setProbeError(r.error);
    } catch (e) {
      setReachable(false);
      setProbeError(e instanceof Error ? e.message : String(e));
    }
  }, [currentModel]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const select = useCallback(
    (id: string) => {
      selectionGen.current += 1;
      onSelect(id);
    },
    [onSelect],
  );

  const handlePull = useCallback(
    async (id: string) => {
      const genAtStart = selectionGen.current;
      setPulling(id);
      setPullError(null);
      try {
        const r = await pullModel(id);
        if (r.success) {
          await probe();
          // Auto-select the freshly-pulled model — UNLESS the user
          // changed their selection while it downloaded.
          if (selectionGen.current === genAtStart) onSelect(id);
        } else {
          setPullError({ id, msg: r.error });
        }
      } catch (e) {
        setPullError({ id, msg: e instanceof Error ? e.message : String(e) });
      } finally {
        setPulling(null);
      }
    },
    [probe, onSelect],
  );

  // Custom (hand-pulled) models not in the registry — surface so
  // they're selectable. ALWAYS include the current model if it's a
  // custom tag, even when the probe couldn't confirm it's installed
  // (offline, or deleted in Ollama) so the user's actual selection
  // never vanishes from the list.
  const customTags = new Set(
    installed.filter(
      (tag) => !OLLAMA_MODELS.some((m) => isModelInstalled(m.id, [tag])),
    ),
  );
  if (
    currentModel &&
    !OLLAMA_MODELS.some((m) => m.id === currentModel) &&
    !installed.some((tag) => isModelInstalled(currentModel, [tag]))
  ) {
    customTags.add(currentModel);
  }
  const customInstalled = Array.from(customTags);

  const visible = showAll
    ? OLLAMA_MODELS
    : OLLAMA_MODELS.filter(
        (m) =>
          m.recommended ||
          isModelInstalled(m.id, installed) ||
          m.id === currentModel,
      );

  return (
    <div className="libre-model-picker">
      <div className="libre-model-picker-head">
        <span className="libre-model-picker-title">Assistant model</span>
        {reachable === false && (
          <span
            className="libre-model-picker-offline"
            role="status"
            aria-live="polite"
            title={probeError ?? ""}
          >
            Ollama offline
          </span>
        )}
      </div>
      <p className="libre-model-picker-sub">
        The local model that powers chat + agent.{" "}
        {canPull
          ? "Installed models switch instantly; others download on demand."
          : "Models installed on your Ollama host can be selected here."}
      </p>

      <div className="libre-model-picker-list">
        {visible.map((m) => (
          <ModelRow
            key={m.id}
            meta={m}
            selected={m.id === currentModel}
            installed={isModelInstalled(m.id, installed)}
            reachable={reachable}
            canPull={canPull}
            pulling={pulling === m.id}
            pullDisabled={pulling !== null}
            error={pullError?.id === m.id ? pullError.msg : null}
            onSelect={() => select(m.id)}
            onPull={() => handlePull(m.id)}
          />
        ))}

        {customInstalled.map((tag) => {
          const tagInstalled = installed.some((t) => isModelInstalled(tag, [t]));
          return (
            <div
              key={tag}
              className={
                "libre-model-row" +
                (tag === currentModel ? " libre-model-row--selected" : "") +
                (tagInstalled ? "" : " libre-model-row--remote")
              }
              role="button"
              tabIndex={0}
              onClick={() => select(tag)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select(tag);
                }
              }}
            >
              <span className="libre-model-row-main">
                <span className="libre-model-row-label">{tag}</span>
                <span className="libre-model-row-blurb">
                  Custom model{tagInstalled ? " you pulled in Ollama." : " — not detected on the host."}
                </span>
              </span>
              <span className="libre-model-row-action">
                {tag === currentModel ? (
                  <Icon icon={check} size="sm" color="currentColor" />
                ) : (
                  <span className="libre-model-row-use">Use</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {OLLAMA_MODELS.length > visible.length && (
        <button
          type="button"
          className="libre-model-picker-toggle"
          onClick={() => setShowAll(true)}
        >
          Show all {OLLAMA_MODELS.length} models
        </button>
      )}
      {showAll && (
        <button
          type="button"
          className="libre-model-picker-toggle"
          onClick={() => setShowAll(false)}
        >
          Show fewer
        </button>
      )}
    </div>
  );
}

function ModelRow({
  meta,
  selected,
  installed,
  reachable,
  canPull,
  pulling,
  pullDisabled,
  error,
  onSelect,
  onPull,
}: {
  meta: OllamaModelMeta;
  selected: boolean;
  installed: boolean;
  reachable: boolean | null;
  canPull: boolean;
  pulling: boolean;
  pullDisabled: boolean;
  error: string | null;
  onSelect: () => void;
  onPull: () => void;
}) {
  // The current model is selected but NOT confirmed installed (it
  // was deleted in Ollama, or the daemon is offline so we can't
  // verify). Don't show a triumphant check — warn + offer a re-pull.
  const selectedButMissing = selected && !installed;

  return (
    <div
      className={
        "libre-model-row" +
        (selected ? " libre-model-row--selected" : "") +
        (installed ? "" : " libre-model-row--remote") +
        (selectedButMissing ? " libre-model-row--warn" : "")
      }
      role={installed ? "button" : undefined}
      tabIndex={installed ? 0 : undefined}
      onClick={installed ? onSelect : undefined}
      onKeyDown={
        installed
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
    >
      <span className="libre-model-row-main">
        <span className="libre-model-row-label">
          {meta.label}
          <span
            className={`libre-model-badge libre-model-badge--${meta.role}`}
            title={meta.role === "code" ? "Code-specialist model" : "General-purpose model"}
          >
            {meta.role === "code" ? "code" : "general"}
          </span>
          <span
            className={`libre-model-badge libre-model-badge--${meta.tools}`}
            title={
              meta.tools === "native"
                ? "Native tool-calling — best for agent mode."
                : "No native tools — agent mode uses Libre's recovery layers (less reliable on long builds). Great for chat."
            }
          >
            {meta.tools === "native" ? "tools ✓" : "tools ~"}
          </span>
          {selectedButMissing && (
            <span
              className="libre-model-badge libre-model-badge--warn"
              title="Selected but not detected — re-pull or pick another."
            >
              not installed
            </span>
          )}
        </span>
        <span className="libre-model-row-blurb">{meta.blurb}</span>
        <span className="libre-model-row-meta">
          {meta.params} · {meta.sizeGb} GB download · ~{meta.ramGb} GB RAM
        </span>
        {error && (
          <span className="libre-model-row-error" role="alert">
            {error}
          </span>
        )}
      </span>
      <span className="libre-model-row-action">
        {installed && selected ? (
          <span className="libre-model-row-selected-mark" title="Selected">
            <Icon icon={check} size="sm" color="currentColor" />
          </span>
        ) : installed ? (
          <span className="libre-model-row-use">Use</span>
        ) : pulling ? (
          <span
            className="libre-model-row-pulling"
            role="status"
            aria-live="polite"
          >
            <span className="libre-model-row-spinner" aria-hidden />
            Pulling…
          </span>
        ) : canPull ? (
          <button
            type="button"
            className={
              "libre-model-row-pull" +
              (selectedButMissing ? " libre-model-row-pull--warn" : "")
            }
            disabled={pullDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onPull();
            }}
            title={
              selectedButMissing
                ? `Re-pull ${meta.label} (~${meta.sizeGb} GB)`
                : `Download ${meta.label} (~${meta.sizeGb} GB)`
            }
          >
            {selectedButMissing ? (
              <Icon icon={triangleAlert} size="xs" color="currentColor" />
            ) : (
              <Icon icon={download} size="xs" color="currentColor" />
            )}
            {selectedButMissing ? "Re-pull" : "Get"}
          </button>
        ) : (
          <span
            className="libre-model-row-remote-hint"
            title={
              reachable === false
                ? "Can't reach the Ollama host."
                : "Install this on your Ollama host machine, then it'll appear here."
            }
          >
            not installed
          </span>
        )}
      </span>
    </div>
  );
}
