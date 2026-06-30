/// Source-control panel for the Sandbox sidebar. Sits below the
/// file tree when the active project lives on disk (i.e. we're in
/// a Tauri desktop build); the panel auto-hides on the web build
/// because there's no filesystem layer to back the git commands.
///
/// States (top → bottom):
///   1. Disabled: project hasn't been saved to disk yet (e.g. the
///      first frame after createProject before the debounced save
///      fired). Renders nothing — the user wouldn't have anything
///      to commit anyway.
///   2. No repo: project is on disk but `.git/` doesn't exist.
///      Surfaces a single "Initialise repository" button. Click
///      runs `git init -b main` via Tauri.
///   3. Has repo: shows the branch name + the count of changed
///      files. If there are changes, an expandable list shows
///      each file with its porcelain status code (M/A/D/??) and
///      a commit button reveals the message input. Empty state
///      ("no changes") shows the last commit's short hash + the
///      commit subject so the user has feedback that the commit
///      they just made actually landed.
///
/// We poll `gitStatus` every time the active project's `updatedAt`
/// changes — i.e. after every keystroke debounces through the
/// file-save layer — so the status display tracks what the editor
/// is seeing without needing an inotify-like channel.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { gitBranch } from "@base/primitives/icon/icons/git-branch";
import { gitCommit } from "@base/primitives/icon/icons/git-commit";
import { plus } from "@base/primitives/icon/icons/plus";
import { folderOpen } from "@base/primitives/icon/icons/folder-open";
import "@base/primitives/icon/icon.css";
import {
  SANDBOX_FS_AVAILABLE,
  gitCommit as fsGitCommit,
  gitInit as fsGitInit,
  gitLog as fsGitLog,
  gitStatus as fsGitStatus,
  revealProject as fsRevealProject,
  type GitLogEntry,
  type GitStatus,
} from "@/lib/sandboxFs";
import { useT, type TFunction } from "@/i18n/i18n";
import "./SandboxGitPanel.css";

interface Props {
  /// Project id to operate on. Switching projects re-runs the status
  /// fetch on the new id; the previous fetch is cancelled via the
  /// in-flight ref.
  projectId: string;
  /// Bumped whenever the editor commits a file change. The panel
  /// re-polls `git status` on every increment so the user sees
  /// dirty-file deltas appear within ~1s of typing.
  refreshTick: number;
}

export default function SandboxGitPanel({ projectId, refreshTick }: Props) {
  const t = useT();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [latestCommit, setLatestCommit] = useState<GitLogEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Pull the latest status + log entry. Both queries share a busy
  // flag so the UI can hide affordances during the round-trip. The
  // status query is cheap (one `git status --porcelain` call) and
  // safe to spam; the log query only fires when the repo has a
  // commit.
  const refresh = useCallback(async () => {
    if (!SANDBOX_FS_AVAILABLE || !projectId) return;
    try {
      const s = await fsGitStatus(projectId);
      setStatus(s);
      setError(null);
      if (s.hasRepo) {
        const log = await fsGitLog(projectId, 1).catch(() => []);
        setLatestCommit(log[0] ?? null);
      } else {
        setLatestCommit(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  // Re-poll on project switch + after every editor save (refreshTick
  // increments). Effects bundle the two triggers so we don't need
  // separate listeners.
  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  // Auto-focus the commit message on open. Defer one frame so the
  // input mount completes before we focus — same shape as
  // NewProjectDialog's mount focus.
  useEffect(() => {
    if (!commitOpen) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [commitOpen]);

  // Hide entirely on web — sandbox FS isn't available there.
  if (!SANDBOX_FS_AVAILABLE) return null;
  // Also hide before the first status pull lands so we don't flash
  // an "Initialise repository" CTA for a half-frame on a project
  // that already has a repo.
  if (status === null) return null;

  async function handleInit() {
    setBusy(true);
    setError(null);
    try {
      await fsGitInit(projectId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    const msg = commitMsg.trim();
    if (!msg) return;
    setBusy(true);
    setError(null);
    try {
      await fsGitCommit(projectId, msg);
      setCommitMsg("");
      setCommitOpen(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal() {
    try {
      await fsRevealProject(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Branches: no repo → init prompt; repo → status + commit.
  if (!status.hasRepo) {
    return (
      <section className="libre-sb-git" aria-label={t("sandbox.sourceControl")}>
        <header className="libre-sb-git__head">
          <span className="libre-sb-git__eyebrow">
            <Icon icon={gitBranch} size="xs" color="currentColor" />
            {t("sandbox.sourceControl")}
          </span>
        </header>
        <button
          type="button"
          className="libre-sb-git__init"
          onClick={() => void handleInit()}
          disabled={busy}
        >
          <Icon icon={plus} size="xs" color="currentColor" />
          <span>{t("sandbox.initRepo")}</span>
        </button>
        <button
          type="button"
          className="libre-sb-git__reveal"
          onClick={() => void handleReveal()}
          title={t("sandbox.showInFinderTitle")}
        >
          <Icon icon={folderOpen} size="xs" color="currentColor" />
          <span>{t("sandbox.showInFinder")}</span>
        </button>
        {error && <p className="libre-sb-git__error">{error}</p>}
      </section>
    );
  }

  const branch = status.branch || "main";
  const changeCount = status.files.length;

  return (
    <section className="libre-sb-git" aria-label={t("sandbox.sourceControl")}>
      <header className="libre-sb-git__head">
        <span className="libre-sb-git__eyebrow">
          <Icon icon={gitBranch} size="xs" color="currentColor" />
          {branch}
        </span>
        {changeCount > 0 && (
          <span className="libre-sb-git__count">
            {changeCount === 1
              ? t("sandbox.changeCount", { count: changeCount })
              : t("sandbox.changeCountPlural", { count: changeCount })}
          </span>
        )}
      </header>
      {changeCount > 0 ? (
        <>
          <ul className="libre-sb-git__changes">
            {status.files.slice(0, 8).map((f) => (
              <li key={f.path} className="libre-sb-git__change">
                <span
                  className="libre-sb-git__change-status"
                  title={describeStatus(f.status, t)}
                >
                  {f.status.trim() || "??"}
                </span>
                <span className="libre-sb-git__change-path" title={f.path}>
                  {f.path}
                </span>
              </li>
            ))}
            {status.files.length > 8 && (
              <li className="libre-sb-git__change libre-sb-git__change--more">
                {t("sandbox.moreChanges", { count: status.files.length - 8 })}
              </li>
            )}
          </ul>
          {commitOpen ? (
            <form className="libre-sb-git__commit-form" onSubmit={handleCommit}>
              <input
                ref={inputRef}
                type="text"
                className="libre-sb-git__commit-input"
                placeholder={t("sandbox.commitMessagePlaceholder")}
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                maxLength={140}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setCommitMsg("");
                    setCommitOpen(false);
                  }
                }}
              />
              <button
                type="submit"
                className="libre-sb-git__commit-submit"
                disabled={busy || commitMsg.trim().length === 0}
              >
                {t("sandbox.commit")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="libre-sb-git__commit-btn"
              onClick={() => setCommitOpen(true)}
              disabled={busy}
            >
              <Icon icon={gitCommit} size="xs" color="currentColor" />
              <span>{t("sandbox.commitChanges")}</span>
            </button>
          )}
        </>
      ) : latestCommit ? (
        <p className="libre-sb-git__latest" title={latestCommit.subject}>
          <span className="libre-sb-git__latest-hash">
            {latestCommit.hash.slice(0, 7)}
          </span>{" "}
          {latestCommit.subject}
        </p>
      ) : (
        <p className="libre-sb-git__empty">{t("sandbox.noCommitsYet")}</p>
      )}
      <button
        type="button"
        className="libre-sb-git__reveal"
        onClick={() => void handleReveal()}
        title={t("sandbox.showInFinderTitle")}
      >
        <Icon icon={folderOpen} size="xs" color="currentColor" />
        <span>Show in Finder</span>
      </button>
      {error && <p className="libre-sb-git__error">{error}</p>}
    </section>
  );
}

/// Friendly label for a porcelain status code. Hovering over the
/// 2-character badge in the changes list surfaces this so a learner
/// who's never used git CLI doesn't have to look up what "??" means.
function describeStatus(xy: string, t: TFunction): string {
  if (xy === "??") return t("sandbox.statusUntracked");
  if (xy.includes("A")) return t("sandbox.statusAdded");
  if (xy.includes("M")) return t("sandbox.statusModified");
  if (xy.includes("D")) return t("sandbox.statusDeleted");
  if (xy.includes("R")) return t("sandbox.statusRenamed");
  if (xy.includes("C")) return t("sandbox.statusCopied");
  if (xy.includes("U")) return t("sandbox.statusConflict");
  return xy;
}
