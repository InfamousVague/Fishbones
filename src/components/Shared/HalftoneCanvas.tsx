import { useEffect, useRef } from "react";

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

  const hue =
    Number(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--gg-hue")
        .trim(),
    ) || 18;

  const maxDist = Math.hypot(w, h) * 0.72; // falloff radius (no dots beyond)

  // White -> accent sweep, matching the old --gg-halftone gradient.
  const grad = ctx.createLinearGradient(0, 0, w * 0.9, h * 0.9);
  grad.addColorStop(0, `hsla(${hue}, 100%, 96%, 0.95)`);
  grad.addColorStop(0.45, `hsla(${hue}, 84%, 74%, 0.7)`);
  grad.addColorStop(1, `hsla(${(hue + 338) % 360}, 62%, 56%, 0.45)`);
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
