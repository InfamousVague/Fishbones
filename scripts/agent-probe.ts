/// Headless agent-probe harness — drive the REAL agent loop against a
/// REAL local Ollama model and report how it actually builds, so we
/// can catch the glitches that scripted unit tests can't: un-needed
/// (orphan) files, getting stuck editing files nothing imports, and
/// duplicate / wasted work.
///
/// It reuses the production pieces verbatim — `runAgentLoop`, the
/// extracted `buildAgentSystemPrompt`, the real path/name validation —
/// and swaps only the two things that need a real backend:
///   • transport  → a Node fetch against Ollama /api/chat (mirrors
///     the Rust `ai_chat_agent_turn` request shape)
///   • sandbox    → an in-memory project store (no Tauri / disk)
///
/// Run it:
///   npx vite-node scripts/agent-probe.ts -- \
///     --model gemma3:4b --prompt "build a blackjack game in React" \
///     --language react --max-turns 8
///
/// It prints a turn-by-turn trace + a GLITCH REPORT and writes a JSON
/// "tape" (the full trace) you can replay in a regression test.

import { runAgentLoop } from "../src/lib/aiAgent/loop";
import { buildAgentSystemPrompt } from "../src/lib/aiAgent/agentSystemPrompt";
import { emulatedBuildTier } from "../src/lib/ai/models";
import {
  dedupeProjectName,
  validateFilePath,
  validateProjectName,
} from "../src/lib/aiTools/sandboxValidation";
import type {
  AgentTransport,
  AgentTurnRequest,
  AgentTurnResponse,
} from "../src/lib/aiAgent/types";
import type { ToolCall, ToolDef, ToolResult } from "../src/lib/aiTools/types";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";

// ── argv ────────────────────────────────────────────────────────────
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const MODEL = arg("model", "gemma3:4b")!;
const PROMPT = arg("prompt", "Build a blackjack game in React")!;
const LANGUAGE = arg("language", "react")!;
const MAX_TURNS = parseInt(arg("max-turns", "8")!, 10);
const OUT = arg("out", `/private/tmp/agent-probe-${MODEL.replace(/[^a-z0-9]/gi, "_")}.json`)!;

// ── daemon-aware tool tier (mirrors the app's auto-detect) ──────────
async function probeNative(model: string): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!r.ok) return false;
    const body = (await r.json()) as { capabilities?: string[] };
    return Array.isArray(body.capabilities) && body.capabilities.includes("tools");
  } catch {
    return false;
  }
}

// ── Ollama transport (mirror of ai_chat_agent_turn request) ─────────
// STREAMS the response (stream:true) so the first byte arrives as soon
// as generation starts — a heavily-loaded Ollama that takes minutes to
// load+generate won't trip undici's ~300s time-to-first-byte timeout
// the way a single non-streaming response does.
interface OllamaChunk {
  message?: {
    content?: string;
    tool_calls?: Array<{ id?: string; function: { name: string; arguments: unknown } }>;
  };
  done?: boolean;
}

function ollamaTransport(): AgentTransport {
  return {
    async send(req: AgentTurnRequest): Promise<AgentTurnResponse> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages,
        stream: true,
        keep_alive: "30m",
      };
      if (req.tools && req.tools.length > 0) body.tools = req.tools;
      const opts: Record<string, unknown> = {};
      if (req.temperature != null) opts.temperature = req.temperature;
      if (req.num_ctx != null) opts.num_ctx = req.num_ctx;
      if (req.num_predict != null) opts.num_predict = req.num_predict;
      if (Object.keys(opts).length) body.options = opts;

      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok || !r.body) {
        throw new Error(`ollama returned ${r.status}: ${await r.text().catch(() => "")}`);
      }

      let content = "";
      const rawToolCalls: Array<{ id?: string; function: { name: string; arguments: unknown } }> = [];
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let chunk: OllamaChunk;
          try {
            chunk = JSON.parse(line) as OllamaChunk;
          } catch {
            continue;
          }
          if (chunk.message?.content) content += chunk.message.content;
          if (chunk.message?.tool_calls) rawToolCalls.push(...chunk.message.tool_calls);
        }
      }

      const toolCalls: ToolCall[] = rawToolCalls.map((tc, i) => ({
        id: tc.id ?? `call_${i}`,
        name: tc.function.name,
        arguments:
          typeof tc.function.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments ?? {}),
      }));
      return {
        content,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      };
    },
  };
}

// ── in-memory sandbox + faithful tools ──────────────────────────────
interface MemProject {
  id: string;
  name: string;
  language: string;
  files: Map<string, string>;
}

interface Op {
  turn: number;
  op: "create" | "write" | "patch-write" | "patch-delete" | "run" | "read" | "other";
  path?: string;
  ok: boolean;
  note?: string;
}

const projects = new Map<string, MemProject>();
const ops: Op[] = [];
let currentTurn = 0;
let activeProjectId: string | null = null;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";
}

function ok(obj: unknown) {
  return obj;
}
function err(message: string) {
  return { error: true, message };
}

function memTools(): ToolDef[] {
  const def = (
    name: string,
    description: string,
    auto: boolean,
    handler: (a: any) => Promise<unknown>,
  ): ToolDef => ({
    name,
    description,
    parameters: { type: "object", properties: {} },
    auto,
    handler,
  });

  return [
    def(
      "create_sandbox_project",
      "Create a new sandbox project. Args: name, language, files? (array of {path, content}). Returns projectId.",
      true,
      async (a) => {
        const nameCheck = validateProjectName(a?.name ?? "");
        if (!nameCheck.ok) return err(`invalid name: ${nameCheck.reason}`);
        const display = dedupeProjectName(
          a.name,
          [...projects.values()].map((p) => p.name),
        );
        const id = `${slug(display)}-${projects.size + 1}`;
        const files = new Map<string, string>();
        for (const f of (a?.files ?? []) as Array<{ path?: string; content?: string }>) {
          const pc = validateFilePath(f?.path ?? "");
          if (!pc.ok) {
            ops.push({ turn: currentTurn, op: "create", path: f?.path, ok: false, note: pc.reason });
            return err(`invalid file path '${String(f?.path).slice(0, 40)}': ${pc.reason}`);
          }
          files.set(f.path!, f.content ?? "");
        }
        projects.set(id, { id, name: display, language: a?.language ?? LANGUAGE, files });
        activeProjectId = id;
        ops.push({ turn: currentTurn, op: "create", ok: true, note: `${display} (${files.size} files)` });
        return ok({
          ok: true,
          projectId: id,
          name: display,
          language: a?.language ?? LANGUAGE,
          files: [...files.keys()].map((p) => ({ path: p })),
          nextSteps:
            files.size === 0
              ? "Now write the files. Stream each as a ```lang:path fenced block, then run_sandbox_project."
              : "Files written. Call run_sandbox_project to verify.",
        });
      },
    ),
    def(
      "write_sandbox_file",
      "Write/overwrite one file. Args: projectId, path, content.",
      true,
      async (a) => {
        const p = projects.get(a?.projectId ?? activeProjectId ?? "");
        if (!p) return err("no such project");
        const pc = validateFilePath(a?.path ?? "");
        if (!pc.ok) {
          ops.push({ turn: currentTurn, op: "write", path: a?.path, ok: false, note: pc.reason });
          return err(`invalid path: ${pc.reason}`);
        }
        p.files.set(a.path, a?.content ?? "");
        ops.push({ turn: currentTurn, op: "write", path: a.path, ok: true });
        return ok({ ok: true });
      },
    ),
    def(
      "apply_sandbox_patch",
      "Apply edits. Args: projectId, edits: [{path, op:'write'|'delete', content?}].",
      true,
      async (a) => {
        const p = projects.get(a?.projectId ?? activeProjectId ?? "");
        if (!p) return err("no such project");
        const applied: Array<{ path: string; op: string; ok: boolean }> = [];
        for (const e of (a?.edits ?? []) as Array<{ path?: string; op?: string; content?: string }>) {
          if (e.op === "delete") {
            const had = p.files.delete(e.path ?? "");
            ops.push({ turn: currentTurn, op: "patch-delete", path: e.path, ok: had });
            applied.push({ path: e.path ?? "", op: "delete", ok: had });
          } else {
            const pc = validateFilePath(e?.path ?? "");
            if (!pc.ok) {
              ops.push({ turn: currentTurn, op: "patch-write", path: e?.path, ok: false, note: pc.reason });
              return err(`invalid path: ${pc.reason}`);
            }
            p.files.set(e.path!, e?.content ?? "");
            ops.push({ turn: currentTurn, op: "patch-write", path: e.path, ok: true });
            applied.push({ path: e.path!, op: "write", ok: true });
          }
        }
        return ok({ ok: true, applied });
      },
    ),
    def(
      "read_sandbox_file",
      "Read one file. Args: projectId, path.",
      true,
      async (a) => {
        const p = projects.get(a?.projectId ?? activeProjectId ?? "");
        if (!p) return err("no such project");
        ops.push({ turn: currentTurn, op: "read", path: a?.path, ok: p.files.has(a?.path) });
        if (!p.files.has(a?.path)) return err("no such file");
        return ok({ ok: true, path: a.path, content: p.files.get(a.path) });
      },
    ),
    def("list_sandbox_files", "List files. Args: projectId.", true, async (a) => {
      const p = projects.get(a?.projectId ?? activeProjectId ?? "");
      if (!p) return err("no such project");
      return ok({ ok: true, files: [...p.files.keys()] });
    }),
    def("list_sandbox_projects", "List all projects.", true, async () =>
      ok({ ok: true, projects: [...projects.values()].map((p) => ({ id: p.id, name: p.name })) }),
    ),
    def("set_active_project", "Set active project. Args: projectId.", true, async (a) => {
      if (!projects.has(a?.projectId)) return err("no such project");
      activeProjectId = a.projectId;
      return ok({ ok: true });
    }),
    def("run_sandbox_project", "Build + run the project. Args: projectId.", true, async (a) => {
      const p = projects.get(a?.projectId ?? activeProjectId ?? "");
      if (!p) {
        ops.push({ turn: currentTurn, op: "run", ok: false, note: `bad projectId '${a?.projectId}'` });
        return err("no such project (check the projectId — use the exact id returned by create_sandbox_project)");
      }
      const diags = staticCheck(p);
      ops.push({ turn: currentTurn, op: "run", ok: diags.length === 0, note: diags[0] });
      if (diags.length) {
        return err(`Build failed:\n${diags.join("\n")}`);
      }
      return ok({ ok: true, output: "Build succeeded. App rendered." });
    }),
    def(
      "request_user_input",
      "Ask the user a question. Args: question, context?.",
      false,
      async (a) => ok({ ok: true, answer: "(probe) proceed with sensible defaults" }),
    ),
  ];
}

// ── static "build" check: cheap, faithful-enough signal for run ─────
function staticCheck(p: MemProject): string[] {
  const diags: string[] = [];
  const paths = new Set(p.files.keys());
  const entry = detectEntry(p);
  if (!entry) {
    diags.push(`No entry point found (expected one of index.html / src/main.* / src/App.* / main.py).`);
    return diags;
  }
  // Unresolved relative imports = a real build failure.
  for (const [path, content] of p.files) {
    for (const ref of relativeRefs(path, content)) {
      if (!resolveRef(ref, paths)) {
        diags.push(`${path}: imports '${ref}' which does not exist.`);
      }
    }
  }
  return diags;
}

// ── import graph (orphan + edit-loop analysis) ──────────────────────
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
/// Extract relative module references from a file's content.
function relativeRefs(path: string, content: string): string[] {
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
  } else if (/\.py$/.test(path)) {
    for (const m of content.matchAll(/^\s*(?:from|import)\s+([.\w]+)/gm)) {
      const mod = m[1].replace(/\./g, "/");
      if (mod) refs.push(`./${mod}`);
    }
  }
  return refs;
}
/// Resolve a relative ref (from a file) against the project's paths,
/// trying common extension + index forms. Returns the matched path.
function resolveRef(ref: string, paths: Set<string>): string | null {
  // ref already normalized relative to file dir by the caller via
  // joinRef; here we just try candidates.
  const cands = [
    ref,
    `${ref}.js`,
    `${ref}.jsx`,
    `${ref}.ts`,
    `${ref}.tsx`,
    `${ref}.css`,
    `${ref}.py`,
    `${ref}/index.js`,
    `${ref}/index.jsx`,
    `${ref}/index.ts`,
  ];
  for (const c of cands) if (paths.has(normalize(c))) return normalize(c);
  return null;
}
function joinRef(fromPath: string, ref: string): string {
  if (ref.startsWith("/")) return normalize(ref.slice(1));
  return normalize(`${dirOf(fromPath)}/${ref}`);
}
function detectEntry(p: MemProject): string | null {
  const order = [
    "index.html",
    "src/main.jsx",
    "src/main.tsx",
    "src/main.js",
    "src/main.ts",
    "src/index.jsx",
    "src/index.js",
    "src/App.jsx",
    "src/App.tsx",
    "main.py",
    "main.js",
    "main.ts",
    "scene.js",
    "src/routes/+page.svelte",
  ];
  for (const e of order) if (p.files.has(e)) return e;
  // fall back: any *.html, else any main.*
  for (const k of p.files.keys()) if (/\.html?$/.test(k)) return k;
  return null;
}
/// Files reachable (by import) from the entry. HTML entries also pull
/// their referenced scripts which then pull their imports.
function reachableFrom(p: MemProject): Set<string> {
  const entry = detectEntry(p);
  const seen = new Set<string>();
  if (!entry) return seen;
  const paths = new Set(p.files.keys());
  const stack = [entry];
  // An index.html that loads src/main.jsx is the conventional React
  // wiring; seed that edge even if the html doesn't literally list it.
  if (entry === "index.html") {
    for (const guess of ["src/main.jsx", "src/main.tsx", "src/main.js", "main.js"])
      if (paths.has(guess)) stack.push(guess);
  }
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const content = p.files.get(cur) ?? "";
    for (const ref of relativeRefs(cur, content)) {
      const resolved = resolveRef(joinRef(cur, ref), paths);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return seen;
}

// ── main ────────────────────────────────────────────────────────────
async function main() {
  const native = await probeNative(MODEL);
  const tools = memTools();
  const emulatedToolNames = native ? undefined : tools.map((t) => t.name);
  const systemPrompt = buildAgentSystemPrompt(null, null, "build-with-me", {
    emulatedToolNames,
    emulatedTier: emulatedBuildTier(MODEL),
    currentSandbox: null,
  });

  const turns: Array<{ index: number; content: string; toolCalls: ToolCall[] }> = [];
  const nudges: string[] = [];

  console.log(`\n=== agent-probe: ${MODEL} (${native ? "native" : "emulated/" + emulatedBuildTier(MODEL)}) ===`);
  console.log(`prompt: ${PROMPT}\n`);

  const transport = ollamaTransport();
  // Wrap transport to count turns + capture raw content.
  const capturing: AgentTransport = {
    async send(req) {
      currentTurn = turns.length;
      const res = await transport.send(req);
      turns.push({
        index: currentTurn,
        content: res.content,
        toolCalls: res.toolCalls ?? [],
      });
      const tc = (res.toolCalls ?? []).map((t) => t.name).join(", ") || "—";
      const preview = res.content.replace(/\s+/g, " ").slice(0, 100);
      console.log(`  turn ${currentTurn}: toolCalls=[${tc}]  text="${preview}${res.content.length > 100 ? "…" : ""}"`);
      return res;
    },
  };

  const t0 = Date.now();
  const summary = await runAgentLoop({
    initialMessages: [],
    systemPrompt,
    model: MODEL,
    tools,
    userPrompt: PROMPT,
    transport: capturing,
    maxTurns: MAX_TURNS,
    hooks: {
      approveToolCall: async () => "approved",
      onNudge: (n) => {
        nudges.push(n);
        console.log(`  ↳ nudge: ${n.replace(/\s+/g, " ").slice(0, 90)}…`);
      },
    },
  });
  const ms = Date.now() - t0;

  report(summary.timeline, summary.endedBy, turns.length, nudges, ms);

  // Persist the tape for replay regression tests.
  const fs = await import("node:fs");
  const proj = activeProjectId ? projects.get(activeProjectId) : null;
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        model: MODEL,
        native,
        prompt: PROMPT,
        endedBy: summary.endedBy,
        turns,
        nudges,
        ops,
        finalFiles: proj ? Object.fromEntries(proj.files) : {},
      },
      null,
      2,
    ),
  );
  console.log(`\ntape → ${OUT}\n`);
}

function report(
  timeline: ToolResult[],
  endedBy: string,
  turnCount: number,
  nudges: string[],
  ms: number,
) {
  const proj = activeProjectId ? projects.get(activeProjectId) : null;
  console.log(`\n──────── GLITCH REPORT ────────`);
  console.log(`ended: ${endedBy} · turns: ${turnCount} · nudges: ${nudges.length} · ${(ms / 1000).toFixed(1)}s`);
  console.log(`projects created: ${projects.size}  (want: 1)`);

  if (!proj) {
    console.log(`\n⚠️  NO PROJECT was created — the build never started.`);
    return;
  }

  // Duplicate creates.
  const creates = ops.filter((o) => o.op === "create" && o.ok).length;
  if (projects.size > 1) console.log(`\n⚠️  DUPLICATE PROJECTS: ${projects.size} created (should be 1).`);

  // File list.
  const files = [...proj.files.keys()];
  console.log(`\nfinal files (${files.length}):`);
  for (const f of files) console.log(`   ${f}  (${proj.files.get(f)!.length}b)`);

  // Orphans (created but unreachable from the entry).
  const entry = detectEntry(proj);
  const reach = reachableFrom(proj);
  const orphans = files.filter((f) => !reach.has(f) && f !== entry);
  console.log(`\nentry: ${entry ?? "NONE"}`);
  if (orphans.length) {
    console.log(`⚠️  ORPHAN FILES (created, never imported from entry) — "un-needed files":`);
    for (const o of orphans) console.log(`     ${o}`);
  } else {
    console.log(`✓ no orphan files — every file is reachable from the entry.`);
  }

  // Redundant edits / edits to unused files ("stuck editing").
  const writeCounts = new Map<string, number>();
  for (const o of ops) {
    if ((o.op === "write" || o.op === "patch-write") && o.path)
      writeCounts.set(o.path, (writeCounts.get(o.path) ?? 0) + 1);
  }
  const churned = [...writeCounts.entries()].filter(([, n]) => n >= 3);
  if (churned.length) {
    console.log(`⚠️  CHURNED FILES (written ≥3×) — possible "stuck editing":`);
    for (const [p, n] of churned)
      console.log(`     ${p} ×${n}${orphans.includes(p) ? "  (AND it's an orphan!)" : ""}`);
  }
  const editedOrphans = [...writeCounts.keys()].filter((p) => orphans.includes(p));
  if (editedOrphans.length) {
    console.log(`⚠️  EDITS TO UNUSED FILES — "stuck editing files it doesn't use":`);
    for (const p of editedOrphans) console.log(`     ${p} (written ${writeCounts.get(p)}×, never imported)`);
  }

  // Run outcomes.
  const runs = ops.filter((o) => o.op === "run");
  const failedRuns = runs.filter((o) => !o.ok);
  console.log(`\nruns: ${runs.length} (${failedRuns.length} failed)`);
  for (const r of failedRuns) console.log(`   ✗ ${r.note}`);

  // Wasted turns (no tool call, no meaningful text).
  console.log(`\ntool calls dispatched: ${timeline.length}, creates: ${creates}`);
  console.log(`────────────────────────────────`);
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
