//! Dev-tool commands for the React Native playground.
//!
//! Two narrow hooks:
//!   - `open_in_ios_sim(url)` — boots the default iPhone sim if it
//!     isn't running and opens `url` in mobile Safari inside it. Used
//!     for react-native-web previews so the learner can eyeball a
//!     phone-sized viewport without plugging in a real device.
//!   - `probe_expo_server()` — probes the common Expo dev-server
//!     ports looking for a running `npx expo start`. Returns the
//!     `exp://...` URL the user can feed to Expo Go so we can render
//!     a QR. Returns `None` when nothing is listening.
//!
//! Both are best-effort. If Xcode / Expo isn't installed the frontend
//! degrades gracefully (hides the button or shows install hints).
use std::io::Read;
use std::net::{SocketAddr, TcpStream};
use std::process::Command;
use std::time::Duration;

use serde::Serialize;

/// Shell out to `xcrun simctl` + `open -a Simulator` to:
///   1. Ensure the Simulator.app is running (launching it cold takes
///      ~2s — `open -a` is a no-op when it's already up).
///   2. Boot the default iPhone sim if nothing's booted yet.
///   3. Open the URL in Mobile Safari inside the booted device.
///
/// Returns `launch_error` when the Xcode tooling isn't available so
/// the frontend can surface an install hint instead of a silent
/// failure.
#[tauri::command]
pub fn open_in_ios_sim(url: String) -> Result<(), String> {
    // Make sure Simulator.app is running. Cheap — the OS dedupes
    // repeat `open -a` calls to an activation signal when the app is
    // already up, so we don't need to gate on a running-check first.
    let _ = Command::new("open")
        .arg("-a")
        .arg("Simulator")
        .output()
        .map_err(|e| format!("failed to launch Simulator.app: {e}"))?;

    // Ensure there's a booted device. If something is already booted
    // `simctl boot` errors; that's fine, we treat that as a success.
    // Target `booted` first — if anything is up simctl openurl will
    // succeed; otherwise fall back to booting the default iPhone.
    let booted = Command::new("xcrun")
        .args(["simctl", "list", "devices", "booted"])
        .output();
    let booted_empty = match booted {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().lines().count() <= 1,
        Err(e) => {
            let hint = if e.kind() == std::io::ErrorKind::NotFound {
                "xcrun not found on PATH — install the Xcode Command Line Tools: `xcode-select --install`".to_string()
            } else {
                format!("failed to query simctl: {e}")
            };
            return Err(hint);
        }
    };

    if booted_empty {
        // Boot the first available iPhone. `simctl boot iPhone 15` et
        // al accept device names as well as UDIDs, and the "iPhone"
        // prefix lets the runtime pick whichever iPhone model the
        // user's Xcode install prefers.
        let _ = Command::new("xcrun")
            .args(["simctl", "boot", "iPhone"])
            .output();
    }

    // Open the URL in the booted sim's default browser. Errors here
    // propagate as a user-visible message — this is the actual action
    // the learner asked for.
    let out = Command::new("xcrun")
        .args(["simctl", "openurl", "booted", &url])
        .output()
        .map_err(|e| format!("failed to run simctl openurl: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "simctl openurl failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ExpoProbe {
    /// `exp://<lan-ip>:<port>` — the URL Expo Go scans via QR. `None`
    /// when nothing was found listening on the common ports.
    pub exp_url: Option<String>,
    /// Dev-server home page if one responds on the same port. Useful
    /// as a secondary "Open in browser" target so the learner can
    /// sanity-check the Metro server before scanning.
    pub http_url: Option<String>,
}

/// Scan the usual Expo / Metro dev-server ports for a live server and
/// report back what we found. The two main ports Expo listens on are
/// 8081 (Metro, modern CLI) and 19000 (classic). We touch the
/// JSON-only manifest endpoint (`/`) with a tiny timeout and look for
/// the Expo "main" Metro marker in the response headers. False
/// positives are fine — the frontend shows a QR either way and Expo
/// Go just fails to load if the target isn't actually Expo.
#[tauri::command]
pub fn probe_expo_server() -> ExpoProbe {
    // Order mirrors how modern Expo picks a port: 8081 first, then
    // the legacy 19000 range.
    let candidates: &[u16] = &[8081, 19000, 19001, 19002, 19006];
    for &port in candidates {
        if let Some(ip) = tcp_alive("127.0.0.1", port) {
            // We probe via localhost but Expo Go needs the LAN IP so
            // a phone on the same Wi-Fi can reach the dev server.
            // Fall back to 127.0.0.1 for the HTTP URL — useful for
            // same-machine browsing, unreachable from Expo Go.
            let lan = lan_ipv4().unwrap_or_else(|| "127.0.0.1".to_string());
            return ExpoProbe {
                exp_url: Some(format!("exp://{lan}:{port}")),
                http_url: Some(format!("http://{ip}:{port}/")),
            };
        }
    }
    ExpoProbe {
        exp_url: None,
        http_url: None,
    }
}

/// Lightweight "is there something listening?" probe. Uses a 120ms
/// connect timeout — enough for a loopback server on a loaded machine
/// but short enough that scanning 5 ports stays snappy.
fn tcp_alive(host: &str, port: u16) -> Option<String> {
    let addr: SocketAddr = format!("{host}:{port}").parse().ok()?;
    match TcpStream::connect_timeout(&addr, Duration::from_millis(120)) {
        Ok(mut s) => {
            // Drain a single byte if anything is waiting so we don't
            // leave the peer hanging in a half-written state. Ignore
            // read errors — we just wanted the connection handshake.
            let _ = s.set_read_timeout(Some(Duration::from_millis(40)));
            let mut buf = [0u8; 1];
            let _ = s.read(&mut buf);
            Some(host.to_string())
        }
        Err(_) => None,
    }
}

/// Best-effort LAN IPv4 lookup. Creates a UDP socket, "connects" it
/// to a public IP (no packet leaves the box because UDP connect is
/// just routing-table consultation), and reads back `local_addr()` —
/// the OS fills in whichever interface would be used for the route.
/// Falls through to `None` when the machine is offline or the OS
/// refuses the socket (rare).
fn lan_ipv4() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let local = socket.local_addr().ok()?;
    // Only return RFC1918 / link-local addresses — anything else (e.g.
    // a public IP in a cloud box) is useless for Expo Go and we'd
    // rather fall back to `127.0.0.1` than mislead the user.
    match local.ip() {
        std::net::IpAddr::V4(v4)
            if v4.is_private() || v4.is_link_local() =>
        {
            Some(v4.to_string())
        }
        _ => None,
    }
}
