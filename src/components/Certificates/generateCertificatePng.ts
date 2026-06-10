/// Render a certificate to a downloadable PNG via the HTML Canvas
/// API. Pure 2D drawing — no DOM-screenshotting libraries — so the
/// output is deterministic, font-rendering matches whatever the
/// OS-default serif resolves to, and the bundle stays small.
///
/// Layout is a 1600 × 640 landscape ticket (5:2 ratio, roughly
/// 8" × 3.2" at 200 DPI — boarding-pass proportions, comfortable
/// to print on Letter or A4 and to share at thumbnail size in
/// chat threads).
///
/// Two regions split by a perforation line ~71% of the way across:
///
///   ┌───────────────────────────────┬──────────┐
///   │                               │          │
///   │   Cert face (recipient,       │   QR     │
///   │   course, date range,         │  ▰▰▰     │
///   │   stats)                      │  Scan to │
///   │                               │   verify │
///   └───────────────────────────────┴──────────┘
///        main body (~1140 px wide)     stub (~460 px wide)
///
/// Two semicircular notches punch INTO the ticket on the
/// perforation line (top + bottom edges), and a dashed vertical
/// line runs between them — same admission-ticket idiom every
/// concert / movie / boarding pass uses.
///
/// Holographic foil is baked in: a diagonal rainbow gradient masked
/// by a tiled sparkle pattern, composited onto the parchment via
/// multiply blend. The shimmer is static (it's a PNG; there's no
/// motion budget), tuned to ~30% opacity so the rainbow specks
/// read as iridescent-sticker accent rather than competing with the
/// cert text.
///
/// QR code (rendered via the `qrcode` lib) sits on the stub and
/// points at a libre.academy/verify URL with the cert payload
/// base64-encoded into the query string.

// `qrcode` is imported dynamically at its call site below so it
// code-splits out of this module's first-load chunk.
import type { Certificate } from "../../data/certificates";
import { buildVerifyUrl } from "../../data/certificates";

// ─── Geometry ───────────────────────────────────────────────────

const W = 1600;
const H = 640;
const CORNER_R = 20;
const NOTCH_R = 18;
const STUB_W = 460;
const BODY_W = W - STUB_W;
/// The perforation line falls at the boundary between the main
/// body and the tear-off stub on the right.
const PERF_X = BODY_W;

// ─── Palette ────────────────────────────────────────────────────

/// Modern monochrome diploma palette. Replaces the earlier warm
/// parchment + amber treatment (PARCHMENT `#fbfaf6` /
/// PARCHMENT_EDGE `#f3eede` / INK `#1a1418` / ACCENT `#a85e1c` /
/// ACCENT_SOFT `#d4b06b`) so the downloadable PNG matches the
/// on-screen ticket's clean white-on-white look. Names are kept
/// for diff-clarity; the values are all neutral now.
const PARCHMENT = "#ffffff";
const PARCHMENT_EDGE = "#f5f5f5";
const INK = "#111111";
/// Mid-grey for secondary text (dates, taglines, captions). Used
/// where a CSS rule would say `rgba(0, 0, 0, 0.55)` — canvas needs
/// an opaque colour, so we pre-mix.
const INK_SOFT = "#737373";
/// Soft grey for the cert-id and other quiet supporting metadata.
/// In the previous warm palette this was `#d4b06b` (amber-soft);
/// the modern theme uses neutral grey + INK for all foreground
/// tones, so the "accent" tier has been collapsed into INK.
const ACCENT_SOFT = "#9e9e9e";

// ─── Public API ─────────────────────────────────────────────────

/// Return a PNG blob ready to hand to a download helper. The canvas
/// is allocated per-call so concurrent renders can't trample each
/// other's pixel buffers.
export async function generateCertificatePng(cert: Certificate): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  // Clip to the ticket outline so the parchment fill + foil + shine
  // all live inside the rounded-rect-with-notches silhouette and
  // the corners are transparent.
  const path = buildTicketPath();
  ctx.save();
  ctx.clip(path);

  paintParchment(ctx);
  paintHologram(ctx);
  paintShine(ctx);

  ctx.restore();

  // Border + perforation are drawn AFTER restore so they stroke on
  // top of the fill (and the perforation isn't clipped away by the
  // fill region). The border traces the same ticket path so it
  // wraps the notches.
  paintBorder(ctx, path);
  paintPerforation(ctx);

  // Content sits on top of everything. Both body + stub render
  // images (brand logo + QR) so both are async.
  await paintBodyContent(ctx, cert);
  await paintStub(ctx, cert);

  return await canvasToBlob(canvas);
}

/// Convenience helper: generate + trigger a browser download with a
/// filename derived from the course title. Resolves once the
/// download has been dispatched (the actual save-to-disk happens
/// out of band in the browser / shell).
export async function downloadCertificatePng(cert: Certificate): Promise<void> {
  const blob = await generateCertificatePng(cert);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `libre-certificate-${slugify(cert.courseTitle)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer the revoke so the download dialog has time to grab the
  // URL — instant revoke causes "failed - no file" on slow shells.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ─── Shape ──────────────────────────────────────────────────────

/// Build the ticket outline as a Path2D — rounded rectangle with
/// two semicircular notches cut INTO the body on the perforation
/// line (top + bottom edges). The notches sit at x = PERF_X and
/// curve toward the interior of the ticket; the dashed perforation
/// line runs between them.
///
/// Path traversal is clockwise starting from the top-left corner.
/// SVG arc sweep-flag 1 is "clockwise in screen coordinates" — for
/// a semicircle on the top edge that means curving DOWN into the
/// body, which is the visual we want for both notches.
function buildTicketPath(): Path2D {
  // SVG sweep-flag cheat sheet (Y-down screen): for an arc from A
  // to B, flag 1 = "positive angle direction" = the arc that's
  // visually clockwise looking at the screen; flag 0 = the one
  // that's visually counterclockwise. For a left-to-right chord
  // along the TOP edge, sweep 0 puts the curve BELOW the chord
  // (into the ticket). For a right-to-left chord along the BOTTOM
  // edge, sweep 0 puts the curve ABOVE the chord (also into the
  // ticket). Both notches use sweep 0 so they're true cutouts.
  // Rounded corners go in with sweep 1 because the corner radius
  // is curving in the opposite rotational sense (outward → inward
  // as the path closes).
  const d = [
    `M${CORNER_R},0`,
    `H${PERF_X - NOTCH_R}`,
    `A${NOTCH_R},${NOTCH_R} 0 0 0 ${PERF_X + NOTCH_R},0`,
    `H${W - CORNER_R}`,
    `A${CORNER_R},${CORNER_R} 0 0 1 ${W},${CORNER_R}`,
    `V${H - CORNER_R}`,
    `A${CORNER_R},${CORNER_R} 0 0 1 ${W - CORNER_R},${H}`,
    `H${PERF_X + NOTCH_R}`,
    `A${NOTCH_R},${NOTCH_R} 0 0 0 ${PERF_X - NOTCH_R},${H}`,
    `H${CORNER_R}`,
    `A${CORNER_R},${CORNER_R} 0 0 1 0,${H - CORNER_R}`,
    `V${CORNER_R}`,
    `A${CORNER_R},${CORNER_R} 0 0 1 ${CORNER_R},0`,
    "Z",
  ].join(" ");
  return new Path2D(d);
}

// ─── Fill passes ────────────────────────────────────────────────

function paintParchment(ctx: CanvasRenderingContext2D): void {
  // Solid parchment base + faint radial wash so edges don't read
  // flat. The wash is centered slightly above the body so the
  // gradient feels like light coming from up-and-behind, not from
  // dead-center.
  ctx.fillStyle = PARCHMENT;
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createRadialGradient(
    BODY_W * 0.4,
    H * 0.35,
    0,
    BODY_W * 0.4,
    H * 0.35,
    W * 0.5,
  );
  wash.addColorStop(0, "rgba(255, 255, 255, 0.18)");
  wash.addColorStop(1, PARCHMENT_EDGE);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
}

function paintHologram(ctx: CanvasRenderingContext2D): void {
  // Build the foil on an offscreen canvas so we can mask it before
  // compositing onto the main canvas:
  //   1. Paint the diagonal rainbow gradient
  //   2. Punch a sparkle stencil into it via `destination-in` —
  //      only sparkle-shaped pixels survive
  //   3. drawImage the result onto the main canvas with `multiply`
  //      blend at ~30% alpha — the rainbow darkens the parchment
  //      wherever the sparkle carved through, producing
  //      iridescent-sticker scatter
  const foil = document.createElement("canvas");
  foil.width = W;
  foil.height = H;
  const fctx = foil.getContext("2d");
  if (!fctx) return;

  // Step 1: rainbow band running -45° across the ticket.
  const grad = fctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0.0, "hsl(0, 95%, 60%)");
  grad.addColorStop(0.125, "hsl(30, 95%, 60%)");
  grad.addColorStop(0.25, "hsl(60, 95%, 60%)");
  grad.addColorStop(0.375, "hsl(120, 90%, 55%)");
  grad.addColorStop(0.5, "hsl(180, 90%, 55%)");
  grad.addColorStop(0.625, "hsl(222, 95%, 60%)");
  grad.addColorStop(0.75, "hsl(258, 95%, 60%)");
  grad.addColorStop(0.875, "hsl(300, 95%, 60%)");
  grad.addColorStop(1.0, "hsl(0, 95%, 60%)");
  fctx.fillStyle = grad;
  fctx.fillRect(0, 0, W, H);

  // Step 2: punch a tiled four-pointed sparkle mask into the
  // rainbow. `destination-in` keeps only pixels where both source
  // (the sparkle path being drawn) and destination (the rainbow)
  // overlap. Spacing + size + composite alpha are tuned to leave
  // the rainbow as scattered foil-flake accents, not as a
  // pronounced overlay — earlier numbers (spacing 30, size 11,
  // α 0.35) read as glittery to the point of distraction.
  fctx.globalCompositeOperation = "destination-in";
  fctx.fillStyle = "#000";
  const spacing = 56;
  const sparkleSize = 7;
  for (let y = spacing / 2; y < H; y += spacing) {
    for (let x = spacing / 2; x < W; x += spacing) {
      // Stagger every other row so the pattern doesn't read as a
      // rigid grid.
      const ox = (Math.floor(y / spacing) % 2) * (spacing / 2);
      drawSparkle(fctx, x + ox, y, sparkleSize);
    }
  }
  fctx.globalCompositeOperation = "source-over";

  // Step 3: composite onto the main canvas. Alpha is intentionally
  // low so the foil reads as iridescent dust on the parchment,
  // not as a stained-glass overlay competing with the text.
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.22;
  ctx.drawImage(foil, 0, 0);
  ctx.restore();
}

function drawSparkle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  // Four-pointed star with concave sides — same silhouette the
  // base library's `sparkles` icon uses. The narrow waist between
  // points gives a foil-flake look instead of a plain plus sign.
  const half = size / 2;
  const waist = size * 0.18;
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  ctx.quadraticCurveTo(cx + waist, cy - waist, cx + half, cy);
  ctx.quadraticCurveTo(cx + waist, cy + waist, cx, cy + half);
  ctx.quadraticCurveTo(cx - waist, cy + waist, cx - half, cy);
  ctx.quadraticCurveTo(cx - waist, cy - waist, cx, cy - half);
  ctx.closePath();
  ctx.fill();
}

function paintShine(ctx: CanvasRenderingContext2D): void {
  // Single diagonal highlight band sweeping top-right to bottom-
  // left. Neutral graphite tint at low opacity so the shine reads
  // as "light catching the foil" — replaces the old warm-gold band
  // (`rgba(212, 176, 107, 0.35)`) which clashed with the new
  // white-paper base.
  const grad = ctx.createLinearGradient(W * 0.7, 0, W * 0.1, H);
  grad.addColorStop(0.42, "rgba(255, 255, 255, 0)");
  grad.addColorStop(0.5, "rgba(0, 0, 0, 0.14)");
  grad.addColorStop(0.58, "rgba(255, 255, 255, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ─── Strokes ────────────────────────────────────────────────────

function paintBorder(ctx: CanvasRenderingContext2D, path: Path2D): void {
  // Hairline graphite stroke traces the ticket outline including
  // the notches. Replaced the old amber 5px slab — a thin neutral
  // edge matches the on-screen cert's "clean white paper" look
  // rather than overpainting it as a framed Victorian artefact.
  ctx.save();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
  ctx.lineWidth = 1.5;
  ctx.stroke(path);
  ctx.restore();
}

function paintPerforation(ctx: CanvasRenderingContext2D): void {
  // Dashed vertical line from just below the top notch to just
  // above the bottom notch. Neutral black-alpha (was warm
  // `rgba(26, 20, 24, 0.55)`) so the tear-line reads in the
  // modern monochrome system.
  ctx.save();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(PERF_X, NOTCH_R + 4);
  ctx.lineTo(PERF_X, H - NOTCH_R - 4);
  ctx.stroke();
  ctx.restore();
}

// ─── Body content ──────────────────────────────────────────────

async function paintBodyContent(
  ctx: CanvasRenderingContext2D,
  cert: Certificate,
): Promise<void> {
  const inset = 55;
  const left = inset;
  const right = BODY_W - inset;
  const centerX = (left + right) / 2;

  // Brand row — libre.academy logo lockup. Replaces the previous
  // ✦ + "LIBRE.ACADEMY" text pair so the PNG carries the same
  // wordmark image the on-screen ticket and the marketing site
  // use. Image is loaded from the public bundle path and drawn
  // at 40px tall (the in-app CSS uses 22px tall; the PNG is 2x
  // pixel-density so we double the size to stay crisp). Width
  // is derived from the image's natural aspect ratio so the
  // logo never crushes or stretches.
  try {
    const logo = await loadImage(
      `${import.meta.env.BASE_URL}libreacademy.png`,
    );
    const logoH = 40;
    const logoW = (logo.naturalWidth / logo.naturalHeight) * logoH;
    ctx.drawImage(logo, left, 60 - logoH + 6, logoW, logoH);
  } catch {
    // If the image fails to load (file missing / offline), fall
    // back to the old text wordmark so the cert still reads
    // correctly rather than missing its brand identity.
    ctx.fillStyle = INK;
    ctx.font = `600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText("LIBRE.ACADEMY", left, 60);
  }

  // Date range / cert ID row, top-right of the body.
  const issued = formatDate(cert.issuedAt);
  const startedShort = cert.startedAt ? formatDate(cert.startedAt) : null;
  const span = startedShort ? `${startedShort} → ${issued}` : issued;
  ctx.fillStyle = INK_SOFT;
  ctx.font = `500 14px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = "right";
  ctx.fillText(span, right, 60);

  // ─── Modernized typographic pass ──────────────────────────────
  //
  // The cert used to wear a full Georgia / Times serif stack with
  // an italic recipient signature + amber accents — Victorian
  // graduation-certificate vocabulary. The new system uses the
  // app's default sans throughout, wider letter-tracked uppercase
  // eyebrows, and pure-black hero text with negative tracking so
  // the cert reads as a clean modern diploma fitted to the rest
  // of the app's monochrome theme.
  const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  // Eyebrow — "CERTIFICATE" in tight-tracked uppercase sans. The
  // copy intentionally shrinks from "CERTIFICATE OF COMPLETION"
  // (a phrase from the previous, more ornamental voice) so the
  // eyebrow sits as a quiet label rather than restating the
  // entire thing twice in different sizes.
  ctx.fillStyle = INK_SOFT;
  ctx.font = `600 14px ${SANS}`;
  ctx.textAlign = "center";
  ctx.letterSpacing = "0.32em" as unknown as string; // best-effort, falls back gracefully
  ctx.fillText("CERTIFICATE", centerX, 130);

  // Recipient name — visual hero. Bold sans (was italic Georgia),
  // negative letter-spacing for a modern display feel, fit-to-
  // width with ellipsis fallback so a long name doesn't bleed
  // into the stub.
  ctx.fillStyle = INK;
  ctx.font = `700 64px ${SANS}`;
  ctx.textAlign = "center";
  ctx.letterSpacing = "-0.02em" as unknown as string;
  ctx.fillText(fitToWidth(ctx, cert.recipientName, right - left), centerX, 230);
  ctx.letterSpacing = "0em" as unknown as string;

  // Decorative rule under the name — neutral hairline replaces
  // the old amber 1.5px stroke.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX - 180, 268);
  ctx.lineTo(centerX + 180, 268);
  ctx.stroke();

  // "Completed" lede + course title. The phrase tightens from
  // "for the successful completion of" (formal Victorian) to a
  // single tracked-uppercase verb that matches the eyebrow
  // rhythm above.
  ctx.fillStyle = INK_SOFT;
  ctx.font = `600 14px ${SANS}`;
  ctx.textAlign = "center";
  ctx.letterSpacing = "0.32em" as unknown as string;
  ctx.fillText("COMPLETED", centerX, 305);
  ctx.letterSpacing = "0em" as unknown as string;

  ctx.fillStyle = INK;
  ctx.font = `600 34px ${SANS}`;
  ctx.letterSpacing = "-0.015em" as unknown as string;
  ctx.fillText(fitToWidth(ctx, cert.courseTitle, right - left), centerX, 360);
  ctx.letterSpacing = "0em" as unknown as string;

  // Stats row near the bottom of the body.
  const stats = `${cert.lessonCount} lesson${cert.lessonCount === 1 ? "" : "s"} completed  ·  ${cert.xpEarned.toLocaleString()} XP earned`;
  ctx.fillStyle = INK_SOFT;
  ctx.font = `500 16px ${SANS}`;
  ctx.fillText(stats, centerX, 425);

  if (cert.courseLanguage) {
    // Language pill: near-black tracked uppercase (was amber).
    ctx.fillStyle = INK;
    ctx.font = `700 12px ${SANS}`;
    ctx.letterSpacing = "0.22em" as unknown as string;
    ctx.fillText(cert.courseLanguage.toUpperCase(), centerX, 452);
    ctx.letterSpacing = "0em" as unknown as string;
  }

  // Issuer line + cert ID at the very bottom of the body.
  ctx.fillStyle = INK;
  ctx.font = `600 14px ${SANS}`;
  ctx.textAlign = "left";
  ctx.fillText("Issued by Libre.academy", left, H - 50);

  ctx.fillStyle = INK_SOFT;
  ctx.font = `500 11px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.fillText(`Certificate ID · ${cert.id.slice(0, 16)}`, left, H - 30);
}

// ─── Stub (tear-off, right side) ────────────────────────────────

async function paintStub(
  ctx: CanvasRenderingContext2D,
  cert: Certificate,
): Promise<void> {
  const stubLeft = PERF_X + NOTCH_R;
  const stubRight = W - 30;
  const stubCenterX = (stubLeft + stubRight) / 2;

  // "VERIFY" eyebrow at the top of the stub — modernized to the
  // app's default sans with tracked uppercase. The old phrase
  // "SCAN TO VERIFY" was redundant with the caption beneath the
  // QR ("Scan with any camera or QR reader to verify."); the
  // shorter "VERIFY" leaves the caption to carry the how-to.
  const STUB_SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = INK_SOFT;
  ctx.font = `600 13px ${STUB_SANS}`;
  ctx.textAlign = "center";
  ctx.letterSpacing = "0.32em" as unknown as string;
  ctx.fillText("VERIFY", stubCenterX, 80);
  ctx.letterSpacing = "0em" as unknown as string;

  // QR code. Generated as a data URL then drawn at a fixed size,
  // centered on the stub.
  const url = buildVerifyUrl(cert);
  const qrSize = 280;
  const qrX = stubCenterX - qrSize / 2;
  const qrY = 110;
  const QRCode = (await import("qrcode")).default;
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: "M",
    color: {
      dark: INK,
      light: "#00000000", // transparent — parchment shows through
    },
  });
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
      resolve();
    };
    img.onerror = () => reject(new Error("QR image load failed"));
    img.src = qrDataUrl;
  });

  // Caption + cert ID below the QR.
  ctx.fillStyle = INK_SOFT;
  ctx.font = `500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("Scan with any camera or", stubCenterX, qrY + qrSize + 28);
  ctx.fillText("QR reader to verify.", stubCenterX, qrY + qrSize + 46);

  ctx.fillStyle = ACCENT_SOFT;
  ctx.font = `600 10px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.fillText(`ID ${cert.id.slice(0, 12)}`, stubCenterX, H - 35);
}

/// Load an Image asynchronously. Used by the brand-logo render at
/// the top of the cert body — `ctx.drawImage` needs a fully-loaded
/// HTMLImageElement, and the standard image element fires `onload`
/// once the decode is complete. Wrapped in a promise so the caller
/// can await it cleanly.
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${src}`));
    img.src = src;
  });
}

// ─── Utility ────────────────────────────────────────────────────

function fitToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  // Cheap auto-ellipsis. Doesn't shrink the font (which would
  // produce inconsistent visual weight across certs); instead it
  // trims the tail and appends a horizontal ellipsis when the
  // rendered width would exceed the layout column.
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid) + "…";
    if (ctx.measureText(candidate).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo) + "…";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob returned null"));
      },
      "image/png",
    );
  });
}
