/// Map an arbitrary sandbox file NAME to a string Monaco can safely
/// use as a model `path`.
///
/// `@monaco-editor/react` feeds the `path` prop into
/// `monaco.Uri.parse(path)` to give each file its own model (per-file
/// undo / cursor / scroll). `Uri.parse` reads everything before the
/// first `:` as a URI SCHEME — and throws `[UriError]: Scheme
/// contains illegal characters` if that scheme has anything outside
/// `[A-Za-z0-9+.-]` or doesn't start with a letter. That throw
/// happens during render and takes down the ENTIRE editor (and with
/// it the sandbox view) via the error boundary.
///
/// The AI agent can write files with ANY path (a stray `lang:`
/// prefix, a URL, a space-or-unicode name, a Windows `C:\…` path), so
/// the editor must never trust the raw name. This maps any character
/// outside a conservative path set to a `~<hex>` escape — which
/// removes every colon (so no scheme can form) and every other
/// illegal char, leaving a string `Uri.parse` always accepts. The
/// transform is deterministic and collision-free (the escape char `~`
/// is itself escaped), and the editor still shows the REAL filename
/// in the tab — only the internal model id is sanitized.

export function safeMonacoPath(name: string): string {
  if (!name) return "untitled";
  const safe = name.replace(
    /[^A-Za-z0-9._/-]/g,
    (c) => `~${c.charCodeAt(0).toString(16)}`,
  );
  return safe || "untitled";
}
