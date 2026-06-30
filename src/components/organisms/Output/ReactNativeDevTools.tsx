import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
// `qrcode` is imported dynamically in the effects below so it
// code-splits out of this component's chunk.
import { Icon } from "@base/primitives/icon";
import { smartphone } from "@base/primitives/icon/icons/smartphone";
import { refreshCw } from "@base/primitives/icon/icons/refresh-cw";
import "./ReactNativeDevTools.css";

interface Props {
  /// The local preview URL produced by runReactNative (already served
  /// by the tiny_http preview server). We render a QR for it so the
  /// learner can scan with a phone on the same Wi-Fi and view the
  /// react-native-web render in mobile Safari.
  previewUrl: string;
}

interface ExpoProbe {
  exp_url: string | null;
  http_url: string | null;
}

/// Dev-tools row shown beneath the preview URL card when the runtime
/// is React Native. Three affordances, from most to least reliable:
///
///   1. "Open in iOS Simulator" — shells out to `xcrun simctl` via the
///      Tauri command. Works on macOS with Xcode installed; otherwise
///      the button reports the error from simctl.
///   2. QR code — shows the local preview URL. Scan with a phone
///      camera app to open in mobile Safari (browser rendering, not
///      native). Great for "does my layout actually fit on iPhone SE".
///   3. Expo Go section — detects a running Expo dev server via
///      `probe_expo_server` and renders a second QR pointing at
///      `exp://<lan>:<port>` when found. When not found, shows the
///      install-+-run instructions instead of a dead button.
///
/// We swap the user-facing URL displayed under each QR (local vs
/// Expo) so the learner knows which kind of phone-side app opens each.
export default function ReactNativeDevTools({ previewUrl }: Props) {
  const [localQr, setLocalQr] = useState<string | null>(null);
  const [expo, setExpo] = useState<ExpoProbe | null>(null);
  const [expoQr, setExpoQr] = useState<string | null>(null);
  const [simMessage, setSimMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [probing, setProbing] = useState(false);

  // Local-URL QR. Re-generates whenever the previewUrl changes (it's
  // stable across runs, but a belt-and-braces dep is cheap).
  useEffect(() => {
    let cancelled = false;
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(previewUrl, {
          margin: 1,
          width: 180,
          color: { dark: "#f5f5f7", light: "#0b0b10" },
        }),
      )
      .then((d) => {
        if (!cancelled) setLocalQr(d);
      });
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  // Probe once on mount — cheap, we can re-probe via the button.
  useEffect(() => {
    runExpoProbe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerate the Expo QR when the probe lands on a URL.
  useEffect(() => {
    if (!expo?.exp_url) {
      setExpoQr(null);
      return;
    }
    // Capture the narrowed (non-null) URL before the async import — TS
    // narrowing from the guard above doesn't flow into the .then scope.
    const expoUrl = expo.exp_url;
    let cancelled = false;
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(expoUrl, {
          margin: 1,
          width: 180,
          color: { dark: "#f5f5f7", light: "#0b0b10" },
        }),
      )
      .then((d) => {
        if (!cancelled) setExpoQr(d);
      });
    return () => {
      cancelled = true;
    };
  }, [expo?.exp_url]);

  async function runExpoProbe() {
    setProbing(true);
    try {
      const probe = await invoke<ExpoProbe>("probe_expo_server");
      setExpo(probe);
    } catch {
      setExpo({ exp_url: null, http_url: null });
    } finally {
      setProbing(false);
    }
  }

  async function openInSim() {
    setSimMessage(null);
    try {
      await invoke("open_in_ios_sim", { url: previewUrl });
      setSimMessage({
        kind: "ok",
        text: "Sent to booted iPhone simulator.",
      });
    } catch (e) {
      const text = typeof e === "string" ? e : String(e);
      setSimMessage({ kind: "err", text });
    }
  }

  return (
    <div className="libre-rndev">
      <div className="libre-rndev-head">
        <Icon icon={smartphone} size="xs" color="currentColor" />
        <span className="libre-rndev-label">React Native tools</span>
      </div>

      <div className="libre-rndev-grid">
        {/* Left column — QR for the local preview URL */}
        <div className="libre-rndev-card">
          <div className="libre-rndev-card-title">Scan on your phone</div>
          <div className="libre-rndev-card-hint">
            Camera app → opens the preview in mobile Safari (same Wi-Fi as
            this Mac).
          </div>
          <div className="libre-rndev-qrwrap">
            {localQr ? (
              <img
                className="libre-rndev-qr"
                src={localQr}
                alt={`QR code for ${previewUrl}`}
              />
            ) : (
              <div className="libre-rndev-qr-placeholder" aria-hidden />
            )}
          </div>
          <div className="libre-rndev-url" title={previewUrl}>
            {previewUrl}
          </div>
          <button
            type="button"
            className="libre-rndev-btn"
            onClick={openInSim}
          >
            <Icon icon={smartphone} size="xs" color="currentColor" />
            <span>Open in iOS Simulator</span>
          </button>
          {simMessage && (
            <div
              className={`libre-rndev-msg libre-rndev-msg--${simMessage.kind}`}
            >
              {simMessage.text}
            </div>
          )}
        </div>

        {/* Right column — Expo Go */}
        <div className="libre-rndev-card">
          <div className="libre-rndev-card-titlerow">
            <div className="libre-rndev-card-title">Expo Go</div>
            <button
              type="button"
              className="libre-rndev-probebtn"
              onClick={runExpoProbe}
              disabled={probing}
              title="Re-probe for a running Expo dev server"
            >
              <Icon icon={refreshCw} size="xs" color="currentColor" />
              <span>{probing ? "Probing…" : "Probe"}</span>
            </button>
          </div>
          {expo?.exp_url ? (
            <>
              <div className="libre-rndev-card-hint">
                Expo dev server detected. Scan with the Expo Go app.
              </div>
              <div className="libre-rndev-qrwrap">
                {expoQr ? (
                  <img
                    className="libre-rndev-qr"
                    src={expoQr}
                    alt={`QR code for ${expo.exp_url}`}
                  />
                ) : (
                  <div
                    className="libre-rndev-qr-placeholder"
                    aria-hidden
                  />
                )}
              </div>
              <div className="libre-rndev-url" title={expo.exp_url}>
                {expo.exp_url}
              </div>
            </>
          ) : (
            <>
              <div className="libre-rndev-card-hint">
                No Expo dev server found on the usual ports. Full Expo Go
                support needs your own Expo project and Metro bundler —
                Libre doesn't host one. The playground runtime here
                uses{" "}
                <code className="libre-rndev-code">react-native-web</code>
                {" "}so same APIs, different rendering path.
              </div>
              <ol className="libre-rndev-steps">
                <li>
                  Install Expo CLI:{" "}
                  <code className="libre-rndev-code">
                    npm i -g expo-cli
                  </code>
                </li>
                <li>
                  Start your project:{" "}
                  <code className="libre-rndev-code">npx expo start</code>
                </li>
                <li>Click Probe above, then scan the QR with Expo Go.</li>
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
