/// Frontend bridge for the Sandbox's filesystem + git Tauri
/// commands (see `src-tauri/src/sandbox.rs`). Lazy-imports
/// `@tauri-apps/api/core` so the web build can drop these calls at
/// tree-shake time and fall back to localStorage in
/// `useSandboxProjects`.
///
/// Why a thin wrapper instead of calling `invoke` directly: every
/// caller would otherwise have to:
///   1. Detect web vs. desktop and short-circuit
///   2. Spell the command name correctly
///   3. Know the shape of the args + the response
///   4. Type-cast the return value
/// Wrapping it once gives every consumer a typed function call
/// that throws a structured error on web (caller catches → falls
/// back to localStorage) and returns the parsed payload on desktop.

import type { LanguageId, WorkbenchFile } from "@/data/types";
import { isDesktop } from "./platform";

export interface DiskProjectMeta {
  id: string;
  name: string;
  language: LanguageId;
  createdAt: string;
  updatedAt: string;
}

export interface DiskProjectFile {
  /// Relative path within the project folder (forward-slash
  /// separated on every platform — the Rust side normalises
  /// Windows backslashes on the way out).
  name: string;
  /// Monaco language id (e.g. "javascript", "rust"). Derived
  /// from the file extension by the Rust side; callers can
  /// override on save by passing their own language string in
  /// the WorkbenchFile.
  language: string;
  content: string;
  readOnly?: boolean;
}

export interface DiskProjectFull extends DiskProjectMeta {
  files: DiskProjectFile[];
}

export interface GitFileStatus {
  path: string;
  /// XY porcelain status, e.g. "??", " M", "A ", "MM".
  status: string;
}

export interface GitStatus {
  hasRepo: boolean;
  branch: string;
  files: GitFileStatus[];
}

export interface GitLogEntry {
  hash: string;
  subject: string;
  author: string;
  /// Unix timestamp (seconds).
  timestamp: number;
}

/// Sentinel error thrown when the user is on web — callers can
/// `catch (e) { if (isSandboxFsUnavailable(e)) ... }` and switch
/// to the localStorage path. Keeping it as a thrown sentinel
/// instead of returning `null` keeps the happy path linear on
/// desktop.
export class SandboxFsUnavailableError extends Error {
  constructor() {
    super("sandbox filesystem is desktop-only");
    this.name = "SandboxFsUnavailableError";
  }
}

export function isSandboxFsUnavailable(e: unknown): e is SandboxFsUnavailableError {
  return e instanceof SandboxFsUnavailableError;
}

/// `true` when this build can talk to the Rust sandbox backend
/// — i.e. it's running inside Tauri. Callers use this to gate
/// the disk-backed code path on. Re-exported from platform.ts'
/// `isDesktop` for grep-ability ("where do we use sandbox FS?").
export const SANDBOX_FS_AVAILABLE = isDesktop;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop) throw new SandboxFsUnavailableError();
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return (await tauriInvoke(cmd, args)) as T;
}

// ── Project CRUD ─────────────────────────────────────────────────

export async function listProjects(): Promise<DiskProjectMeta[]> {
  return invoke<DiskProjectMeta[]>("sandbox_list_projects");
}

export async function loadProject(id: string): Promise<DiskProjectFull> {
  return invoke<DiskProjectFull>("sandbox_load_project", { id });
}

/// Persist the entire project (metadata + every file). The Rust
/// side prunes files that aren't in the supplied list — i.e. a
/// `WorkbenchFile` that disappeared between saves gets deleted on
/// disk. Callers should always pass the full current state, not a
/// delta.
export async function saveProject(
  meta: DiskProjectMeta,
  files: WorkbenchFile[],
): Promise<void> {
  return invoke<void>("sandbox_save_project", {
    project: {
      ...meta,
      files: files.map((f) => ({
        name: f.name,
        language: f.language ?? "plaintext",
        content: f.content,
        readOnly: f.readOnly,
      })),
    },
  });
}

export async function deleteProject(id: string): Promise<void> {
  return invoke<void>("sandbox_delete_project", { id });
}

export async function revealProject(id: string): Promise<void> {
  return invoke<void>("sandbox_reveal_project", { id });
}

// ── Git ──────────────────────────────────────────────────────────

export async function gitStatus(id: string): Promise<GitStatus> {
  // Tauri serialises Rust structs with their #[serde(rename)] names
  // intact — `has_repo` → `hasRepo`, etc. Cast through the rust
  // shape so the call site doesn't need to know the wire format.
  type Wire = {
    has_repo: boolean;
    branch: string;
    files: GitFileStatus[];
  };
  const r = await invoke<Wire>("sandbox_git_status", { id });
  return { hasRepo: r.has_repo, branch: r.branch, files: r.files };
}

export async function gitInit(id: string): Promise<void> {
  return invoke<void>("sandbox_git_init", { id });
}

export async function gitAddAll(id: string): Promise<void> {
  return invoke<void>("sandbox_git_add_all", { id });
}

export async function gitCommit(
  id: string,
  message: string,
  author?: { name: string; email: string },
): Promise<string> {
  return invoke<string>("sandbox_git_commit", {
    input: {
      id,
      message,
      author_name: author?.name ?? null,
      author_email: author?.email ?? null,
    },
  });
}

export async function gitLog(id: string, limit = 50): Promise<GitLogEntry[]> {
  return invoke<GitLogEntry[]>("sandbox_git_log", { id, limit });
}
