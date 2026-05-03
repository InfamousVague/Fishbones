// Tip-jar trigger + floating deck panel for the Fishbones desktop /
// web app. Mirrors the CryptoTipDock that lives on
// fishbones.academy/support: trigger pill in the TopBar opens a
// chrome-less floating panel anchored top-right of the trigger,
// containing a stacked deck of glass-morphism crypto cards. Wheel
// ticks, swipe gestures, arrow keys, and clicking a peeking sliver
// all rotate the deck around an `activeIdx` with wrap-around. Click
// anywhere outside (or press Escape) closes the panel.
//
// Sister implementation: see Web/fishbones-academy/src/components/
// CryptoSupport.tsx — keep the visual / behavioural contract aligned
// when changing one. Addresses are placeholders (REPLACE_WITH_*) for
// Matt to swap before any real release.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import QRCode from "qrcode";
import { Icon } from "@base/primitives/icon";
import { heart } from "@base/primitives/icon/icons/heart";
import { copy as copyIcon } from "@base/primitives/icon/icons/copy";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import "@base/primitives/icon/icon.css";
import "./TipDropdown.css";

// ─────────────────────────── Types ───────────────────────────

export interface TipMethod {
  id: string;
  ticker: string;
  name: string;
  network: string;
  address: string;
  background: string;
  foreground?: string;
  /** rgba(...) at ~0.20 alpha — drives the per-card radial wash. */
  tint?: string;
  /** Inline SVG glyph rendered on the brand badge — uses currentColor. */
  icon: ReactNode;
}

// ─────────────────────────── Icons ───────────────────────────

function BtcGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false">
      <g fill="currentColor">
        <rect x="11" y="4" width="2.2" height="24" rx="0.4" />
        <rect x="17" y="4" width="2.2" height="24" rx="0.4" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 8h9.5a4 4 0 0 1 0 8H9" />
        <path d="M9 16h10.5a4 4 0 0 1 0 8H9" />
      </g>
    </svg>
  );
}

function EthGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false" fill="currentColor">
      <path d="M16 2 L7 17 L16 22 Z" opacity="0.65" />
      <path d="M16 2 L25 17 L16 22 Z" opacity="0.95" />
      <path d="M7 19 L16 30 L16 24 Z" opacity="0.65" />
      <path d="M16 24 L16 30 L25 19 Z" opacity="0.95" />
    </svg>
  );
}

function SolGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false" fill="currentColor">
      <path d="M9 8h17l-3 4H6Z" />
      <path d="M6 14h17l3 4H9Z" />
      <path d="M9 20h17l-3 4H6Z" />
    </svg>
  );
}

function UsdcGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false">
      <circle cx="16" cy="16" r="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 7.5v2.4M16 22.1v2.4" />
        <path d="M19.6 12.4c0-1.6-1.6-2.6-3.6-2.6s-3.6 1-3.6 2.6 1.6 2.1 3.6 2.6 3.6 1 3.6 2.6-1.6 2.6-3.6 2.6-3.6-1-3.6-2.6" />
      </g>
    </svg>
  );
}

function XrpGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false" fill="currentColor">
      <path d="M6 8h20M6 16h20M6 24h20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────── Defaults ───────────────────────────
// Greppable placeholder addresses — keep aligned with academy's
// DEFAULT_METHODS so swapping in real wallets is a single search.

export const DEFAULT_TIP_METHODS: TipMethod[] = [
  {
    id: "btc",
    ticker: "BTC",
    name: "Bitcoin",
    network: "Bitcoin mainnet",
    address: "bc1q5uyjh67lm3h7640y52hfyl40hjlhw5mkenjzr6",
    background: "#F7931A",
    foreground: "#FFFFFF",
    tint: "rgba(247, 147, 26, 0.20)",
    icon: <BtcGlyph />,
  },
  {
    id: "eth",
    ticker: "ETH",
    name: "Ethereum",
    network: "Ethereum mainnet",
    address: "0x9F47965d90b4a90311D326E55b1e054057897323",
    background: "#627EEA",
    foreground: "#FFFFFF",
    tint: "rgba(98, 126, 234, 0.22)",
    icon: <EthGlyph />,
  },
  {
    id: "sol",
    ticker: "SOL",
    name: "Solana",
    network: "Solana mainnet",
    address: "5NhMVzsMyDZwSpgeoxCg5kv5zX22gjQrdcbTsp6d1yHj",
    background: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
    foreground: "#FFFFFF",
    tint: "rgba(153, 69, 255, 0.22)",
    icon: <SolGlyph />,
  },
  {
    id: "xrp",
    ticker: "XRP",
    name: "Ripple",
    network: "Ripple mainnet",
    address: "r3JRYgzRcQmXwZjjE2E84HC4oJNCmASHEv",
    background: "linear-gradient(135deg, #2f2c56 0%, #3631cc 100%)",
    foreground: "#FFFFFF",
    tint: "rgba(54, 49, 204, 0.22)",
    icon: <XrpGlyph />,
  },
  {
    id: "usdc",
    ticker: "USDC",
    name: "USD Coin",
    network: "USDC on Ethereum",
    address: "0x9F47965d90b4a90311D326E55b1e054057897323",
    background: "#2775CA",
    foreground: "#FFFFFF",
    tint: "rgba(39, 117, 202, 0.22)",
    icon: <UsdcGlyph />,
  },
];

// ─────────────────────────── QR ───────────────────────────
// `qrcode.create` is synchronous and returns the bitmap modules; we
// render them as React-owned <rect> children rather than going
// through dangerouslySetInnerHTML on the SVG string. That keeps the
// markup themable and avoids a second async render path.

function QrCode({ value, size = 116 }: { value: string; size?: number }) {
  const { count, dark } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const data = qr.modules.data;
    const cells: { x: number; y: number }[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (data[r * n + c]) cells.push({ x: c, y: r });
      }
    }
    return { count: n, dark: cells };
  }, [value]);

  const margin = 2;
  const total = count + margin * 2;

  return (
    <svg
      className="fishbones__tip-card-qr-svg"
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      role="img"
      aria-label={`QR code for ${value}`}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#FFFFFF" />
      <g fill="#0B0B10" transform={`translate(${margin} ${margin})`}>
        {dark.map((p) => (
          <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1} height={1} />
        ))}
      </g>
    </svg>
  );
}

// ─────────────────────────── Card ───────────────────────────

interface TipCardProps {
  method: TipMethod;
  /** Position relative to the active card (0 = front, n-1 = back). */
  depth: number;
  isActive: boolean;
  /** Bring this card to the front when its sliver is clicked. */
  onSelect: () => void;
}

function TipCard({ method, depth, isActive, onSelect }: TipCardProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(method.address);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = method.address;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  const inactive = !isActive;
  const cardStyle = {
    "--brand-tint": method.tint ?? "rgba(155, 166, 237, 0.18)",
  } as CSSProperties;

  return (
    <article
      className="fishbones__tip-card"
      data-id={method.id}
      data-depth={depth}
      data-active={isActive ? "" : undefined}
      style={cardStyle}
      onClick={inactive ? onSelect : undefined}
      role={inactive ? "button" : undefined}
      tabIndex={inactive ? 0 : undefined}
      aria-label={inactive ? `Bring ${method.name} to the front` : undefined}
      onKeyDown={
        inactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
    >
      <div className="fishbones__tip-card-main">
        <header className="fishbones__tip-card-head">
          <div
            className="fishbones__tip-card-badge"
            style={{
              background: method.background,
              color: method.foreground ?? "#FFFFFF",
            }}
            aria-hidden
          >
            {method.icon}
          </div>
          <h3 className="fishbones__tip-card-title">
            {method.name}
            <span className="fishbones__tip-card-title-dot">.</span>
          </h3>
        </header>

        <div className="fishbones__tip-card-bottom">
          <div className="fishbones__tip-card-meta">
            <span className="fishbones__tip-card-meta-label">{method.ticker}</span>
            <span className="fishbones__tip-card-meta-sep" aria-hidden>·</span>
            <span className="fishbones__tip-card-meta-value">{method.network}</span>
          </div>
          <span
            className="fishbones__tip-card-addr"
            aria-label={`${method.name} address on ${method.network}`}
          >
            {method.address}
          </span>
        </div>
      </div>

      <div className="fishbones__tip-card-strip">
        <div className="fishbones__tip-card-qr">
          <QrCode value={method.address} />
        </div>
        <button
          type="button"
          className="fishbones__tip-card-copy"
          onClick={(e) => {
            // The article has its own click handler for inactive cards
            // (bring-to-front). When the active card's Copy button is
            // clicked, we still want the copy to fire and not bubble
            // up to a parent that might intercept it.
            e.stopPropagation();
            void copy();
          }}
          data-copied={copied || undefined}
          aria-label={`Copy ${method.name} address`}
          tabIndex={inactive ? -1 : undefined}
        >
          <Icon icon={copied ? checkIcon : copyIcon} size="xs" color="currentColor" />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </article>
  );
}

// ─────────────────────────── Public ───────────────────────────

export interface TipDropdownProps {
  methods?: TipMethod[];
}

/// Tip jar trigger + deck panel. Trigger is a small "Tip" pill that
/// matches the surrounding TopBar action chips; the panel pops below
/// the trigger with the looping card deck.
export default function TipDropdown({
  methods = DEFAULT_TIP_METHODS,
}: TipDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wheelAccum = useRef(0);
  const touchY = useRef<number | null>(null);

  const advance = (dir: 1 | -1) => {
    setActiveIdx((i) => (i + dir + methods.length) % methods.length);
  };

  // Outside-click + Escape + arrow-key navigation. With the close X
  // removed (per request), outside-click is the *only* dismiss path,
  // so we listen on `mousedown` to catch the click before any focus
  // change inside the panel can shift target into the wrapRef.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        advance(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        advance(-1);
      }
    }
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      // Click anywhere outside the dropdown wrapper closes the panel.
      // The trigger button itself is inside wrapRef so toggling it
      // still works (its own onClick handles the open/close flip).
      if (wrapRef.current?.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- methods.length is stable post-mount

  useEffect(() => {
    if (!open) return;
    const stack = stackRef.current;
    if (!stack) return;
    const STEP = 80;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      wheelAccum.current += e.deltaY;
      if (wheelAccum.current > STEP) {
        advance(1);
        wheelAccum.current = 0;
      } else if (wheelAccum.current < -STEP) {
        advance(-1);
        wheelAccum.current = 0;
      }
    }
    function onTouchStart(e: TouchEvent) {
      touchY.current = e.touches[0]?.clientY ?? null;
    }
    function onTouchMove(e: TouchEvent) {
      if (touchY.current === null) return;
      const y = e.touches[0]?.clientY;
      if (y === undefined) return;
      const dy = touchY.current - y;
      if (Math.abs(dy) > 50) {
        advance(dy > 0 ? 1 : -1);
        touchY.current = y;
      }
      e.preventDefault();
    }
    function onTouchEnd() {
      touchY.current = null;
    }

    stack.addEventListener("wheel", onWheel, { passive: false });
    stack.addEventListener("touchstart", onTouchStart, { passive: true });
    stack.addEventListener("touchmove", onTouchMove, { passive: false });
    stack.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      stack.removeEventListener("wheel", onWheel);
      stack.removeEventListener("touchstart", onTouchStart);
      stack.removeEventListener("touchmove", onTouchMove);
      stack.removeEventListener("touchend", onTouchEnd);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fishbones__tip-wrap"
      ref={wrapRef}
      data-tauri-drag-region={false}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`fishbones__tip-trigger ${
          open ? "fishbones__tip-trigger--open" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Support fishbones"
      >
        {/* The Icon component only accepts the semantic IconColor enum,
            so we paint the heart red by setting `color` on a wrapping
            span — the icon's `currentColor` fill picks it up without
            affecting the adjacent label. */}
        <span
          className="fishbones__tip-trigger-heart"
          style={{ color: "#ef4444", display: "inline-flex" }}
          aria-hidden
        >
          <Icon icon={heart} size="xs" color="currentColor" />
        </span>
        <span className="fishbones__tip-trigger-label">Support</span>
      </button>

      {open && (
        <div
          className="fishbones__tip-panel"
          role="dialog"
          aria-label="Send a tip"
        >
          <div
            ref={stackRef}
            className="fishbones__tip-stack"
            style={{ "--deck-size": methods.length } as CSSProperties}
            aria-roledescription="card stack"
          >
            {methods.map((m, i) => {
              const depth = (i - activeIdx + methods.length) % methods.length;
              return (
                <TipCard
                  key={m.id}
                  method={m}
                  depth={depth}
                  isActive={depth === 0}
                  onSelect={() => setActiveIdx(i)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
