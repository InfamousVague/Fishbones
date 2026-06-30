/// React hook around the catalog fetcher. Returns the list of
/// courses available to install (both core + remote), refreshing
/// when the consumer asks. Failure-tolerant — empty array on
/// network error so the Library still renders installed courses.
///
/// SWR-style: initial state is seeded synchronously from the
/// persisted localStorage cache (`readPersistedCatalog`), so the
/// Discover / Library grids paint a stale-but-correct catalog on
/// the very first render. The effect below then fires the live
/// fetch and swaps in the fresh result if anything changed. Cold
/// launches that previously took several hundred ms to network-
/// round-trip the manifest now paint immediately, with the live
/// data quietly catching up in the background.

import { useEffect, useState } from "react";
import {
  fetchCatalog,
  readPersistedCatalog,
  type CatalogEntry,
} from "@/lib/catalog";

export function useCatalog(): {
  catalog: CatalogEntry[];
  loaded: boolean;
  refresh: () => Promise<void>;
} {
  // Seed from localStorage once on first render. `readPersistedCatalog`
  // returns null if the cache is missing / stale / malformed; we fall
  // back to an empty list and the effect below populates from the
  // live fetch.
  const initial = readPersistedCatalog();
  const [catalog, setCatalog] = useState<CatalogEntry[]>(initial ?? []);
  /// Treat the cache as "loaded enough" for the first paint — the
  /// Library's render path branches on this to swap from a skeleton
  /// to the actual grid. The background refetch still fires; a
  /// changed catalog updates state silently. If we forced
  /// `loaded: false` until the network round-trip settled, we'd
  /// throw away the synchronous-paint advantage that having the
  /// cache buys us in the first place.
  const [loaded, setLoaded] = useState(initial !== null);

  useEffect(() => {
    let cancelled = false;
    void fetchCatalog().then((entries) => {
      if (cancelled) return;
      setCatalog(entries);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = async () => {
    const entries = await fetchCatalog({ refresh: true });
    setCatalog(entries);
    setLoaded(true);
  };

  return { catalog, loaded, refresh };
}
