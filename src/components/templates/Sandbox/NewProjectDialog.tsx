/// Small modal for creating a new Sandbox project. Two fields:
/// project name (text input) and language (select). On submit
/// passes the values up to `onCreate`; the parent calls the hook's
/// `createProject` + closes us. Cancel-on-Esc and click-outside
/// come from the shared ModalBackdrop.

import { useEffect, useRef, useState } from "react";
import type { LanguageId } from "@/data/types";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import { useT } from "@/i18n/i18n";
import "./NewProjectDialog.css";

/// Language options offered in the picker. Kept in sync with the
/// playground-template seeds — anything that has a template can
/// be selected here. Listed in roughly "popularity" order so the
/// common picks (JS/TS/Python/Rust) sit at the top.
const LANGUAGES: ReadonlyArray<{ id: LanguageId; label: string }> = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "swift", label: "Swift" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "csharp", label: "C#" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "assembly", label: "Assembly" },
  { id: "web", label: "Web (HTML/CSS/JS)" },
  { id: "solidity", label: "Solidity" },
  { id: "vyper", label: "Vyper" },
  { id: "svelte", label: "Svelte" },
];

interface Props {
  defaultLanguage: LanguageId;
  onCancel: () => void;
  onCreate: (name: string, language: LanguageId) => void;
}

export default function NewProjectDialog({
  defaultLanguage,
  onCancel,
  onCreate,
}: Props) {
  const t = useT();
  const [name, setName] = useState(() => t("sandbox.newProjectPlaceholder"));
  const [language, setLanguage] = useState<LanguageId>(defaultLanguage);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus + select the name field so the learner can type
  // immediately. We defer one frame past mount so any focus trap
  // the modal backdrop installs gets out of the way.
  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onCreate(trimmed, language);
  }

  return (
    <ModalBackdrop onDismiss={onCancel}>
      <form
        className="libre-newproj"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="libre-newproj__head">
          <h2 className="libre-newproj__title">{t("sandbox.newProjectTitle")}</h2>
        </header>
        <div className="libre-newproj__body">
          <label className="libre-newproj__field">
            <span className="libre-newproj__label">{t("sandbox.newProjectName")}</span>
            <input
              ref={inputRef}
              type="text"
              className="libre-newproj__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              spellCheck={false}
              placeholder={t("sandbox.newProjectPlaceholder")}
            />
          </label>
          <label className="libre-newproj__field">
            <span className="libre-newproj__label">{t("sandbox.newProjectLanguage")}</span>
            <select
              className="libre-newproj__select"
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageId)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <footer className="libre-newproj__foot">
          <button
            type="button"
            className="libre-newproj__btn"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="libre-newproj__btn libre-newproj__btn--primary"
            disabled={name.trim().length === 0}
          >
            {t("common.create")}
          </button>
        </footer>
      </form>
    </ModalBackdrop>
  );
}
