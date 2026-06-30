/// VS Code-style file tree rendered in the sidebar slot while the
/// Sandbox view is active. Reads the active project's flat
/// `WorkbenchFile[]` and builds a path-derived folder tree
/// (`buildTree` in ./fileTreeData.ts) so files whose names include
/// slashes group into nested folders without any real folder data
/// model.
///
/// Interactions:
///   - Click a file row → calls `onSelectFile(index)`.
///   - Click a folder row → toggles expand/collapse.
///   - Header "+" buttons → create a new file or folder at root.
///   - Right-click a folder → context menu with "New file
///     inside", "New folder inside", "Rename", "Delete".
///   - Right-click a file → "Rename", "Delete".
///   - F2 / double-click a file row → inline rename.
///
/// "New folder" creates a `<path>/.gitkeep` placeholder so the
/// folder appears in the path-derived tree without needing a
/// separate folder data model. The `.gitkeep` file is intentionally
/// visible — same convention as `git`'s, and a learner who deletes
/// it understands what they've done.
///
/// All mutations flow through `onMutateFiles`, which the sidebar
/// wires to the `useSandboxProjects` hook's `setFiles`. That hook
/// in turn debounces a write to disk (Tauri) + localStorage so the
/// changes are durable.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Icon } from "@base/primitives/icon";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import { chevronRight } from "@base/primitives/icon/icons/chevron-right";
import { folder as folderIcon } from "@base/primitives/icon/icons/folder";
import { folderOpen } from "@base/primitives/icon/icons/folder-open";
import { filePlus } from "@base/primitives/icon/icons/file-plus";
import { folderPlus } from "@base/primitives/icon/icons/folder-plus";
import { pen as penIcon } from "@base/primitives/icon/icons/pen";
import { trash as trashIcon } from "@base/primitives/icon/icons/trash";
import "@base/primitives/icon/icon.css";
import type { WorkbenchFile, FileLanguage } from "@/data/types";
import Hologram from "@/components/atoms/Hologram/Hologram";
import { buildTree, type TreeNode } from "./fileTreeData";
import { fileIcon } from "./sandboxIcons";
import { useDismiss } from "@/hooks/useDismiss";
import { useT } from "@/i18n/i18n";
import "./SandboxFileTree.css";

interface Props {
  files: ReadonlyArray<WorkbenchFile>;
  activeIndex: number;
  onSelectFile: (index: number) => void;
  /// React.Dispatch-shaped setter for the workbench file list.
  /// The tree calls this for create / rename / delete. Optional —
  /// when absent the tree renders read-only (no buttons / menus),
  /// useful for surfaces that want the visualisation without the
  /// mutation affordances.
  onMutateFiles?: React.Dispatch<React.SetStateAction<WorkbenchFile[]>>;
}

/// In-progress create / rename overlay. The tree replaces the
/// matching row (or appends a new row at the parent path) with an
/// inline input until the user commits or cancels.
type PendingEdit =
  | { kind: "create-file"; parentPath: string }
  | { kind: "create-folder"; parentPath: string }
  | { kind: "rename"; path: string };

/// Position + payload for the right-click context menu. Null when
/// no menu is open.
type MenuTarget =
  | { kind: "file"; path: string; x: number; y: number }
  | { kind: "folder"; path: string; x: number; y: number }
  | null;

export default function SandboxFileTree({
  files,
  activeIndex,
  onSelectFile,
  onMutateFiles,
}: Props) {
  const t = useT();
  // Collapsed folder paths — sticky across re-renders, reset on
  // project switch by the parent passing `key={projectId}`. Default
  // to ALL folders expanded so a newcomer sees every file without
  // having to click around first.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [menu, setMenu] = useState<MenuTarget>(null);
  // Empty folders that the user explicitly created but haven't put
  // any files in yet. We track them in memory rather than dropping
  // a `.gitkeep` placeholder onto disk — the user doesn't want
  // their on-disk project polluted with sentinel files just to
  // anchor an empty folder. Resets on project switch (since the
  // tree is remounted via `key={activeProject.id}`), which means
  // truly-empty folders are session-local; once a file lands
  // inside, the folder persists via the file's path-derived
  // structure and no longer needs the explicit anchor.
  const [emptyFolders, setEmptyFolders] = useState<Set<string>>(new Set());

  const tree = buildTree(files, Array.from(emptyFolders));

  function toggleFolder(path: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    // When the user expands a folder, automatically reveal a
    // pending create that was queued inside it. (Reverse case isn't
    // an issue — collapsing while the input is mounted keeps the
    // input alive in the DOM but visually hidden, which is fine.)
  }

  // Mutators — each opens a pending edit; the input row commits or
  // cancels. We DON'T mutate `files` directly from inside the
  // tree's render path; everything flows through `onMutateFiles`
  // which the parent owns.
  function commitCreate(parentPath: string, kind: "file" | "folder", name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Reject names with `/` — the user creates one level at a time.
    // Path-derived folders are the workaround for "I want
    // foo/bar/baz" (split + create each step), and rejecting `/`
    // keeps the rename + delete cursor-on-leaf semantics honest.
    if (trimmed.includes("/")) return;
    const full = parentPath ? `${parentPath}/${trimmed}` : trimmed;

    if (kind === "folder") {
      // Empty folders are tracked in memory (no `.gitkeep` placeholder
      // on disk). They show in the tree until the user adds a file
      // inside; after that the folder lives via the file's path-
      // derived structure and the explicit anchor is redundant.
      if (emptyFolders.has(full)) {
        setPending(null);
        return;
      }
      setEmptyFolders((prev) => {
        const next = new Set(prev);
        next.add(full);
        return next;
      });
      setPending(null);
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(full);
        return next;
      });
      return;
    }

    if (!onMutateFiles) return;
    // Skip if a file at that exact path already exists — the input
    // commit shouldn't silently clobber an existing leaf.
    if (files.some((f) => f.name === full)) {
      setPending(null);
      return;
    }
    const lang = languageForFilename(full);
    onMutateFiles((prev) => [
      ...prev,
      { name: full, language: lang, content: "" },
    ]);
    setPending(null);
  }

  function commitRename(path: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (trimmed.includes("/")) return;
    const parent = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    const nextPath = parent ? `${parent}/${trimmed}` : trimmed;
    if (nextPath === path) {
      setPending(null);
      return;
    }

    // Folder rename: detect by checking either the empty-folders
    // set or whether any file path is rooted at `<path>/`. Rename
    // every descendant file's path + update the empty-folders
    // entry if present.
    const isFolder =
      emptyFolders.has(path) || files.some((f) => f.name.startsWith(`${path}/`));
    if (isFolder) {
      // Collision: another folder / file already exists at the new
      // path. Drop the rename so we don't merge two trees by accident.
      if (
        emptyFolders.has(nextPath) ||
        files.some(
          (f) => f.name === nextPath || f.name.startsWith(`${nextPath}/`),
        )
      ) {
        setPending(null);
        return;
      }
      if (onMutateFiles) {
        onMutateFiles((prev) =>
          prev.map((f) => {
            if (!f.name.startsWith(`${path}/`)) return f;
            const tail = f.name.slice(path.length);
            const renamed = `${nextPath}${tail}`;
            return {
              ...f,
              name: renamed,
              language: languageForFilename(renamed),
            };
          }),
        );
      }
      setEmptyFolders((prev) => {
        const out = new Set<string>();
        for (const entry of prev) {
          if (entry === path) out.add(nextPath);
          else if (entry.startsWith(`${path}/`))
            out.add(`${nextPath}${entry.slice(path.length)}`);
          else out.add(entry);
        }
        return out;
      });
      setPending(null);
      return;
    }

    // File rename
    if (!onMutateFiles) return;
    const idx = files.findIndex((f) => f.name === path);
    if (idx < 0) {
      setPending(null);
      return;
    }
    if (files.some((f) => f.name === nextPath)) {
      // Name collision — drop the rename rather than silently
      // overwriting a sibling.
      setPending(null);
      return;
    }
    onMutateFiles((prev) =>
      prev.map((f) =>
        f.name === path
          ? { ...f, name: nextPath, language: languageForFilename(nextPath) }
          : f,
      ),
    );
    setPending(null);
  }

  function deletePath(path: string) {
    // Folder delete: drop every file whose path starts with
    // `<path>/`. File delete: drop the single matching file. We
    // don't ask for confirmation — Cmd+Z would be the ideal undo
    // but Workbench history isn't plumbed here yet; the cost of an
    // accidental delete is bounded by the project's localStorage +
    // disk redundancy.
    if (onMutateFiles) {
      onMutateFiles((prev) =>
        prev.filter((f) => f.name !== path && !f.name.startsWith(`${path}/`)),
      );
    }
    // Also prune any in-memory empty-folder entries rooted at this
    // path — otherwise a deleted folder would linger as a ghost
    // entry until the next project switch.
    setEmptyFolders((prev) => {
      const out = new Set<string>();
      for (const entry of prev) {
        if (entry !== path && !entry.startsWith(`${path}/`)) out.add(entry);
      }
      return out;
    });
    setMenu(null);
  }

  // Dismiss context menu on any click outside it (+ Escape). The
  // capture-phase outside check via `menuRef` replaces the menu's old
  // `stopPropagation` self-exclusion. `event: "click"` preserves the
  // original semantics — a click on a menu item still runs the item's
  // own onClick before the outside-dismiss fires.
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menuRef, closeMenu, { enabled: !!menu, event: "click" });

  return (
    <nav className="libre-sbft" aria-label={t("sandbox.ariaSandboxFiles")}>
      <header className="libre-sbft__head">
        <span className="libre-sbft__eyebrow">Files</span>
        <div className="libre-sbft__head-actions">
          {onMutateFiles && (
            <>
              <button
                type="button"
                className="libre-sbft__head-btn"
                onClick={() =>
                  setPending({ kind: "create-file", parentPath: "" })
                }
                title={t("sandbox.newFile")}
                aria-label={t("sandbox.newFile")}
              >
                <Icon icon={filePlus} size="base" color="currentColor" />
              </button>
              <button
                type="button"
                className="libre-sbft__head-btn"
                onClick={() =>
                  setPending({ kind: "create-folder", parentPath: "" })
                }
                title={t("sandbox.newFolder")}
                aria-label={t("sandbox.newFolder")}
              >
                <Icon icon={folderPlus} size="base" color="currentColor" />
              </button>
            </>
          )}
          <span className="libre-sbft__count" aria-hidden>
            {files.length}
          </span>
        </div>
      </header>

      <ul className="libre-sbft__list libre-sbft__list--root">
        {/* Pending create-at-root: render an editable row at the top
            so the user can type the name without having to scroll
            anywhere. */}
        {pending &&
          (pending.kind === "create-file" || pending.kind === "create-folder") &&
          pending.parentPath === "" && (
            <CreateInputRow
              kind={pending.kind === "create-file" ? "file" : "folder"}
              depth={0}
              onCommit={(name) =>
                commitCreate(
                  "",
                  pending.kind === "create-file" ? "file" : "folder",
                  name,
                )
              }
              onCancel={() => setPending(null)}
            />
          )}
        {tree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            activeIndex={activeIndex}
            collapsed={collapsed}
            pending={pending}
            onToggleFolder={toggleFolder}
            onSelectFile={onSelectFile}
            onCommitCreate={commitCreate}
            onCommitRename={commitRename}
            onCancelPending={() => setPending(null)}
            onStartCreate={(parentPath, kind) =>
              setPending({
                kind: kind === "file" ? "create-file" : "create-folder",
                parentPath,
              })
            }
            onStartRename={(path) => setPending({ kind: "rename", path })}
            onDelete={deletePath}
            onContextMenu={(e, kind, path) => {
              if (!onMutateFiles) return;
              e.preventDefault();
              e.stopPropagation();
              setMenu({ kind, path, x: e.clientX, y: e.clientY });
            }}
          />
        ))}
      </ul>

      {menu && (
        <ContextMenu
          menuRef={menuRef}
          target={menu}
          onClose={() => setMenu(null)}
          onNewFile={(parentPath) =>
            setPending({ kind: "create-file", parentPath })
          }
          onNewFolder={(parentPath) =>
            setPending({ kind: "create-folder", parentPath })
          }
          onRename={(path) => setPending({ kind: "rename", path })}
          onDelete={deletePath}
        />
      )}
    </nav>
  );
}

// ── TreeRow ──────────────────────────────────────────────────────

interface RowProps {
  node: TreeNode;
  depth: number;
  activeIndex: number;
  collapsed: Set<string>;
  pending: PendingEdit | null;
  onToggleFolder: (path: string) => void;
  onSelectFile: (index: number) => void;
  onCommitCreate: (parentPath: string, kind: "file" | "folder", name: string) => void;
  onCommitRename: (path: string, newName: string) => void;
  onCancelPending: () => void;
  onStartCreate: (parentPath: string, kind: "file" | "folder") => void;
  onStartRename: (path: string) => void;
  onDelete: (path: string) => void;
  onContextMenu: (
    e: MouseEvent<HTMLElement>,
    kind: "file" | "folder",
    path: string,
  ) => void;
}

function TreeRow(props: RowProps) {
  const t = useT();
  const {
    node,
    depth,
    activeIndex,
    collapsed,
    pending,
    onToggleFolder,
    onSelectFile,
    onCommitCreate,
    onCommitRename,
    onCancelPending,
    onStartCreate: onStartCreate,
    onStartRename,
    onDelete,
    onContextMenu,
  } = props;

  // Indent each level by a fixed amount. Inline style so depth (a
  // dynamic value) doesn't need a class-per-depth.
  const indent: React.CSSProperties = {
    paddingLeft: `${10 + depth * 12}px`,
  };

  if (node.kind === "folder") {
    const isCollapsed = collapsed.has(node.path);
    return (
      <li>
        {pending?.kind === "rename" && pending.path === node.path ? (
          <CreateInputRow
            kind="folder"
            depth={depth}
            initial={node.name}
            onCommit={(name) => onCommitRename(node.path, name)}
            onCancel={onCancelPending}
          />
        ) : (
          // Folder row is a div with role="button" (NOT a real
          // <button>) because it contains its own action buttons
          // (new file / new folder / delete) — nested buttons are
          // an HTML validation error and React 19 surfaces them as
          // a hydration error in dev. `role="button"` + `tabIndex`
          // + keyboard handlers preserve full a11y semantics
          // without the nesting violation.
          <div
            role="button"
            tabIndex={0}
            className="libre-sbft__row libre-sbft__row--folder"
            style={indent}
            onClick={() => onToggleFolder(node.path)}
            onDoubleClick={() => onStartRename(node.path)}
            onContextMenu={(e) => onContextMenu(e, "folder", node.path)}
            onKeyDown={(e) => {
              // Activate on Enter / Space — the keyboard equivalent
              // of clicking the row. Space gets preventDefault so it
              // doesn't scroll the file list. Other keys (arrows for
              // future tree navigation) pass through.
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleFolder(node.path);
              }
            }}
            aria-expanded={!isCollapsed}
            title={node.path}
          >
            {/* Folder icon sits flush-left now; the chevron has
                moved to the trailing edge (see `__caret--trailing`
                below) so the file icons one tier down align with
                this folder icon's left edge instead of being
                pushed in by a leading chevron column. */}
            <span
              className="libre-sbft__icon"
              style={{ color: "var(--color-accent, #d4c5a1)" }}
              aria-hidden
            >
              <Icon
                icon={isCollapsed ? folderIcon : folderOpen}
                size="base"
                color="currentColor"
              />
            </span>
            <span className="libre-sbft__label">{node.name}</span>
            <span
              className="libre-sbft__caret libre-sbft__caret--trailing"
              aria-hidden
            >
              <Icon
                icon={isCollapsed ? chevronRight : chevronDown}
                size="base"
                color="currentColor"
              />
            </span>
            <span className="libre-sbft__row-actions">
              <button
                type="button"
                className="libre-sbft__row-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartCreate(node.path, "file");
                  if (collapsed.has(node.path)) onToggleFolder(node.path);
                }}
                title={t("sandbox.newFileInFolder")}
              >
                <Icon icon={filePlus} size="base" color="currentColor" />
              </button>
              <button
                type="button"
                className="libre-sbft__row-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartCreate(node.path, "folder");
                  if (collapsed.has(node.path)) onToggleFolder(node.path);
                }}
                title={t("sandbox.newFolderInFolder")}
              >
                <Icon icon={folderPlus} size="base" color="currentColor" />
              </button>
              <button
                type="button"
                className="libre-sbft__row-btn libre-sbft__row-btn--danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(node.path);
                }}
                title={t("sandbox.deleteFolder")}
              >
                <Icon icon={trashIcon} size="base" color="currentColor" />
              </button>
            </span>
          </div>
        )}
        {!isCollapsed && (
          <ul className="libre-sbft__list">
            {/* Pending create inside this folder — render at top
                of the children list. */}
            {pending &&
              (pending.kind === "create-file" || pending.kind === "create-folder") &&
              pending.parentPath === node.path && (
                <CreateInputRow
                  kind={pending.kind === "create-file" ? "file" : "folder"}
                  depth={depth + 1}
                  onCommit={(name) =>
                    onCommitCreate(
                      node.path,
                      pending.kind === "create-file" ? "file" : "folder",
                      name,
                    )
                  }
                  onCancel={onCancelPending}
                />
              )}
            {node.children.map((child) => (
              <TreeRow {...props} key={child.path} node={child} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  // File row
  const isActive = node.index === activeIndex;
  const fIcon = fileIcon(node.name);

  if (pending?.kind === "rename" && pending.path === node.path) {
    return (
      <li>
        <CreateInputRow
          kind="file"
          depth={depth}
          initial={node.name}
          onCommit={(name) => onCommitRename(node.path, name)}
          onCancel={onCancelPending}
        />
      </li>
    );
  }

  return (
    <li>
      {/* File row uses div+role="button" for the same reason the
          folder row does — the action cluster (rename / delete)
          on the right is made of real <button> elements, and a
          <button> can't contain another <button>. Enter/Space
          handlers preserve keyboard activation. */}
      <div
        role="button"
        tabIndex={0}
        className={
          "libre-sbft__row libre-sbft__row--file" +
          (isActive ? " libre-sbft__row--active" : "")
        }
        style={indent}
        onClick={() => onSelectFile(node.index)}
        onDoubleClick={() => onStartRename(node.path)}
        onContextMenu={(e) => onContextMenu(e, "file", node.path)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectFile(node.index);
          }
        }}
        aria-current={isActive ? "true" : undefined}
        title={node.path}
      >
        {/* Holographic accent strip on the LEFT edge of the active
            file row — replaces the previous full-row foil. The
            outer `__row-accent` span owns the position +
            border-radius (a thin rounded vertical bar pinned to
            the row's left gutter); the Hologram primitive renders
            inset: 0 inside it, so the foil paints only inside
            that 3px-wide rounded strip. */}
        {isActive && (
          <span className="libre-sbft__row-accent" aria-hidden>
            <Hologram surface="light" intensity="vivid" sparkle="snake" />
          </span>
        )}
        {/* No leading caret spacer — folder rows now place their
            chevron on the TRAILING edge, so file icons can sit
            flush-left and align with their sibling folder icons
            naturally. */}
        <span
          className="libre-sbft__icon"
          style={{ color: fIcon.color }}
          aria-hidden
        >
          <Icon icon={fIcon.icon} size="base" color="currentColor" />
        </span>
        <span className="libre-sbft__label">{node.name}</span>
        <span className="libre-sbft__row-actions">
          <button
            type="button"
            className="libre-sbft__row-btn"
            onClick={(e) => {
              e.stopPropagation();
              onStartRename(node.path);
            }}
            title={t("sandbox.renameTooltip")}
          >
            <Icon icon={penIcon} size="base" color="currentColor" />
          </button>
          <button
            type="button"
            className="libre-sbft__row-btn libre-sbft__row-btn--danger"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.path);
            }}
            title={t("sandbox.deleteFile")}
          >
            <Icon icon={trashIcon} size="base" color="currentColor" />
          </button>
        </span>
      </div>
    </li>
  );
}

// ── CreateInputRow ───────────────────────────────────────────────

interface CreateInputRowProps {
  kind: "file" | "folder";
  depth: number;
  initial?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

/// Inline editable row that replaces / inserts a tree row during a
/// create or rename. Auto-focuses on mount and commits on Enter /
/// blur; Esc cancels.
function CreateInputRow({
  kind,
  depth,
  initial,
  onCommit,
  onCancel,
}: CreateInputRowProps) {
  const t = useT();
  const [value, setValue] = useState(initial ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep fresh refs to the latest value + commit/cancel
  // callbacks so the document-level mousedown handler (registered
  // once on mount) always reaches the current closure state. The
  // parent recreates `onCommit` / `onCancel` on every render
  // (they close over the latest `files` / `emptyFolders` state on
  // the tree); without these refs the handler would commit using
  // a snapshot taken at the moment the input mounted.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    // Defer one frame so the parent's tree-row layout has settled
    // before we grab focus — same shape as NewProjectDialog.
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      if (initial) {
        // On rename, pre-select the basename portion (before any
        // extension dot) so typing replaces the name but keeps the
        // extension — the VSCode rename UX.
        const dot = initial.lastIndexOf(".");
        if (dot > 0) {
          inputRef.current?.setSelectionRange(0, dot);
        } else {
          inputRef.current?.select();
        }
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [initial]);

  // Click-anywhere-outside commits the rename. Native `onBlur`
  // alone wasn't enough: clicking on a non-focusable element (a
  // bare `<div>` in the editor pane, the empty sidebar margin,
  // etc.) doesn't shift focus, so the blur event never fires and
  // the rename input stays open even though the user clearly
  // moved on. A document-level `mousedown` listener catches the
  // outside click regardless of target focusability and commits
  // the current value — same UX as VSCode / Finder's rename. We
  // listen on `mousedown` (not `click`) so the commit happens
  // BEFORE the target's own click handler runs; otherwise
  // clicking another file row would `setActiveFileIdx` before
  // our rename had a chance to land.
  useEffect(() => {
    // Defer attachment so the click that OPENED this rename
    // doesn't immediately fire the handler and close it.
    const attach = window.setTimeout(() => {
      window.addEventListener("mousedown", onOutside);
    }, 0);
    // The local `MouseEvent` symbol resolves to React's
    // `MouseEvent<Element>` (because this file imports it from
    // react above), but the DOM listener wants the global one.
    // `globalThis.MouseEvent` is the unambiguous DOM type.
    function onOutside(e: globalThis.MouseEvent) {
      const input = inputRef.current;
      if (!input) return;
      if (input.contains(e.target as Node)) return;
      const v = valueRef.current;
      if (v.trim()) onCommitRef.current(v);
      else onCancelRef.current();
    }
    return () => {
      window.clearTimeout(attach);
      window.removeEventListener("mousedown", onOutside);
    };
    // We intentionally don't list `onCommit` / `onCancel` here —
    // the parent re-creates them every render but the ref-backed
    // value pipeline above means the latest commit logic always
    // gets the latest value. Avoiding the deps lets us bind the
    // listener once on mount + unbind on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const indent: React.CSSProperties = {
    paddingLeft: `${10 + depth * 12}px`,
  };

  return (
    <li>
      <div
        className={
          "libre-sbft__row libre-sbft__row--input" +
          (kind === "folder" ? " libre-sbft__row--input-folder" : "")
        }
        style={indent}
      >
        <span
          className="libre-sbft__icon"
          style={{
            color:
              kind === "folder"
                ? "var(--color-accent, #d4c5a1)"
                : fileIcon(value || "untitled").color,
          }}
          aria-hidden
        >
          <Icon
            icon={kind === "folder" ? folderOpen : fileIcon(value || "untitled").icon}
            size="base"
            color="currentColor"
          />
        </span>
        <input
          ref={inputRef}
          type="text"
          className="libre-sbft__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          // Commit on blur too — matches VSCode's "click anywhere
          // outside to confirm" behaviour. An empty value still
          // commits (the parent's commit guard drops it silently).
          onBlur={() => {
            if (value.trim()) onCommit(value);
            else onCancel();
          }}
          placeholder={kind === "folder" ? t("sandbox.foldernamePlaceholder") : t("sandbox.filenamePlaceholder")}
          spellCheck={false}
        />
      </div>
    </li>
  );
}

// ── ContextMenu ──────────────────────────────────────────────────

interface ContextMenuProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  target: NonNullable<MenuTarget>;
  onClose: () => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
}

/// Tiny right-click menu. Uses the global `.libre__context-menu*`
/// styles defined in the production sidebar's CSS so the visual
/// matches the course context menu without re-implementing the
/// chrome here.
function ContextMenu({
  menuRef,
  target,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: ContextMenuProps) {
  const t = useT();
  return (
    <div
      ref={menuRef}
      className="libre__context-menu"
      style={{
        left: target.x,
        top: target.y,
        position: "fixed",
        zIndex: 1000,
      }}
    >
      <div className="libre__context-menu-label">{target.path}</div>
      {target.kind === "folder" && (
        <>
          <button
            type="button"
            className="libre__context-menu-item"
            onClick={() => {
              onNewFile(target.path);
              onClose();
            }}
          >
            <span className="libre__context-menu-icon" aria-hidden>
              <Icon icon={filePlus} size="sm" color="currentColor" />
            </span>
            {t("sandbox.menuNewFile")}
          </button>
          <button
            type="button"
            className="libre__context-menu-item"
            onClick={() => {
              onNewFolder(target.path);
              onClose();
            }}
          >
            <span className="libre__context-menu-icon" aria-hidden>
              <Icon icon={folderPlus} size="sm" color="currentColor" />
            </span>
            {t("sandbox.menuNewFolder")}
          </button>
          <div className="libre__context-menu-sep" aria-hidden />
        </>
      )}
      <button
        type="button"
        className="libre__context-menu-item"
        onClick={() => {
          onRename(target.path);
          onClose();
        }}
      >
        <span className="libre__context-menu-icon" aria-hidden>
          <Icon icon={penIcon} size="sm" color="currentColor" />
        </span>
        {t("sandbox.menuRename")}
      </button>
      <div className="libre__context-menu-sep" aria-hidden />
      <button
        type="button"
        className="libre__context-menu-item libre__context-menu-item--danger"
        onClick={() => {
          onDelete(target.path);
          onClose();
        }}
      >
        <span className="libre__context-menu-icon" aria-hidden>
          <Icon icon={trashIcon} size="sm" color="currentColor" />
        </span>
        {target.kind === "folder" ? t("sandbox.menuDeleteFolder") : t("sandbox.menuDeleteFile")}
      </button>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

/// Derive a Monaco language id from a filename. Mirrors the Rust
/// side's `guess_language` so a file created in the tree picks up
/// the same syntax-highlighting Monaco would assign once the file
/// is opened in the editor.
function languageForFilename(name: string): FileLanguage {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "mts":
    case "cts":
    case "tsx":
      return "typescript";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "swift":
      return "swift";
    case "kt":
    case "kts":
      return "kotlin";
    case "cs":
      return "csharp";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
      return "cpp";
    case "java":
      return "java";
    case "sol":
      return "solidity";
    case "vy":
      return "vyper";
    case "svelte":
      return "svelte";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "json":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    // FileLanguage doesn't ship Monaco grammars for yaml / toml /
    // shell yet — fall back to plaintext so the file is editable
    // with no highlighting rather than failing the type check.
    default:
      return "plaintext";
  }
}
