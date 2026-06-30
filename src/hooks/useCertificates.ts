/// Reactive subscription to the user's certificate list. Mirrors the
/// `useAchievements` shape so the Certificates page can re-render on
/// mint events without re-reading the storage layer on every render.
///
/// The list is refreshed on mount + whenever a `libre:certificates-
/// changed` window event fires. The mint helper in `data/certificates`
/// is the only writer; this hook is purely a read-side reactor.

import { useCallback, useEffect, useState } from "react";
import { listCertificates, type Certificate } from "@/data/certificates";

export const CERTIFICATES_CHANGED_EVENT = "libre:certificates-changed";

/// Fire when a writer mutates the certificate list so every
/// subscriber re-reads. Wrappers around `mintCertificate` /
/// `clearCertificates` should dispatch this after their write
/// settles.
export function notifyCertificatesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CERTIFICATES_CHANGED_EVENT));
}

export function useCertificates(): {
  certificates: Certificate[];
  loaded: boolean;
  refresh: () => Promise<void>;
} {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listCertificates();
    setCertificates(list);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => {
      void refresh();
    };
    window.addEventListener(CERTIFICATES_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(CERTIFICATES_CHANGED_EVENT, onChange);
    };
  }, [refresh]);

  return { certificates, loaded, refresh };
}
