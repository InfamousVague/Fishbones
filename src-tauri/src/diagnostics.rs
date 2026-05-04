//! Self-diagnostics: probe the desktop app's bundled assets +
//! external services so we can spot "feature X is broken on platform
//! Y" before users have to file a bug report. Drives the Settings →
//! Diagnostics tab.
//!
//! ### Categories
//!
//! Each check returns a `CheckResult` with a status: `Pass` /
//! `Warn` / `Fail`. The Settings UI groups them by category and
//! shows the optional `remedy` string as a tooltip / hover hint.
//!
//! Adding a check:
//! 1. Define a function that returns a `CheckResult`
//! 2. Call it from `run_diagnostics()` and append to the return list
//! 3. UI updates automatically — section icons + counts come from
//!    the `category` field
//!
//! Side effects: NONE. Diagnostics MUST be read-only — the user is
//! running them precisely because something might be wrong, and
//! we don't want a "diagnose" button to break things further.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Pass,
    Warn,
    Fail,
}

#[derive(Serialize)]
pub struct CheckResult {
    pub id: String,
    pub category: String,
    pub label: String,
    pub status: CheckStatus,
    /// Human-readable detail — e.g. "found 27 archives" or "path
    /// `<...>` does not exist".
    pub detail: String,
    /// What to do if this check fails. Optional; UI shows it on
    /// hover. Mostly relevant for `Fail` status.
    pub remedy: Option<String>,
}

/// Run every diagnostic check, return the full report. Mostly cheap
/// — bundle / data probes are filesystem-only (microseconds). Native
/// toolchain probes spawn `<binary> --version` per language, which
/// adds ~50ms per probe; with ~12 languages that's <1s total which
/// is acceptable for an on-Settings-open call.
///
/// Made async because the language toolchain probes (`tokio::process`)
/// require an async runtime to spawn — the rest of the checks are
/// sync and just return their result directly.
#[tauri::command]
pub async fn run_diagnostics(app: tauri::AppHandle) -> Vec<CheckResult> {
    let mut out = Vec::new();
    // Bundled assets — what shipped inside the installer.
    out.push(check_resource_dir(&app));
    out.push(check_bundled_packs(&app));
    out.push(check_vendor_dir(&app));
    out.push(check_node_runtime(&app));
    // User data — where progress / settings live.
    out.push(check_app_data_dir());
    out.push(check_progress_db(&app));
    // Web runtimes — solc CDN reachability matters for the
    // smart-contract lessons (Mastering Ethereum chapters 4-14).
    out.push(check_solc_cdn().await);
    // Blockchain SDKs — Solana CLI is needed for native-program
    // exercises in Solana Programs (cargo-build-sbf).
    out.push(check_solana_cli());
    // Native toolchains — every desktop-only language Fishbones
    // supports needs a real compiler/runtime on PATH. These are
    // category "Native toolchains" and sit at the bottom of the
    // panel.
    out.push(check_native("C / C++", "clang", &["--version"], "xcode-select --install"));
    out.push(check_native("Java", "java", &["-version"], "brew install openjdk"));
    out.push(check_native("Kotlin", "kotlinc", &["-version"], "brew install kotlin"));
    out.push(check_native("C# / .NET", "dotnet", &["--version"], "brew install --cask dotnet-sdk"));
    out.push(check_native("Swift", "swift", &["--version"], "xcode-select --install"));
    out.push(check_native(
        "Assembly (as / ld)",
        "as",
        &["--version"],
        "xcode-select --install",
    ));
    out.push(check_native("Go", "go", &["version"], "brew install go"));
    out.push(check_native(
        "Rust",
        "rustc",
        &["--version"],
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
    ));
    out.push(check_native("Zig", "zig", &["version"], "brew install zig"));
    out.push(check_native("Elixir", "elixir", &["--version"], "brew install elixir"));
    out.push(check_native("Ruby", "ruby", &["--version"], "brew install ruby"));
    out.push(check_native("Haskell (runghc)", "runghc", &["--version"], "brew install ghc"));
    out
}

fn resource_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().resource_dir().map_err(|e| e.to_string())
}

fn check_resource_dir(app: &tauri::AppHandle) -> CheckResult {
    match resource_dir(app) {
        Ok(p) if p.exists() => CheckResult {
            id: "resource-dir".into(),
            category: "Bundled assets".into(),
            label: "Resource directory accessible".into(),
            status: CheckStatus::Pass,
            detail: format!("{}", p.display()),
            remedy: None,
        },
        Ok(p) => CheckResult {
            id: "resource-dir".into(),
            category: "Bundled assets".into(),
            label: "Resource directory accessible".into(),
            status: CheckStatus::Fail,
            detail: format!("path does not exist: {}", p.display()),
            remedy: Some(
                "Reinstall the app — bundled resources didn't make it onto disk."
                    .into(),
            ),
        },
        Err(e) => CheckResult {
            id: "resource-dir".into(),
            category: "Bundled assets".into(),
            label: "Resource directory accessible".into(),
            status: CheckStatus::Fail,
            detail: e,
            remedy: Some("Reinstall the app.".into()),
        },
    }
}

/// Check the bundled .fishbones archives — catches the Windows
/// "Discover empty" regression from v0.1.7/v0.1.8. Walks the same
/// candidate paths `list_bundled_catalog_entries` does so the
/// diagnostic + the running code stay aligned.
fn check_bundled_packs(app: &tauri::AppHandle) -> CheckResult {
    let base = match resource_dir(app) {
        Ok(p) => p,
        Err(e) => {
            return CheckResult {
                id: "bundled-packs".into(),
                category: "Bundled assets".into(),
                label: "Course archives present".into(),
                status: CheckStatus::Fail,
                detail: format!("can't read resource_dir: {}", e),
                remedy: Some("Reinstall the app.".into()),
            };
        }
    };
    let candidates = vec![
        base.join("resources").join("bundled-packs"),
        base.join("bundled-packs"),
        base.clone(),
    ];
    for dir in &candidates {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            let count = entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .and_then(|s| s.to_str())
                        .map(|s| s == "fishbones" || s == "kata")
                        .unwrap_or(false)
                })
                .count();
            if count > 0 {
                return CheckResult {
                    id: "bundled-packs".into(),
                    category: "Bundled assets".into(),
                    label: "Course archives present".into(),
                    status: CheckStatus::Pass,
                    detail: format!("{} archives at {}", count, dir.display()),
                    remedy: None,
                };
            }
        }
    }
    CheckResult {
        id: "bundled-packs".into(),
        category: "Bundled assets".into(),
        label: "Course archives present".into(),
        status: CheckStatus::Fail,
        detail: format!(
            "no .fishbones archives found under any of: {:?}",
            candidates
        ),
        remedy: Some(
            "Reinstall the app — courses ship inside the installer.".into(),
        ),
    }
}

/// Check the vendored web runtime files (Babel, React, Three, Svelte,
/// etc.). These are bundled under `resources/vendor/` and the local
/// preview server serves them to the workbench iframe.
fn check_vendor_dir(app: &tauri::AppHandle) -> CheckResult {
    let base = match resource_dir(app) {
        Ok(p) => p,
        Err(_) => {
            return CheckResult {
                id: "vendor".into(),
                category: "Bundled assets".into(),
                label: "Vendored web runtimes".into(),
                status: CheckStatus::Fail,
                detail: "can't read resource_dir".into(),
                remedy: None,
            };
        }
    };
    let candidates = vec![
        base.join("resources").join("vendor"),
        base.join("vendor"),
    ];
    let mut found_dir: Option<PathBuf> = None;
    let mut count = 0usize;
    for dir in &candidates {
        if !dir.exists() {
            continue;
        }
        if let Ok(rd) = std::fs::read_dir(dir) {
            count = rd.filter_map(|e| e.ok()).count();
            if count > 0 {
                found_dir = Some(dir.clone());
                break;
            }
        }
    }
    match found_dir {
        Some(p) => CheckResult {
            id: "vendor".into(),
            category: "Bundled assets".into(),
            label: "Vendored web runtimes".into(),
            status: if count >= 5 {
                CheckStatus::Pass
            } else {
                CheckStatus::Warn
            },
            detail: format!("{} files at {}", count, p.display()),
            remedy: if count >= 5 {
                None
            } else {
                Some(
                    "Vendor dir present but partial — Web/Three.js/Svelte lessons may fail.".into(),
                )
            },
        },
        None => CheckResult {
            id: "vendor".into(),
            category: "Bundled assets".into(),
            label: "Vendored web runtimes".into(),
            status: CheckStatus::Fail,
            detail: format!("no vendor dir found under {:?}", candidates),
            remedy: Some(
                "Web preview lessons (HTML, Three.js, Svelte) won't run.".into(),
            ),
        },
    }
}

/// Check the bundled Node.js runtime — needed for SvelteKit lessons +
/// any future native-Node sidecar. Layout matches what
/// `scripts/fetch-node-runtime.mjs` produces under
/// `src-tauri/resources/node/`.
fn check_node_runtime(app: &tauri::AppHandle) -> CheckResult {
    let base = match resource_dir(app) {
        Ok(p) => p,
        Err(_) => {
            return CheckResult {
                id: "node".into(),
                category: "Bundled runtimes".into(),
                label: "Bundled Node.js".into(),
                status: CheckStatus::Fail,
                detail: "can't read resource_dir".into(),
                remedy: None,
            };
        }
    };
    let node_dir = base.join("resources").join("node");
    let alt_node_dir = base.join("node");
    let dir = if node_dir.exists() {
        node_dir
    } else if alt_node_dir.exists() {
        alt_node_dir
    } else {
        return CheckResult {
            id: "node".into(),
            category: "Bundled runtimes".into(),
            label: "Bundled Node.js".into(),
            status: CheckStatus::Warn,
            detail: format!("no node/ dir at {} or {}", node_dir.display(), alt_node_dir.display()),
            remedy: Some(
                "SvelteKit lessons require the bundled Node runtime — they'll fall back to a coming-soon panel.".into(),
            ),
        };
    };
    // Look for the binary in the platform-specific subpath. Tauri's
    // resource bundler preserves the layout from the staging script,
    // which is `node/<platform-arch>/bin/node` (Unix) or
    // `node/<platform-arch>/node.exe` (Windows).
    let bin_unix = walk_for_named_file(&dir, "node", 4);
    let bin_win = walk_for_named_file(&dir, "node.exe", 4);
    let found = bin_unix.or(bin_win);
    match found {
        Some(p) => CheckResult {
            id: "node".into(),
            category: "Bundled runtimes".into(),
            label: "Bundled Node.js".into(),
            status: CheckStatus::Pass,
            detail: p.display().to_string(),
            remedy: None,
        },
        None => CheckResult {
            id: "node".into(),
            category: "Bundled runtimes".into(),
            label: "Bundled Node.js".into(),
            status: CheckStatus::Fail,
            detail: format!("found {} but no node/node.exe binary inside", dir.display()),
            remedy: Some(
                "SvelteKit lessons won't run. Reinstall the app to restore.".into(),
            ),
        },
    }
}

fn check_app_data_dir() -> CheckResult {
    match dirs::data_dir() {
        Some(p) if p.exists() => CheckResult {
            id: "app-data".into(),
            category: "User data".into(),
            label: "Application Support directory writable".into(),
            status: CheckStatus::Pass,
            detail: p.display().to_string(),
            remedy: None,
        },
        _ => CheckResult {
            id: "app-data".into(),
            category: "User data".into(),
            label: "Application Support directory writable".into(),
            status: CheckStatus::Fail,
            detail: "no per-user data dir on this OS".into(),
            remedy: Some(
                "Progress + settings can't persist. Check OS permissions.".into(),
            ),
        },
    }
}

fn check_progress_db(app: &tauri::AppHandle) -> CheckResult {
    match crate::progress_db::resolve_path(app) {
        Ok(p) if p.exists() => CheckResult {
            id: "progress-db".into(),
            category: "User data".into(),
            label: "Progress database initialised".into(),
            status: CheckStatus::Pass,
            detail: p.display().to_string(),
            remedy: None,
        },
        Ok(p) => CheckResult {
            id: "progress-db".into(),
            category: "User data".into(),
            label: "Progress database initialised".into(),
            status: CheckStatus::Warn,
            detail: format!("not yet created at {}", p.display()),
            remedy: Some(
                "Will be created on the first lesson completion. Not a problem on a fresh install.".into(),
            ),
        },
        Err(e) => CheckResult {
            id: "progress-db".into(),
            category: "User data".into(),
            label: "Progress database initialised".into(),
            status: CheckStatus::Fail,
            detail: e.to_string(),
            remedy: Some(
                "Lesson completion won't persist. Check the OS data dir permissions.".into(),
            ),
        },
    }
}

/// Recursive directory walk looking for a single file by exact name.
/// Bounded at `max_depth` so we don't blow the stack on a pathological
/// resource layout. Returns the first hit; intentional, since the
/// caller wants ANY match.
fn walk_for_named_file(start: &Path, name: &str, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 {
        return None;
    }
    let entries = match std::fs::read_dir(start) {
        Ok(rd) => rd,
        Err(_) => return None,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|s| s.to_str()) == Some(name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(p) = walk_for_named_file(&path, name, max_depth - 1) {
                return Some(p);
            }
        }
    }
    None
}

// ─── Native-toolchain probes ───────────────────────────────────────
//
// Reuses `crate::toolchain::find_working_binary` so the diagnostics
// view + the missing-toolchain banner agree on what counts as
// "installed". Both walk the same broadened-PATH search and reject
// macOS stub binaries (the `/usr/bin/java` "please install Java"
// stub passes `which` but fails `java -version`).

fn check_native(
    label: &str,
    binary: &str,
    version_args: &[&str],
    install_hint: &str,
) -> CheckResult {
    let working = crate::toolchain::find_working_binary(binary, version_args);
    let id = format!("toolchain-{}", binary);
    match working {
        Some(p) => CheckResult {
            id,
            category: "Native toolchains".into(),
            label: label.into(),
            status: CheckStatus::Pass,
            detail: p,
            remedy: None,
        },
        None => CheckResult {
            id,
            category: "Native toolchains".into(),
            // Warn (not Fail) — most native toolchains are optional;
            // a learner who doesn't touch C lessons doesn't care that
            // clang isn't installed. The fail cases are bundled assets
            // (see check_bundled_packs).
            label: label.into(),
            status: CheckStatus::Warn,
            detail: format!("`{}` not found on PATH", binary),
            remedy: Some(format!("Install: {}", install_hint)),
        },
    }
}

/// Solana CLI lives outside the toolchain.rs recipe table because
/// it's needed for the SVM lessons (`cargo build-sbf` to compile
/// Solana programs to BPF) but isn't a "language" Fishbones runs
/// directly. find_working_binary already searches the standard
/// `~/.local/share/solana/...` install dir thanks to the candidate
/// list extension in toolchain.rs.
fn check_solana_cli() -> CheckResult {
    let working = crate::toolchain::find_working_binary("solana", &["--version"]);
    match working {
        Some(p) => CheckResult {
            id: "solana-cli".into(),
            category: "Blockchain SDKs".into(),
            label: "Solana CLI (cargo-build-sbf)".into(),
            status: CheckStatus::Pass,
            detail: p,
            remedy: None,
        },
        None => CheckResult {
            id: "solana-cli".into(),
            category: "Blockchain SDKs".into(),
            label: "Solana CLI (cargo-build-sbf)".into(),
            status: CheckStatus::Warn,
            detail: "solana not on PATH or in standard install dir".into(),
            remedy: Some(
                "Solana lessons that compile native programs need it. Install via:\n  sh -c \"$(curl -sSfL https://release.anza.xyz/stable/install)\""
                    .into(),
            ),
        },
    }
}

/// Reach out to the solc compiler CDN to confirm Mastering Ethereum's
/// in-browser EVM lessons can fetch the compiler. We don't download
/// the full ~30MB file — just HEAD the resource so we know DNS +
/// TLS + GitHub's-side existence are working. Network-bound; runs
/// async with a 5s timeout to avoid hanging the Settings panel.
async fn check_solc_cdn() -> CheckResult {
    // Pinned to match `src/runtimes/solidity.ts`'s SOLC_VERSION.
    // If the version drifts, the diagnostic's claim of "reachable"
    // would be misleading — keep this in lockstep.
    let url = "https://binaries.soliditylang.org/bin/soljson-v0.8.26+commit.8a97fa7a.js";
    let probe = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .map_err(|e| e.to_string())?;
            client
                .head(url)
                .send()
                .await
                .map_err(|e| e.to_string())
        },
    )
    .await;
    match probe {
        Ok(Ok(resp)) if resp.status().is_success() => CheckResult {
            id: "solc-cdn".into(),
            category: "Web runtimes".into(),
            label: "Solidity compiler CDN reachable".into(),
            status: CheckStatus::Pass,
            detail: format!("{} → HTTP {}", url, resp.status().as_u16()),
            remedy: None,
        },
        Ok(Ok(resp)) => CheckResult {
            id: "solc-cdn".into(),
            category: "Web runtimes".into(),
            label: "Solidity compiler CDN reachable".into(),
            status: CheckStatus::Warn,
            detail: format!("HTTP {} from {}", resp.status().as_u16(), url),
            remedy: Some(
                "EVM/Solidity lessons can't compile until this URL is reachable.".into(),
            ),
        },
        Ok(Err(e)) => CheckResult {
            id: "solc-cdn".into(),
            category: "Web runtimes".into(),
            label: "Solidity compiler CDN reachable".into(),
            status: CheckStatus::Fail,
            detail: format!("network error: {}", e),
            remedy: Some(
                "Check your internet connection or proxy settings. EVM/Solidity lessons need this CDN at run time."
                    .into(),
            ),
        },
        Err(_) => CheckResult {
            id: "solc-cdn".into(),
            category: "Web runtimes".into(),
            label: "Solidity compiler CDN reachable".into(),
            status: CheckStatus::Warn,
            detail: "request timed out after 5s".into(),
            remedy: Some(
                "Slow network — EVM/Solidity lesson startup will be slow but should still work eventually."
                    .into(),
            ),
        },
    }
}
