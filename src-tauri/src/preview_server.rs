//! Local HTTP server that exposes the Playground's rendered web output
//! at a stable `http://127.0.0.1:<port>` URL.
//!
//! Rationale: we used to drop the rendered HTML into an iframe inside
//! the OutputPane. That worked but hid the page behind a sandboxed
//! iframe with limited DevTools and no real-origin semantics. Shipping
//! it to a real browser tab gives the user the tools they already know
//! (network tab, console, responsive mode) while also letting them
//! test cross-device by just copy-pasting the URL to their phone.
//!
//! The server is lazy and single-shot: one background listener for the
//! lifetime of the app, bound to `127.0.0.1:0` so the OS assigns a free
//! port. Every `serve_web_preview` call just swaps the currently-served
//! HTML under a mutex and returns the pre-chosen URL.
//!
//! Scope note: this is explicitly NOT a production web server — it
//! responds to every path with the current HTML (including `/`, to keep
//! relative asset references working enough for inlined demos). Tests
//! stay in the hidden-iframe path inside `src/runtimes/web.ts`.
use std::io::Cursor;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use serde::Serialize;

/// State shared between the Tauri command handler and the listener
/// thread. Wraps the current HTML behind a Mutex so the command can
/// swap it atomically while the listener reads snapshots for each
/// incoming request.
struct PreviewState {
    html: Mutex<String>,
    addr: SocketAddr,
}

static STATE: OnceLock<Arc<PreviewState>> = OnceLock::new();

/// Return a reference to the lazily-initialised preview server. First
/// call binds to `127.0.0.1:0`, stores the chosen port, and spawns the
/// request loop. Subsequent calls are free.
///
/// Returns an `anyhow::Error` wrapped in `String` so it's easy for the
/// Tauri command (which returns `Result<_, String>`) to propagate.
fn state() -> Result<Arc<PreviewState>, String> {
    if let Some(s) = STATE.get() {
        return Ok(s.clone());
    }

    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| format!("failed to start preview server: {e}"))?;
    let addr = match server.server_addr() {
        tiny_http::ListenAddr::IP(a) => a,
        // tiny_http also supports Unix sockets — guard against that
        // so we never hand out a non-URL address to the frontend.
        tiny_http::ListenAddr::Unix(_) => {
            return Err("preview server bound to a unix socket, expected TCP".into());
        }
    };

    let state = Arc::new(PreviewState {
        html: Mutex::new(String::new()),
        addr,
    });

    // Background listener. Runs forever — we don't support stopping it
    // because the app shouldn't outlive the preview need. If the user
    // force-quits, the OS reclaims the port.
    let thread_state = state.clone();
    thread::Builder::new()
        .name("fishbones-preview-server".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                // Read a snapshot under the lock — Mutex is fine here
                // because contention is low (one request per preview
                // load + occasional command calls), and holding the
                // lock for the duration of the send would serialize
                // requests unnecessarily.
                let body = {
                    let guard = thread_state.html.lock().unwrap_or_else(|p| p.into_inner());
                    guard.clone()
                };
                let response = tiny_http::Response::new(
                    tiny_http::StatusCode(200),
                    vec![
                        tiny_http::Header::from_bytes(
                            &b"Content-Type"[..],
                            &b"text/html; charset=utf-8"[..],
                        )
                        .unwrap(),
                        // Disable caching so each run serves the latest
                        // HTML even though the URL is stable.
                        tiny_http::Header::from_bytes(
                            &b"Cache-Control"[..],
                            &b"no-store"[..],
                        )
                        .unwrap(),
                    ],
                    Cursor::new(body.clone().into_bytes()),
                    Some(body.len()),
                    None,
                );
                let _ = request.respond(response);
            }
        })
        .map_err(|e| format!("failed to spawn preview server thread: {e}"))?;

    let _ = STATE.set(state.clone());
    Ok(state)
}

#[derive(Debug, Serialize)]
pub struct PreviewHandle {
    /// The base URL the caller should surface to the user. Always
    /// `http://127.0.0.1:<port>/` so the page also handles the root
    /// request cleanly.
    pub url: String,
}

/// Tauri command: swap in new preview HTML and return the URL it'll be
/// served from. Safe to call repeatedly — the server starts on first
/// use and subsequent calls just update the held HTML.
#[tauri::command]
pub fn serve_web_preview(html: String) -> Result<PreviewHandle, String> {
    let state = state()?;
    {
        let mut guard = state.html.lock().unwrap_or_else(|p| p.into_inner());
        *guard = html;
    }
    Ok(PreviewHandle {
        url: format!("http://{}/", state.addr),
    })
}
