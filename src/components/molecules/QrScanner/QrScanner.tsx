/// Fullscreen camera-based QR scanner.
///
/// Opens the device's rear camera (`facingMode: "environment"`) into
/// a `<video>` element, pumps frames through `jsqr` at ~10 Hz, and
/// fires `onResult(text)` the moment a QR decodes successfully. Used
/// for pairing the phone with a Mac on the tailnet — the desktop's
/// AI Settings shows a QR for its hostname, the phone scans it and
/// auto-fills the assistant-host field.
///
/// iOS specifics:
///   - Tauri's WKWebView honours `getUserMedia` only when the host
///     app's Info.plist carries `NSCameraUsageDescription` — added
///     in this same change.
///   - `playsInline` on the video element is required, otherwise iOS
///     auto-promotes the stream to fullscreen video player chrome.
///   - The first call to `getUserMedia` triggers the system permission
///     prompt. Subsequent calls reuse the granted permission silently.
///
/// On non-mobile (desktop dev), this still works against a built-in
/// laptop camera — useful for testing the parser without a phone.

import { useEffect, useRef, useState } from "react";
// `jsqr` (~50KB of DSP) is dynamically imported when the camera
// starts — see `start()` below — so it stays out of the chunk of
// whichever surface mounts the scanner.
import "./QrScanner.css";

interface Props {
  /// Fired once on the first successful decode. The component does
  /// NOT auto-close — the caller decides whether to keep it open
  /// (e.g. for multi-scan flows) or unmount.
  onResult: (text: string) => void;
  /// User dismissed the scanner without a result (cancel button or
  /// permission denied). Caller should unmount when this fires.
  onCancel: () => void;
  /// Optional title shown over the viewfinder. Defaults to
  /// "Scan a QR code".
  title?: string;
  /// Optional sub-line — usually a hint about what the QR is for.
  /// Hidden when omitted.
  hint?: string;
}

/// Decode cadence. ~10 fps is plenty for QR detection — the encoder
/// runs in 30-60ms on iPhone hardware, so any faster is just heat.
const SCAN_INTERVAL_MS = 100;

export function QrScanner({ onResult, onCancel, title, hint }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera API isn't available in this build. Update the app and try again.",
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            // Cap the resolution — jsqr scales internally and 1080p
            // frames take ~3× longer to decode without improving
            // accuracy meaningfully on a phone-sized QR.
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        v.srcObject = stream;
        // iOS WKWebView: must call play() explicitly after srcObject
        // is set, AND the video element must have `playsInline` —
        // otherwise the stream auto-promotes to a fullscreen video
        // player taking over the whole screen.
        await v.play().catch((e) => {
          throw new Error(`Couldn't start the camera preview: ${e?.message ?? e}`);
        });
        setReady(true);

        // Load the decoder while the camera spins up — the stream
        // warm-up masks the chunk fetch, so by the first tick the
        // decoder is ready.
        const { default: jsQR } = await import("jsqr");
        if (cancelled) return;

        // Decode loop — runs against an offscreen canvas painted
        // from the video. We avoid `requestVideoFrameCallback` so
        // the loop runs at our own cadence + works on Safari
        // versions that don't ship that API yet.
        const tick = () => {
          if (cancelled) return;
          const c = canvasRef.current;
          if (!c || !v || v.readyState < v.HAVE_ENOUGH_DATA) return;
          const w = v.videoWidth;
          const h = v.videoHeight;
          if (!w || !h) return;
          // Match canvas size to the source frame ONCE; resizing
          // every tick blows away the 2D context state on some
          // engines and is wasteful. Only update when the source
          // dimensions actually change (e.g. orientation flip).
          if (c.width !== w) c.width = w;
          if (c.height !== h) c.height = h;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
          if (code?.data) {
            // Stop the camera before firing onResult so the LED
            // turns off instantly + the parent can unmount us
            // without racing on the still-active stream.
            stopStream();
            if (intervalId != null) {
              window.clearInterval(intervalId);
              intervalId = null;
            }
            onResult(code.data);
          }
        };
        intervalId = window.setInterval(tick, SCAN_INTERVAL_MS);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // NotAllowedError = user denied permission; message is more
        // useful than the raw class name for the inline UI.
        const friendly =
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access in iOS Settings → Libre → Camera, then re-open the scanner."
            : msg;
        setError(friendly);
      }
    };

    const stopStream = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    void start();

    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
      stopStream();
    };
  }, [onResult]);

  return (
    <div className="libre-qr-scanner" role="dialog" aria-label="Scan QR code">
      <div className="libre-qr-scanner__viewport">
        <video
          ref={videoRef}
          className={`libre-qr-scanner__video${ready ? " is-ready" : ""}`}
          playsInline
          muted
          aria-hidden
        />
        {/* Offscreen canvas — never displayed, only used by jsqr
            for pixel access. Hidden via CSS rather than
            display:none so the 2D context stays mountable. */}
        <canvas ref={canvasRef} className="libre-qr-scanner__canvas" aria-hidden />
        <div className="libre-qr-scanner__viewfinder" aria-hidden>
          <div className="libre-qr-scanner__corner libre-qr-scanner__corner--tl" />
          <div className="libre-qr-scanner__corner libre-qr-scanner__corner--tr" />
          <div className="libre-qr-scanner__corner libre-qr-scanner__corner--bl" />
          <div className="libre-qr-scanner__corner libre-qr-scanner__corner--br" />
        </div>
      </div>

      <div className="libre-qr-scanner__chrome">
        <div className="libre-qr-scanner__title">{title ?? "Scan a QR code"}</div>
        {hint && <div className="libre-qr-scanner__hint">{hint}</div>}
        {error && (
          <div className="libre-qr-scanner__error" role="alert">
            {error}
          </div>
        )}
        <button
          type="button"
          className="libre-qr-scanner__cancel"
          onClick={onCancel}
        >
          {error ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

export default QrScanner;
