/// React hook around the catalog fetcher. Returns the list of
/// courses available to install (both core + remote), refreshing
/// when the consumer asks. Failure-tolerant — empty array on
/// network error so the Library still renders installed courses.

import { useEffect, useState } from "react";
import { fetchCatalog, type CatalogEntry } from "../lib/catalog";

export function useCatalog(): {
  catalog: CatalogEntry[];
  loaded: boolean;
  refresh: () => Promise<void>;
} {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

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
