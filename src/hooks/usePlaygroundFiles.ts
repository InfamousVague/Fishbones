import { useCallback, useEffect, useRef, useState } from "react";
import type { LanguageId, WorkbenchFile } from "@/data/types";
import { templateFiles } from "@/runtimes/playgroundTemplates/index";

/// Per-language playground persistence. Switching from Rust → Go → Rust
/// restores your Rust snippet; nothing is tied to a course or lesson.
///
/// Storage shape: `kata:playground:v1:{language}` → `{ files, savedAt }`.
/// When the learner has never touched a language, we seed it from the
/// per-language template (see `playgroundTemplates.ts`).

const STORAGE_PREFIX = "libre:playground:v1:";

function storageKey(language: LanguageId): string {
  return `${STORAGE_PREFIX}${language}`;
}

interface PersistedPlayground {
  files: WorkbenchFile[];
  savedAt: number;
}

function readStored(language: LanguageId): WorkbenchFile[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(language));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPlayground;
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    return parsed.files;
  } catch {
    return null;
  }
}

function writeStored(language: LanguageId, files: WorkbenchFile[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: PersistedPlayground = { files, savedAt: Date.now() };
    localStorage.setItem(storageKey(language), JSON.stringify(payload));
  } catch {
    /* quota / private-mode — drop silently, in-memory state is still valid */
  }
}

export interface UsePlaygroundFilesResult {
  language: LanguageId;
  setLanguage: (next: LanguageId) => void;
  files: WorkbenchFile[];
  setFiles: React.Dispatch<React.SetStateAction<WorkbenchFile[]>>;
  /// Revert the current language's playground to its default template
  /// AND clear the saved snippet so the next visit also starts fresh.
  resetToTemplate: () => void;
  /// Index of the currently-focused file in `files`. The editor's
  /// tab strip + the sidebar's file tree both highlight whichever
  /// row matches this index; both also use `setActiveFileIdx` to
  /// change focus, which is why this state belongs on the hook
  /// rather than buried inside the editor or the tree.
  activeFileIdx: number;
  setActiveFileIdx: React.Dispatch<React.SetStateAction<number>>;
}

export function usePlaygroundFiles(
  initialLanguage: LanguageId = "javascript",
): UsePlaygroundFilesResult {
  const [language, setLanguageState] = useState<LanguageId>(initialLanguage);

  // Synchronous init so the first render already has restored content.
  const [files, setFiles] = useState<WorkbenchFile[]>(() => {
    return readStored(initialLanguage) ?? templateFiles(initialLanguage);
  });

  // Active file index, shared with both the editor's tab strip
  // and the sidebar's file tree. Reset to 0 on language switch
  // since the new language's file list usually has a different
  // count and a stale index would point at the wrong file (or
  // out of bounds entirely).
  const [activeFileIdx, setActiveFileIdx] = useState<number>(0);

  /// Keep a ref to the latest files so the debounce + unmount flush
  /// always see the current value even if the closure's `files` snapshot
  /// is older.
  const latestFilesRef = useRef(files);
  latestFilesRef.current = files;
  /// The language the ref's `files` belongs to. We need this because
  /// `setLanguage` flips `language` and `files` together; the save
  /// observer must write to the OLD key on switch-away, not the new one.
  const currentLangRef = useRef(language);
  currentLangRef.current = language;

  // Debounced write-through for the active language. Writes happen 400ms
  // after the last keystroke. Unmount / language-switch flush below
  // picks up anything still pending.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const handle = window.setTimeout(() => {
      writeStored(currentLangRef.current, latestFilesRef.current);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [files]);

  // Unmount flush — if the component unmounts mid-debounce, still save.
  useEffect(() => {
    return () => {
      writeStored(currentLangRef.current, latestFilesRef.current);
    };
  }, []);

  const setLanguage = useCallback((next: LanguageId) => {
    if (next === currentLangRef.current) return;
    // Flush current language's files before the switch, then load the
    // new language's saved snippet (or template if unseen).
    writeStored(currentLangRef.current, latestFilesRef.current);
    const restored = readStored(next) ?? templateFiles(next);
    currentLangRef.current = next;
    latestFilesRef.current = restored;
    setLanguageState(next);
    setFiles(restored);
    // Reset the active file index — the new language's file list
    // is almost certainly a different length, and an out-of-range
    // index would render the editor against an undefined file.
    setActiveFileIdx(0);
  }, []);

  const resetToTemplate = useCallback(() => {
    const fresh = templateFiles(currentLangRef.current);
    latestFilesRef.current = fresh;
    setFiles(fresh);
    try {
      localStorage.removeItem(storageKey(currentLangRef.current));
    } catch {
      /* ignore */
    }
  }, []);

  return {
    language,
    setLanguage,
    files,
    setFiles,
    resetToTemplate,
    activeFileIdx,
    setActiveFileIdx,
  };
}
