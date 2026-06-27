/// Import-graph analysis for sandbox builds — used to find ORPHAN
/// files: files the agent created that nothing imports (the "creates
/// un-needed files" failure). The loop prunes orphans it wrote this
/// run; the agent-probe harness reports them.
///
/// SAFETY BIAS: this must UNDER-report, never over-report. A false
/// orphan (deleting a live file) breaks the build; a missed orphan is
/// merely untidy. So entry detection is required (no entry → no
/// orphans), and reference resolution is generous (many extension +
/// index forms) so a file referenced by any plausible path is treated
/// as reachable.

export type ProjectFiles = Record<string, string>;

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/// Relative module/asset references inside a file's content. Bare
/// specifiers (`react`, `three`) are ignored — only project-relative
/// paths matter for reachability.
export function relativeRefs(path: string, content: string): string[] {
  const refs: string[] = [];
  const add = (spec: string | undefined) => {
    if (spec && (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")))
      refs.push(spec);
  };
  if (/\.(jsx?|tsx?|mjs|cjs)$/.test(path)) {
    for (const m of content.matchAll(/\bfrom\s+["']([^"']+)["']/g)) add(m[1]);
    for (const m of content.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]);
    for (const m of content.matchAll(/\bimport\s+["']([^"']+)["']/g)) add(m[1]);
  } else if (/\.html?$/.test(path)) {
    for (const m of content.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) add(m[1]);
    for (const m of content.matchAll(/<link[^>]+href=["']([^"']+)["']/g)) add(m[1]);
  } else if (/\.css$/.test(path)) {
    for (const m of content.matchAll(/@import\s+["']([^"']+)["']/g)) add(m[1]);
    for (const m of content.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(m[1]);
  } else if (/\.py$/.test(path)) {
    for (const m of content.matchAll(/^\s*(?:from|import)\s+([.\w]+)/gm)) {
      const mod = m[1].replace(/\./g, "/");
      if (mod) refs.push(`./${mod}`);
    }
  }
  return refs;
}

/// Resolve a project-relative ref (already joined to its source dir)
/// against the file set, trying common extension + index forms.
/// Generous on purpose — a hit anywhere means "reachable".
function resolveRef(joined: string, paths: Set<string>): string | null {
  const base = normalize(joined);
  const cands = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.css`,
    `${base}.py`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  for (const c of cands) if (paths.has(c)) return c;
  return null;
}

function joinRef(fromPath: string, ref: string): string {
  if (ref.startsWith("/")) return normalize(ref.slice(1));
  return normalize(`${dirOf(fromPath)}/${ref}`);
}

/// The build's entry file, or null if none of the known conventions
/// match (in which case we decline to compute orphans at all).
export function detectEntry(files: ProjectFiles): string | null {
  const order = [
    "index.html",
    "src/main.jsx",
    "src/main.tsx",
    "src/main.js",
    "src/main.ts",
    "src/index.jsx",
    "src/index.tsx",
    "src/index.js",
    "src/index.ts",
    "src/App.jsx",
    "src/App.tsx",
    "src/App.js",
    "App.jsx",
    "main.py",
    "main.rs",
    "main.rb",
    "main.js",
    "main.ts",
    "scene.js",
    "src/routes/+page.svelte",
  ];
  for (const e of order) if (e in files) return e;
  for (const k of Object.keys(files)) if (/\.html?$/.test(k)) return k;
  return null;
}

/// Files reachable (by import/reference) from the entry.
export function reachableFrom(files: ProjectFiles): Set<string> {
  const seen = new Set<string>();
  const entry = detectEntry(files);
  if (!entry) return seen;
  const paths = new Set(Object.keys(files));
  const stack = [entry];
  // An index.html conventionally bootstraps src/main.* even when it
  // doesn't literally <script> it (the sandbox wires that up); seed
  // that edge so a main file isn't false-flagged as an orphan.
  if (/\.html?$/.test(entry)) {
    for (const guess of [
      "src/main.jsx",
      "src/main.tsx",
      "src/main.js",
      "src/index.jsx",
      "src/index.js",
      "main.js",
    ])
      if (paths.has(guess)) stack.push(guess);
  }
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const ref of relativeRefs(cur, files[cur] ?? "")) {
      const resolved = resolveRef(joinRef(cur, ref), paths);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return seen;
}

/// Orphan files — created but unreachable from the entry. Returns []
/// when there's no detectable entry (we refuse to guess). Svelte and
/// other languages whose import graph we don't model are excluded
/// from orphan candidacy to avoid false positives.
export function findOrphans(files: ProjectFiles): string[] {
  const entry = detectEntry(files);
  if (!entry) return [];
  const allPaths = Object.keys(files);
  const reach = reachableFrom(files);
  // SAFETY: if the entry reaches NOTHING yet there are multiple files,
  // the import graph found no edges at all — either a genuine
  // single-file app, or (dangerously) imports we failed to parse.
  // Either way decline: never risk deleting a live file just because
  // we didn't recognise how it's wired in. Better to leave an orphan
  // than to delete a real file.
  if (reach.size <= 1 && allPaths.length > 1) return [];
  // Only consider file types whose references we actually parse —
  // never flag a `.svelte`, `.rs`, `.json`, asset, etc. as an orphan.
  const prunable = /\.(jsx?|tsx?|mjs|cjs|css|py)$/;
  // Test files are INTENTIONALLY not imported by the app — never prune
  // them (the prompt encourages `foo.test.js` next to `foo.js`).
  const isTest = (f: string) =>
    /(?:^|[./_-])(?:test|spec)s?\.[jt]sx?$/i.test(f) ||
    /(?:^|\/)(?:__tests__|__test__|tests?)\//i.test(f) ||
    /_(?:test|spec)\.py$/i.test(f);
  return allPaths.filter(
    (f) => f !== entry && !reach.has(f) && prunable.test(f) && !isTest(f),
  );
}
