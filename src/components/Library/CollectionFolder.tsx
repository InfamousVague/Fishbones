import type { CSSProperties } from "react";
import type { Collection } from "./collections";

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
  style,
}: Props) {
  const cells = members.slice(0, 4);
  return (
    <button
      type="button"
      className="libre-collection-folder"
      style={{ ["--collection-accent" as string]: collection.accent, ...style }}
      onClick={onOpen}
      aria-label={`Open the ${collection.title} collection — ${count} item${count === 1 ? "" : "s"}`}
      title={collection.blurb}
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
            {m.status && (
              <span
                className={`libre-collection-folder-cell-status libre-collection-folder-cell-status--${m.status.toLowerCase()}`}
              >
                {m.status}
              </span>
            )}
          </span>
        ))}
      </div>
      <span className="libre-collection-folder-label">
        <span className="libre-collection-folder-title">{collection.title}</span>
        <span className="libre-collection-folder-count">{count}</span>
      </span>
    </button>
  );
}
