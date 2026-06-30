/// Path-derived folder structure for the Playground's flat
/// `WorkbenchFile[]`. We don't have a real Folder model — files
/// carry a string `name` that may include `/`s — so the tree is
/// computed at render time from those paths.
///
/// `src/main.ts` + `src/utils.ts` + `README.md` collapses into:
///
///   src/
///     main.ts
///     utils.ts
///   README.md
///
/// Folders are inferred purely from path segments; renaming a file
/// to a new path (e.g. `main.ts` → `src/main.ts`) effectively
/// "moves" it into a folder without any folder-creation step.
///
/// Mutations on the file list (rename, delete, new file) are
/// helpers here too, so the tree component + any context-menu
/// surface share the same path-aware logic.

import type { WorkbenchFile } from "@/data/types";

/// A node in the rendered tree. Folders carry children; files
/// carry the index back into the original flat `files` array so
/// click handlers can switch the editor's active index without
/// re-walking the tree.
export type TreeNode =
  | {
      kind: "folder";
      /// Segment name (not the full path) — e.g. "src" or
      /// "components". Display label in the tree row.
      name: string;
      /// Full path from root, including this folder's segment.
      /// Used as the stable key for expand/collapse state +
      /// "create file in this folder" affordances.
      path: string;
      children: TreeNode[];
    }
  | {
      kind: "file";
      /// Bare filename (last path segment) — e.g. "main.ts".
      name: string;
      /// Full path from root — matches the WorkbenchFile's
      /// `name` field. Stable key for React + lookup back into
      /// the flat list.
      path: string;
      /// Index into the original flat `WorkbenchFile[]`. The
      /// Tree component passes this to `setActiveFileIdx` when
      /// the row is clicked.
      index: number;
    };

/// Walk the flat file list and produce a nested tree. The tree's
/// top-level entries are sorted folders-first, alphabetical within
/// each tier — the standard VS Code Explorer ordering. We don't
/// mutate the input array; each render produces a fresh tree.
///
/// `emptyFolders` is an optional list of folder paths that should
/// appear in the tree even when they contain no files. The Sandbox
/// tree uses this so a newly-created folder can show up before the
/// user puts anything in it, without us having to write a hidden
/// `.gitkeep` file just to anchor an otherwise-implicit folder.
export function buildTree(
  files: ReadonlyArray<WorkbenchFile>,
  emptyFolders: ReadonlyArray<string> = [],
): TreeNode[] {
  const root: TreeNode[] = [];

  function ensureFolder(segments: string[]): TreeNode[] {
    // Returns the children list of the folder reached by walking
    // `segments`. Creates intermediate folder nodes as it goes.
    let cursor = root;
    let runningPath = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      runningPath = runningPath ? `${runningPath}/${seg}` : seg;
      let folder = cursor.find(
        (n) => n.kind === "folder" && n.name === seg,
      ) as Extract<TreeNode, { kind: "folder" }> | undefined;
      if (!folder) {
        folder = { kind: "folder", name: seg, path: runningPath, children: [] };
        cursor.push(folder);
      }
      cursor = folder.children;
    }
    return cursor;
  }

  files.forEach((file, index) => {
    const segments = file.name.split("/").filter(Boolean);
    if (segments.length === 0) return; // unnamed file — skip

    // Walk / create folder nodes for every segment except the
    // last (which is the file itself).
    const parentChildren = ensureFolder(segments.slice(0, -1));

    // The leaf — a file node.
    const fileName = segments[segments.length - 1];
    parentChildren.push({
      kind: "file",
      name: fileName,
      path: file.name,
      index,
    });
  });

  // Inject explicit-empty folders. `ensureFolder` is idempotent —
  // if a folder already exists from the files loop above, it's
  // reused; otherwise a fresh empty-children folder is created.
  emptyFolders.forEach((path) => {
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return;
    ensureFolder(segments);
  });

  return sortTreeInPlace(root);
}

/// Recursively sort each level: folders first (alphabetical),
/// then files (alphabetical). Mutates the array since we just
/// built it ourselves; the function is internal so the
/// "in-place" mutation isn't leaking through the public API.
function sortTreeInPlace(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.kind === "folder") sortTreeInPlace(node.children);
  }
  return nodes;
}
