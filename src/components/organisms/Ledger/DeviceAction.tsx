import { useState } from "react";
import { ledger } from "@/lib/ledger/index";
import { describeStatus } from "@/lib/ledger/types";
import { useLedger } from "@/hooks/useLedger";
import "./DeviceAction.css";

/// Inline interactive button rendered inside reading lessons. Backs
/// the ```device-action``` markdown fence: students click, the
/// configured verb runs against the connected Ledger, and the
/// response is shown right there. No code editor, no test runner —
/// just "press this and see what comes back from your device".
///
/// Verb catalogue (extend as more chapters land):
///   - `connect`         — open the device picker / connect.
///   - `disconnect`      — close the current connection.
///   - `get-version`     — send `e0 06 00 00`; show flags + version
///                         bytes from the response.
///   - `get-eth-address` — send the Ethereum-app `getAddress` APDU
///                         for a configured path (default
///                         `m/44'/60'/0'/0/0`); show the address.
///   - `get-btc-address` — same shape for the Bitcoin app.
///   - `get-sol-pubkey`  — Solana app's pubkey-as-base58 path.
///   - `custom`          — render a "Send APDU" form with editable
///                         CLA/INS/P1/P2/data; useful for the
///                         "build your own APDU" exercises.
///
/// Each verb that talks to the device requires the user to be
/// connected first. When they're not, the button degrades to a
/// "Connect first" hint that opens the connect dialog instead.

export interface DeviceActionConfig {
  /// Which preset to run. See verb catalogue above.
  verb:
    | "connect"
    | "disconnect"
    | "list-devices"
    | "get-version"
    | "get-eth-address"
    | "get-btc-address"
    | "get-sol-pubkey"
    | "custom";
  /// Button label. Falls back to a verb-derived default.
  label?: string;
  /// `get-*-address` verbs use this path. Default `m/44'/60'/0'/0/0`
  /// for ETH, `m/44'/0'/0'/0/0` for BTC, `m/44'/501'/0'/0'` for SOL.
  path?: string;
  /// Whether the device should display + ask the user to confirm
  /// the address. Default true so learners see the safety prompt
  /// the first time they run a verb.
  display?: boolean;
  /// `custom` verb only: pre-fill the APDU bytes (lowercase hex
  /// without separators or `0x`). Without this, the form starts
  /// empty.
  apdu?: string;
}

interface Props {
  config: DeviceActionConfig;
}

export default function DeviceAction({ config }: Props) {
  const ledgerHook = useLedger();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [customApdu, setCustomApdu] = useState(config.apdu ?? "");

  const labelDefault = (() => {
    switch (config.verb) {
      case "connect":
        return "Connect Ledger";
      case "disconnect":
        return "Disconnect";
      case "list-devices":
        return "List connected Ledgers";
      case "get-version":
        return "Get app version";
      case "get-eth-address":
        return "Get Ethereum address";
      case "get-btc-address":
        return "Get Bitcoin address";
      case "get-sol-pubkey":
        return "Get Solana pubkey";
      case "custom":
        return "Send APDU";
    }
  })();

  const label = config.label ?? labelDefault;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      switch (config.verb) {
        case "connect": {
          const info = await ledgerHook.connect();
          // useLedger sets state internally; surface the model name
          // as the success line.
          setResult({
            kind: "ok",
            text: `Connected: ${info?.model ?? "Ledger"}${
              info?.product ? ` (${info.product})` : ""
            }`,
          });
          break;
        }
        case "disconnect": {
          await ledgerHook.disconnect();
          setResult({ kind: "ok", text: "Disconnected" });
          break;
        }
        case "list-devices": {
          // Enumeration doesn't require an open connection — useful
          // for "show me what's plugged in" before the user clicks
          // Connect.
          const devices = await ledger.listDevices();
          if (devices.length === 0) {
            setResult({
              kind: "ok",
              text: "No Ledger devices found. Plug yours in + unlock it, then try again.",
            });
          } else {
            const lines = devices.map(
              (d, i) =>
                `${i + 1}. ${d.model}${d.product ? ` — ${d.product}` : ""}${
                  d.serialNumber ? ` (s/n ${d.serialNumber})` : ""
                }`,
            );
            setResult({
              kind: "ok",
              text: `Found ${devices.length} device${devices.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
            });
          }
          break;
        }
        case "get-version": {
          // Works against most Ledger apps — `0xe0 0x06 0x00 0x00`
          // returns "[flags(1B)] [version(3B)]" + status word.
          const r = await ledger.send(0xe0, 0x06, 0x00, 0x00);
          const sw = (r[r.length - 2] << 8) | r[r.length - 1];
          if (sw !== 0x9000) {
            setResult({ kind: "error", text: describeStatus(sw) });
            break;
          }
          // Heuristic: if response is exactly 4 bytes (flags + 3-byte
          // version) show as "1.x.y"; otherwise hex-dump.
          const data = r.slice(0, r.length - 2);
          if (data.length === 4) {
            setResult({
              kind: "ok",
              text: `flags=0x${data[0].toString(16).padStart(2, "0")}  version=${data[1]}.${data[2]}.${data[3]}`,
            });
          } else {
            setResult({
              kind: "ok",
              text: `data: ${hexDump(data)}`,
            });
          }
          break;
        }
        case "get-eth-address":
        case "get-btc-address":
        case "get-sol-pubkey": {
          const result = await runAddressVerb(config.verb, config);
          setResult(result);
          break;
        }
        case "custom": {
          const apduBytes = parseHex(customApdu);
          if (apduBytes.length < 4) {
            setResult({
              kind: "error",
              text: "APDU must be at least 4 bytes (CLA INS P1 P2)",
            });
            break;
          }
          const data = apduBytes.length > 5 ? apduBytes.slice(5) : undefined;
          const r = await ledger.send(
            apduBytes[0],
            apduBytes[1],
            apduBytes[2],
            apduBytes[3],
            data,
          );
          const sw = (r[r.length - 2] << 8) | r[r.length - 1];
          const dataPart = r.slice(0, r.length - 2);
          setResult({
            kind: sw === 0x9000 ? "ok" : "error",
            text: `sw=0x${sw.toString(16).padStart(4, "0")} (${describeStatus(sw)})\ndata=${hexDump(dataPart) || "<empty>"}`,
          });
          break;
        }
      }
    } catch (err) {
      setResult({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  // `list-devices` works without an open connection (it just enumerates).
  // `connect` opens; `disconnect` doesn't need to prompt. Everything else
  // assumes an open device.
  const needsConnection =
    config.verb !== "connect" &&
    config.verb !== "list-devices" &&
    !ledgerHook.device;

  // Inline connect — when the action's verb requires a device but
  // none is open, swap the button's primary action for a connect.
  // Easier to discover than the meta-row pill, especially in long
  // lessons where the pill is scrolled out of view by the time the
  // learner reaches the device-action.
  const inlineConnect = async () => {
    setBusy(true);
    setResult(null);
    try {
      await ledgerHook.connect();
    } catch (err) {
      setResult({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const showConnectInstead =
    needsConnection && config.verb !== "disconnect";

  return (
    <div className="libre-device-action">
      <div className="libre-device-action__row">
        <button
          type="button"
          className="libre-device-action__button"
          onClick={() => void (showConnectInstead ? inlineConnect() : run())}
          disabled={busy}
          title={
            showConnectInstead
              ? "Plug in + unlock your Ledger, then click to connect."
              : undefined
          }
        >
          {busy
            ? showConnectInstead
              ? "Connecting…"
              : "Running…"
            : showConnectInstead
              ? `Connect Ledger to ${label.toLowerCase()}`
              : label}
        </button>
      </div>
      {config.verb === "custom" && (
        <div className="libre-device-action__custom">
          <input
            type="text"
            className="libre-device-action__input"
            placeholder="APDU bytes as hex, e.g. e0060000"
            value={customApdu}
            onChange={(e) => setCustomApdu(e.target.value)}
            disabled={busy}
            spellCheck={false}
          />
        </div>
      )}
      {result && (
        <pre
          className={
            "libre-device-action__output " +
            (result.kind === "ok"
              ? "libre-device-action__output--ok"
              : "libre-device-action__output--err")
          }
        >
          {result.text}
        </pre>
      )}
    </div>
  );
}

async function runAddressVerb(
  verb: "get-eth-address" | "get-btc-address" | "get-sol-pubkey",
  config: DeviceActionConfig,
): Promise<{ kind: "ok" | "error"; text: string }> {
  const display = config.display !== false;
  // Default paths per chain — the same defaults @ledgerhq/hw-app-*
  // libraries use. Override via config.path.
  const defaultPath =
    verb === "get-btc-address"
      ? "m/44'/0'/0'/0/0"
      : verb === "get-sol-pubkey"
        ? "m/44'/501'/0'/0'"
        : "m/44'/60'/0'/0/0";
  const path = config.path ?? defaultPath;
  const pathBytes = encodePath(parsePath(path));

  // Each chain has its own get-address APDU. The CLA + INS pairs
  // here match the upstream apps.
  let cla: number, ins: number;
  switch (verb) {
    case "get-eth-address":
      cla = 0xe0;
      ins = 0x02;
      break;
    case "get-btc-address":
      cla = 0xe0;
      ins = 0x40;
      break;
    case "get-sol-pubkey":
      cla = 0xe0;
      ins = 0x05;
      break;
  }
  const p1 = display ? 0x01 : 0x00;
  const p2 = 0x00;
  const r = await ledger.send(cla, ins, p1, p2, pathBytes);
  const sw = (r[r.length - 2] << 8) | r[r.length - 1];
  if (sw !== 0x9000) {
    return { kind: "error", text: describeStatus(sw) };
  }
  const data = r.slice(0, r.length - 2);
  // Each app's response format differs. Show the raw response as
  // hex so learners can identify the structure (later chapters
  // reimplement parsing themselves).
  return {
    kind: "ok",
    text: `Path: ${path}\nResponse (${data.length} bytes):\n${hexDump(data)}`,
  };
}

function parsePath(path: string): number[] {
  if (path !== "m" && !path.startsWith("m/")) {
    throw new Error("path must start with 'm' or 'm/': " + path);
  }
  const tail = path === "m" ? "" : path.slice(2);
  if (tail === "") return [];
  const parts = tail.split("/");
  const out: number[] = [];
  for (const part of parts) {
    let raw = part;
    let hardened = false;
    if (raw.endsWith("'") || raw.endsWith("h")) {
      hardened = true;
      raw = raw.slice(0, -1);
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n >= 0x80000000) {
      throw new Error("bad path component: " + part);
    }
    out.push(hardened ? n + 0x80000000 : n);
  }
  return out;
}

function encodePath(indices: number[]): Uint8Array {
  const out = new Uint8Array(1 + 4 * indices.length);
  out[0] = indices.length;
  for (let i = 0; i < indices.length; i++) {
    const n = indices[i];
    const off = 1 + 4 * i;
    out[off] = (n >>> 24) & 0xff;
    out[off + 1] = (n >>> 16) & 0xff;
    out[off + 2] = (n >>> 8) & 0xff;
    out[off + 3] = n & 0xff;
  }
  return out;
}

function parseHex(hex: string): Uint8Array {
  const clean = hex
    .replace(/^0x/i, "")
    .replace(/[\s,]/g, "")
    .toLowerCase();
  if (clean.length % 2 !== 0) {
    throw new Error("hex string has odd length");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function hexDump(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  // 16 bytes per line, lowercase, space-separated. Easy to copy/paste.
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    lines.push(hex);
  }
  return lines.join("\n");
}
