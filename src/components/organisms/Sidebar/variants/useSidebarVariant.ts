/// Hook + persistence layer for "which sidebar variant is the user
/// trying out right now?". Reads from localStorage on mount, writes
/// every change back, and notifies subscribers so the floating
/// picker panel and the App-level sidebar slot stay in sync without
/// prop drilling.
///
/// Treated as a dev/preview feature — there's no settings-UI for it
/// today (the picker is its own floating panel) and no migration
/// path if a variant id is later removed; an unknown id silently
/// falls back to the registry's default ("classic").

import { useEffect, useState } from "react";
import { DEFAULT_VARIANT_ID, isKnownVariant, type VariantId } from "./registry";

const STORAGE_KEY = "libre:sidebar:variant";

const listeners = new Set<(id: VariantId) => void>();

function readStored(): VariantId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isKnownVariant(raw)) return raw;
  } catch {
    /* private mode / SSR — fall through to default */
  }
  return DEFAULT_VARIANT_ID;
}

function writeStored(id: VariantId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* swallow */
  }
}

/// Single source of truth for the active variant. Subscribed by every
/// hook instance so flipping the variant in the picker updates every
/// sidebar mount point in the same tick.
let currentId: VariantId | null = null;

function ensureCurrent(): VariantId {
  if (currentId === null) currentId = readStored();
  return currentId;
}

export function useSidebarVariant(): [VariantId, (id: VariantId) => void] {
  const [id, setId] = useState<VariantId>(() => ensureCurrent());

  useEffect(() => {
    const handler = (next: VariantId) => setId(next);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  function set(next: VariantId): void {
    currentId = next;
    writeStored(next);
    for (const fn of listeners) fn(next);
  }

  return [id, set];
}
