/// Floating "+N XP" reward popup.
///
/// Fires on every fresh lesson completion so the XP gain is VISIBLE
/// at the moment of action. Previously the +XP only ticked silently
/// in the top-bar StatsChip — which the learner usually isn't looking
/// at when they finish a lesson — so the reward loop felt flat despite
/// the XP system being fully wired underneath.
///
/// Decoupled by design: completion code calls `fireXpBurst(xp)`, which
/// dispatches a `libre:xp-burst` window event; this component listens
/// and portals the animation to <body> so it floats above all chrome
/// no matter where it's mounted. Honors prefers-reduced-motion (fades
/// without the rise). Pointer-events none — purely decorative.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/i18n";
import "./XpBurst.css";

export interface XpBurstDetail {
  xp: number;
}

const XP_BURST_EVENT = "libre:xp-burst";

/// Dispatch a floating "+N XP" burst. No-op for non-positive XP or in
/// non-DOM environments. Call from any completion path.
export function fireXpBurst(xp: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(xp) || xp <= 0) return;
  window.dispatchEvent(
    new CustomEvent<XpBurstDetail>(XP_BURST_EVENT, { detail: { xp } }),
  );
}

interface Burst {
  id: number;
  xp: number;
}

let nextId = 1;

export default function XpBurst() {
  const t = useT();
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    function onBurst(e: Event) {
      const detail = (e as CustomEvent<XpBurstDetail>).detail;
      if (!detail || !Number.isFinite(detail.xp) || detail.xp <= 0) return;
      const id = nextId++;
      setBursts((prev) => [...prev, { id, xp: detail.xp }]);
      // Auto-remove after the rise animation finishes (1.3s).
      window.setTimeout(() => {
        setBursts((prev) => prev.filter((b) => b.id !== id));
      }, 1300);
    }
    window.addEventListener(XP_BURST_EVENT, onBurst);
    return () => window.removeEventListener(XP_BURST_EVENT, onBurst);
  }, []);

  if (bursts.length === 0) return null;
  return createPortal(
    <div className="libre-xp-burst-layer" aria-hidden>
      {bursts.map((b) => (
        <div key={b.id} className="libre-xp-burst">
          {t("lesson.xpBurst", { xp: b.xp })}
        </div>
      ))}
    </div>,
    document.body,
  );
}
