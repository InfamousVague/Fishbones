/// Ambient declarations for `monaco-editor/esm/vs/basic-languages/*/*`.
///
/// `monaco-editor` ships type definitions only for its top-level
/// public API. The deeply-nested basic-language modules
/// (e.g. `monaco-editor/esm/vs/basic-languages/kotlin/kotlin`) export
/// `{ conf, language }` from each language's `<lang>.ts` file, but
/// no `.d.ts` is generated for them — so importing them with an
/// untyped path errors with TS7016 ("could not find declaration").
///
/// We pull these in directly from `monaco/setup.ts` to bypass
/// Monaco's lazy loader (which doesn't resolve correctly inside the
/// Tauri production webview). Each declaration uses an inline import
/// of `monaco-editor`'s `languages` namespace — this keeps the file
/// ambient (no top-level `import` / `export` turns the whole file
/// into a module and silences the `declare module` blocks).

declare module "monaco-editor/esm/vs/basic-languages/cpp/cpp" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/csharp/csharp" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/go/go" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/java/java" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/kotlin/kotlin" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/mips/mips" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/python/python" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/rust/rust" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/shell/shell" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/swift/swift" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
// 2026 expansion — six built-in basic-language Monarchs we now eager-
// import. Same shape as the others; declaring them ambient stops
// TS7016 from firing on the `.js` resolutions.
declare module "monaco-editor/esm/vs/basic-languages/ruby/ruby" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/lua/lua" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/dart/dart" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/scala/scala" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/sql/sql" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/elixir/elixir" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
// JS / TS Monarch backstops. Pulled in directly so the editor has
// guaranteed tokenization even before the Language-Service worker
// boots (or if it never does — see monaco/setup.ts comment).
declare module "monaco-editor/esm/vs/basic-languages/javascript/javascript" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
declare module "monaco-editor/esm/vs/basic-languages/typescript/typescript" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}
