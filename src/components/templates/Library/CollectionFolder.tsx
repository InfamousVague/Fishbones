import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { Collection } from "./collections";
import { localizedCollection } from "./collections";
import { useT } from "@/i18n/i18n";

/// One member's preview, rendered as a mini-card tile inside the folder
/// mosaic — cover art plus the same title / subtitle / editorial-tier
/// chrome the full Library card shows, just shrunk.
export interface CollectionMember {
  id: string;
  title: string;
  /// Author / pack source line under the title.
  subtitle: string;
  coverUrl?: string;
  /// Editorial tier label (VERIFIED / BETA / ALPHA / UNREVIEWED).
  status: string;
}

interface Props {
  collection: Collection;
  /// Up to four member previews for the folder mosaic.
  members: CollectionMember[];
  /// How many members the folder holds in the current scope.
  count: number;
  onOpen: () => void;
  /// Right-click handler — the parent surfaces the collection context
  /// menu (Install collection / Delete collection) here.
  onContextMenu?: (e: ReactMouseEvent) => void;
  style?: CSSProperties;
}

/// A "folder" tile for a curated collection. Sits in the shelf alongside
/// book covers; clicking it opens a filtered view of the collection's
/// members. The face is a 2×2 mosaic of member mini-cards (cover +
/// title + subtitle + tier pill) under a frosted label bar, so it reads
/// as a stack-of-things and previews what's inside at a glance.
export default function CollectionFolder({
  collection,
  members,
  count,
  onOpen,
  onContextMenu,
  style,
}: Props) {
  const t = useT();
  const { title, blurb } = localizedCollection(collection, t);
  const cells = members.slice(0, 4);
  return (
    <div
      className="libre-collection-folder-wrap"
      style={{ ["--collection-accent" as string]: collection.accent, ...style }}
    >
    <button
      type="button"
      className="libre-collection-folder"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      aria-label={
        count === 1
          ? t("library.openCollectionAria", { title, count })
          : t("library.openCollectionAriaPlural", { title, count })
      }
      title={blurb}
    >
      <div className="libre-collection-folder-mosaic" aria-hidden>
        {cells.map((m) => (
          <span className="libre-collection-folder-cell" key={m.id}>
            {m.coverUrl ? (
              <img src={m.coverUrl} alt="" loading="lazy" draggable={false} />
            ) : (
              <span className="libre-collection-folder-cell-blank" />
            )}
            <span className="libre-collection-folder-cell-shade" />
            <span className="libre-collection-folder-cell-meta">
              <span className="libre-collection-folder-cell-title">
                {m.title}
              </span>
              {m.subtitle && (
                <span className="libre-collection-folder-cell-sub">
                  {m.subtitle}
                </span>
              )}
            </span>
          </span>
        ))}
      </div>
      <span className="libre-collection-folder-label">
        <span className="libre-collection-folder-tag">{collection.short}</span>
      </span>
    </button>
    <span className="libre-collection-folder-title">
      {title}
      <span className="libre-collection-folder-count">{count}</span>
    </span>
    </div>
  );
}
