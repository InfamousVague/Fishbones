/// Public surface for playground templates.
///
/// The original monolithic `src/runtimes/playgroundTemplates.ts`
/// was split into:
///   - `_core.ts`            — Template type + templateFiles helper
///   - `single-file.ts`      — every single-file Hello-world template
///   - `multi-file/<lang>.ts` — one file per multi-file template
/// This index re-assembles `PLAYGROUND_TEMPLATES` so downstream
/// code can keep importing from `../playgroundTemplates`.

import type { LanguageId, WorkbenchFile } from "../../data/types";
import { templateFiles as templateFilesImpl, type Template } from "./_core";
import { SINGLE_FILE_TEMPLATES } from "./single-file";
import { WEB_TEMPLATE_FILES } from "./multi-file/web";
import { REACT_NATIVE_TEMPLATE_FILES } from "./multi-file/react-native";
import { THREEJS_TEMPLATE_FILES } from "./multi-file/threejs";
import { REACT_TEMPLATE_FILES } from "./multi-file/react";

export type { Template };

export const PLAYGROUND_TEMPLATES: Record<LanguageId, Template> = {
  ...(SINGLE_FILE_TEMPLATES as Record<LanguageId, Template>),
  web: {
    filename: "index.html",
    fileLanguage: "html",
    content: WEB_TEMPLATE_FILES[0].content,
    files: WEB_TEMPLATE_FILES,
  },
  reactnative: {
    filename: "App.js",
    fileLanguage: "javascript",
    content: REACT_NATIVE_TEMPLATE_FILES[0].content,
    files: REACT_NATIVE_TEMPLATE_FILES,
  },
  threejs: {
    filename: "index.html",
    fileLanguage: "html",
    content: THREEJS_TEMPLATE_FILES[0].content,
    files: THREEJS_TEMPLATE_FILES,
  },
  react: {
    filename: "App.jsx",
    fileLanguage: "javascript",
    content: REACT_TEMPLATE_FILES[0].content,
    files: REACT_TEMPLATE_FILES,
  },
};

export function templateFiles(language: LanguageId): WorkbenchFile[] {
  return templateFilesImpl(PLAYGROUND_TEMPLATES, language);
}
