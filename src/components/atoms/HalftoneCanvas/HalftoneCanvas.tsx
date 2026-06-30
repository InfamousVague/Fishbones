import { useEffect, useRef } from "react";

// Parse a #rgb / #rrggbb hex into an rgba() string with the given alpha. Any
// non-hex value is returned unchanged (it's already a CSS colour the canvas
// gradient accepts).
function withAlpha(hex: string, a: number): string {
  let h = hex.trim();
  if (h[0] !== "#") return h;
  h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Size-graded halftone, drawn on a <canvas> instead of CSS masks. Each dot's
// radius is computed directly from its distance to the top-left corner — LARGE
// at the corner, shrinking to small, then nothing past the falloff radius. This
// is engine-independent (WKWebView renders CSS `mask-composite` on pseudo-
// elements inconsistently, which flattened the previous mask-based gradient).
// Hue-aware: redraws when --gg-hue changes (Settings slider / language tint).

function draw(
  canvas: HTMLCanvasElement,
  maxR: number,
  minR: number,
  spacing: number,
) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const root = getComputedStyle(document.documentElement);
  const maxDist = Math.hypot(w, h) * 0.72; // falloff radius (no dots beyond)

  const grad = ctx.createLinearGradient(0, 0, w * 0.9, h * 0.9);
  // Image themes define explicit halftone stops (--gg-ht-c1/c2/c3, sampled from
  // their cover art) so the splash matches that theme's signature light. Apply
  // the same bright->mid->deep alpha falloff the hue gradient used. default-dark
  // leaves these unset and falls back to its hue-driven white->accent sweep.
  const c1 = root.getPropertyValue("--gg-ht-c1").trim();
  const c2 = root.getPropertyValue("--gg-ht-c2").trim();
  const c3 = root.getPropertyValue("--gg-ht-c3").trim();
  if (c1 && c2 && c3) {
    grad.addColorStop(0, withAlpha(c1, 0.95));
    grad.addColorStop(0.45, withAlpha(c2, 0.72));
    grad.addColorStop(1, withAlpha(c3, 0.5));
  } else {
    const hue = Number(root.getPropertyValue("--gg-hue").trim()) || 18;
    grad.addColorStop(0, `hsla(${hue}, 100%, 96%, 0.95)`);
    grad.addColorStop(0.45, `hsla(${hue}, 84%, 74%, 0.7)`);
    grad.addColorStop(1, `hsla(${(hue + 338) % 360}, 62%, 56%, 0.45)`);
  }
  ctx.fillStyle = grad;

  for (let y = spacing / 2; y < h; y += spacing) {
    for (let x = spacing / 2; x < w; x += spacing) {
      const d = Math.hypot(x, y);
      if (d >= maxDist) continue;
      const t = d / maxDist; // 0 at corner -> 1 at the edge
      const r = maxR - (maxR - minR) * t; // big at corner, small at edge
      ctx.globalAlpha = 1 - t * 0.25; // gentle thin-out toward the edge
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export default function HalftoneCanvas({
  className,
  maxR = 1.8,
  minR = 0.22,
  spacing = 13,
}: {
  className?: string;
  maxR?: number;
  minR?: number;
  spacing?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let timer = 0;
    let tries = 0;
    // Draw SYNCHRONOUSLY (not via requestAnimationFrame, which a backgrounded /
    // occluded webview can throttle to a halt). If the canvas isn't laid out
    // yet (clientWidth 0), retry on a short timer until it is.
    const render = () => {
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
        if (tries++ < 30) timer = window.setTimeout(render, 16);
        return;
      }
      tries = 0;
      draw(canvas, maxR, minR, spacing);
    };
    render();
    const ro = new ResizeObserver(() => {
      tries = 0;
      render();
    });
    ro.observe(canvas);
    // --gg-hue is set inline on <html> by the Settings slider + the per-language
    // tint; redraw when it (or the theme) changes.
    const mo = new MutationObserver(() => {
      tries = 0;
      render();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme-name"],
    });
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}
