/// Shared type + helper for playground templates. The
/// monolithic original lived in `../playgroundTemplates.ts` —
/// see `./index.ts` for the assembled `PLAYGROUND_TEMPLATES`
/// record.

import type { FileLanguage, LanguageId, WorkbenchFile } from "../../data/types";

/// One template entry. `files` is the multi-file form (web /
/// react / react-native / threejs); single-file templates leave
/// it undefined and `templateFiles()` synthesises a single
/// `WorkbenchFile` from `filename` + `fileLanguage` + `content`.
export interface Template {
  /// Default workbench filename — e.g. `main.go`, `user.py`. Matches
  /// the single-file-lesson conventions in
  /// `src/lib/workbenchFiles.ts`. Only used by `templateFiles()` for
  /// single-file templates.
  filename: string;
  /// Monaco / syntax-highlight language id. Only used by
  /// `templateFiles()` for single-file templates.
  fileLanguage: FileLanguage;
  /// Starter content. For multi-file templates (`files` is set)
  /// this is used as the LEGACY single-file fallback — new code
  /// paths check `files` first.
  content: string;
  /// When set, `templateFiles()` returns this multi-file array
  /// instead of synthesising a single file from
  /// `filename` + `content`. Used by the web + three.js +
  /// react / react-native templates which need
  /// HTML + CSS + JS side-by-side from the first paint.
  files?: WorkbenchFile[];
}

/// Resolve the starter-file set for a playground language. Multi-file
/// templates (web, threejs) return their full file array; single-file
/// templates synthesize one `WorkbenchFile` from the template's
/// filename + fileLanguage + content. Cloned so downstream edits can't
/// poison the template singleton.
export function templateFiles(
  templates: Record<LanguageId, Template>,
  language: LanguageId,
): WorkbenchFile[] {
  const t = templates[language];
  if (t.files && t.files.length > 0) {
    return t.files.map((f) => ({ ...f }));
  }
  return [
    {
      name: t.filename,
      language: t.fileLanguage,
      content: t.content,
    },
  ];
}
