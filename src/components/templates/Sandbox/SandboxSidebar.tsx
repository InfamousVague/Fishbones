/// Sidebar slot rendered when the Sandbox view is active.
///
/// Layout (top → bottom):
///   1. libre.academy brand strip (shared with the production
///      Sidebar)
///   2. Project switcher — full-width project rows with a
///      language-coloured icon chip on the left, the project name
///      filling the rest, and a per-row two-tap-confirm delete (×
///      turns red on first click, second click commits). The
///      ACTIVE row gets a holographic foil overlay + white text so
///      the current project reads as "live / selected" — matches
///      the visual language used for completion stamps elsewhere
///      in the app.
///   3. File tree (SandboxFileTree) — the active project's files,
///      remounted on project switch so collapsed-folder state
///      doesn't carry stale paths
///   4. Source-control panel (SandboxGitPanel) — desktop only,
///      self-hides on web.
///
/// The hook lives in App.tsx so the editor (in SandboxView) and
/// the tree (here) share one source of truth. We accept the hook
/// result as a single prop rather than instantiating our own copy.

import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { plus } from "@base/primitives/icon/icons/plus";
import { folderTree } from "@base/primitives/icon/icons/folder-tree";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import SandboxFileTree from "./SandboxFileTree";
import NewProjectDialog from "./NewProjectDialog";
import SandboxGitPanel from "./SandboxGitPanel";
import Hologram from "@/components/atoms/Hologram/Hologram";
import { projectIcon } from "./sandboxIcons";
import { useT } from "@/i18n/i18n";
import type { UseSandboxProjectsResult } from "@/hooks/useSandboxProjects";
import "./SandboxSidebar.css";

interface Props {
  projects: UseSandboxProjectsResult;
}

export default function SandboxSidebar({ projects }: Props) {
  const t = useT();
  const {
    projects: list,
    activeProject,
    setActiveProjectId,
    createProject,
    deleteProject,
    files,
    setFiles,
    activeFileIdx,
    setActiveFileIdx,
  } = projects;

  // Two-tap-confirm pattern for deletes — first click flips the
  // row into a "confirm" state, second click commits. Keyed by
  // project id so the pending-confirm doesn't leak across rows
  // when the cursor moves.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <aside className="libre__sidebar libre-sb-sidebar" aria-label={t("sandbox.ariaLabel")}>
      {/* Libre.academy wordmark was retired from the sandbox
          sidebar — the sandbox is a tools surface, not a brand
          surface. The brand still appears on the production
          sidebar (in the library / lesson views), on certificates,
          and via the menu-bar popover; the sandbox just needs
          headroom for the project switcher + file tree. */}

      {/* ── Project switcher ─────────────────────────────────── */}
      <section className="libre-sb-sidebar__projects" aria-label={t("sandbox.projects")}>
        <header className="libre-sb-sidebar__projects-head">
          <span className="libre-sb-sidebar__eyebrow">
            <Icon icon={folderTree} size="sm" color="currentColor" />
            {t("sandbox.projects")}
          </span>
          <button
            type="button"
            className="libre-sb-sidebar__new-btn"
            onClick={() => setNewProjectOpen(true)}
            title={t("sandbox.newProject")}
            aria-label={t("sandbox.newProject")}
          >
            <Icon icon={plus} size="sm" color="currentColor" />
          </button>
        </header>
        <ul className="libre-sb-sidebar__project-list">
          {list.map((p) => {
            const isActive = p.id === activeProject.id;
            const isConfirming = confirmDeleteId === p.id;
            const langIcon = projectIcon(p.language);
            return (
              <li
                key={p.id}
                className={
                  "libre-sb-sidebar__project-row" +
                  (isActive ? " libre-sb-sidebar__project-row--active" : "")
                }
              >
                <button
                  type="button"
                  className={
                    "libre-sb-sidebar__project" +
                    (isActive ? " libre-sb-sidebar__project--active" : "")
                  }
                  onClick={() => {
                    setActiveProjectId(p.id);
                    setConfirmDeleteId(null);
                  }}
                  aria-current={isActive ? "page" : undefined}
                  title={p.name}
                >
                  {/* Holographic accent strip on the LEFT edge of
                      the active project row — replaces the
                      previous full-row foil. A thin rounded
                      vertical bar pinned to the row's left
                      gutter; the Hologram primitive renders
                      inset: 0 inside it, so the foil paints only
                      inside that small rounded strip. */}
                  {isActive && (
                    <span
                      className="libre-sb-sidebar__project-accent"
                      aria-hidden
                    >
                      <Hologram surface="light" intensity="vivid" sparkle="snake" />
                    </span>
                  )}
                  <span
                    className="libre-sb-sidebar__project-icon"
                    style={{ color: langIcon.color }}
                    aria-hidden
                  >
                    <Icon icon={langIcon.icon} size="sm" color="currentColor" />
                  </span>
                  <span className="libre-sb-sidebar__project-name">
                    {p.name}
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    "libre-sb-sidebar__project-delete" +
                    (isConfirming
                      ? " libre-sb-sidebar__project-delete--confirm"
                      : "")
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isConfirming) {
                      deleteProject(p.id);
                      setConfirmDeleteId(null);
                    } else {
                      setConfirmDeleteId(p.id);
                    }
                  }}
                  onMouseLeave={() => {
                    if (isConfirming) setConfirmDeleteId(null);
                  }}
                  title={
                    isConfirming
                      ? t("sandbox.confirmDeleteProject", { name: p.name })
                      : t("sandbox.deleteProject")
                  }
                  aria-label={
                    isConfirming
                      ? t("sandbox.ariaConfirmDelete", { name: p.name })
                      : t("sandbox.ariaDelete", { name: p.name })
                  }
                >
                  <Icon icon={xIcon} size="sm" color="currentColor" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── File tree for the active project ──────────────── */}
      <div className="libre-sb-sidebar__tree-wrap">
        <SandboxFileTree
          // Remount the tree on project switch so expanded-folder
          // state doesn't carry stale paths from a different
          // project.
          key={activeProject.id}
          files={files}
          activeIndex={activeFileIdx}
          onSelectFile={setActiveFileIdx}
          // Sandbox mutations — the tree owns the new-file / new-
          // folder / rename / delete UI. The hook's `setFiles`
          // takes either an array or an updater; the tree uses
          // the updater form so concurrent edits don't race.
          onMutateFiles={setFiles}
        />
      </div>

      {/* ── Source control panel (desktop only) ──────────────
          Anchored to the bottom of the sidebar. The panel
          internally hides itself on web + before its first
          status fetch lands, so the slot here is unconditional
          — the gate lives inside the component. We pass
          `activeProject.updatedAt` as the refresh trigger so
          every editor save (which touches updatedAt via the
          hook's setFiles) prompts a fresh `git status` poll. */}
      <SandboxGitPanel
        projectId={activeProject.id}
        refreshTick={Date.parse(activeProject.updatedAt) || 0}
      />

      {newProjectOpen && (
        <NewProjectDialog
          defaultLanguage={activeProject.language}
          onCancel={() => setNewProjectOpen(false)}
          onCreate={(name, language) => {
            createProject(name, language);
            setNewProjectOpen(false);
          }}
        />
      )}
    </aside>
  );
}
