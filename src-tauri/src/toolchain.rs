//! Language-toolchain probe + install.
//!
//! When a learner opens the Playground (or a lesson) for a language
//! whose local toolchain isn't on PATH — Kotlin, Java, Go, Rust,
//! Swift, C/C++, Assembly, .NET, etc. — the frontend shows a banner
//! offering to install it. The probe half of this module answers
//! "is it installed?"; the install half runs the appropriate package-
//! manager command (almost always `brew install X` on macOS).
//!
//! Password flow:
//!   Homebrew installs don't need sudo (brew owns its prefix). Nearly
//!   every recipe below runs with `requires_password: false`. The
//!   infrastructure for sudo is wired through anyway — we collect the
//!   password from the frontend, pipe it through `sudo -S` stdin, and
//!   never log or persist it. When a future recipe adds a sudo-needing
//!   install it can flip the flag without touching the frontend.

use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Instant;

use serde::{Deserialize, Serialize};

/// Result of a `probe_language_toolchain` call. `installed: true` means
/// Fishbones can run code in this language right now; `installed: false`
/// with a populated `install_hint` means we know how to fix that and
/// the UI can offer a one-click install.
#[derive(Debug, Serialize)]
pub struct ToolchainStatus {
    pub language: String,
    pub installed: bool,
    /// First line of `<binary> --version` output when the binary is
    /// found. Shown in the banner as "Kotlin 2.0.21" so the learner
    /// knows exactly what's active.
    pub version: Option<String>,
    /// Populated only when `installed` is false. The frontend uses the
    /// fields here to render the install button + confirmation UI.
    pub install_hint: Option<InstallHint>,
}

/// Everything the UI needs to surface a clean install affordance.
/// `command` is passed straight back to `install_language_toolchain`;
/// the frontend doesn't build its own install command.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct InstallHint {
    /// "brew" / "rustup" / "xcode-select" / "manual" — drives the label
    /// and the friendlier "install via ..." copy in the banner.
    pub manager: String,
    /// The exact shell command we'll run. Shown to the user so they
    /// can see what's about to happen.
    pub command: String,
    /// When true, `install_language_toolchain` needs a password to be
    /// supplied (pipes into `sudo -S`). Every MVP recipe below is
    /// `false` because Homebrew doesn't need sudo.
    pub requires_password: bool,
    /// One-sentence explanation for the banner body. Written in plain
    /// English — "Installs the Kotlin compiler via Homebrew." — so a
    /// learner who's never used brew can still make an informed choice.
    pub description: String,
    /// Optional banner title override. Defaults to `{Language} isn't
    /// installed` when absent; set when the missing piece isn't the
    /// language itself — e.g. Kotlin has `kotlinc` on PATH but needs a
    /// JDK, where "Kotlin isn't installed" is both misleading and
    /// less actionable than "A JDK isn't installed".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Optional primary-button label override. Defaults to `Install
    /// {Language}` when absent; lets the partial-install case ask to
    /// install a JDK specifically instead of repeating "Install Kotlin"
    /// when kotlinc is already there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub button_label: Option<String>,
}

/// Result of a successful or failed install attempt. We always return
/// Ok(InstallResult) (never Err) so the frontend can render the same
/// live-output UI regardless of outcome — the `success` flag plus the
/// captured stderr tell the whole story.
#[derive(Debug, Serialize)]
pub struct InstallResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

/// Internal recipe table entry. Glued together from a probe binary,
/// its `--version` flag, and the install hint.
struct Recipe {
    /// Binary to look for on PATH. Empty string means "no local
    /// toolchain needed" — the language runs in the browser or an
    /// online sandbox, so the probe short-circuits to `installed: true`.
    binary: &'static str,
    /// Flag that prints the version. Most tools use `--version`; Java
    /// + Kotlin use `-version`. Keep per-language to match native
    /// conventions (`go version` etc).
    version_args: &'static [&'static str],
    install: Option<InstallHint>,
}

/// Per-language probe + install recipe. One match arm per supported
/// language — adding a new language is a single edit here. Languages
/// not in the match return None → the frontend treats it as "unknown"
/// and doesn't render a banner.
fn recipe(language: &str) -> Option<Recipe> {
    match language {
        // Browser-hosted / online-sandbox languages. Always "installed"
        // because we don't need a local toolchain. Saves the banner
        // from showing up pointlessly.
        "javascript" | "typescript" | "python" | "web" | "threejs" | "react"
        | "reactnative" => {
            Some(Recipe { binary: "", version_args: &[], install: None })
        }

        "kotlin" => Some(Recipe {
            binary: "kotlinc",
            version_args: &["-version"],
            install: Some(InstallHint {
                manager: "brew".into(),
                command: "brew install kotlin".into(),
                description: "Installs the Kotlin compiler (kotlinc) via Homebrew. No password needed.".into(),
                ..Default::default()
            }),
        }),

        "java" => Some(Recipe {
            binary: "java",
            // `java -version` prints to stderr on older JDKs and stdout
            // on newer ones. Our version-probe tolerates both.
            version_args: &["-version"],
            install: Some(InstallHint {
                manager: "brew".into(),
                command: "brew install openjdk".into(),
                description: "Installs OpenJDK via Homebrew. You may need to symlink it afterwards — the installer prints the exact command.".into(),
                ..Default::default()
            }),
        }),

        "go" => Some(Recipe {
            binary: "go",
            version_args: &["version"],
            install: Some(InstallHint {
                manager: "brew".into(),
                command: "brew install go".into(),
                description: "Installs Go via Homebrew. No password needed.".into(),
                ..Default::default()
            }),
        }),

        "rust" => Some(Recipe {
            binary: "rustc",
            version_args: &["--version"],
            install: Some(InstallHint {
                manager: "rustup".into(),
                // -y skips the interactive confirmation; --default-toolchain
                // stable picks the conventional default.
                command: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable".into(),
                description: "Installs Rust via rustup (the official installer). No password needed.".into(),
                ..Default::default()
            }),
        }),

        "swift" => Some(Recipe {
            binary: "swift",
            version_args: &["--version"],
            install: Some(InstallHint {
                manager: "xcode-select".into(),
                command: "xcode-select --install".into(),
                description: "Installs the Xcode Command Line Tools — macOS pops its own installer dialog, so you won't need to enter a password here.".into(),
                ..Default::default()
            }),
        }),

        "c" | "cpp" => Some(Recipe {
            binary: "clang",
            version_args: &["--version"],
            install: Some(InstallHint {
                manager: "xcode-select".into(),
                command: "xcode-select --install".into(),
                description: "Installs Clang via Xcode Command Line Tools — macOS pops its own installer dialog.".into(),
                ..Default::default()
            }),
        }),

        "csharp" => Some(Recipe {
            binary: "dotnet",
            version_args: &["--version"],
            install: Some(InstallHint {
                manager: "brew".into(),
                command: "brew install --cask dotnet-sdk".into(),
                description: "Installs the .NET SDK via Homebrew. No password needed.".into(),
                ..Default::default()
            }),
        }),

        "assembly" => Some(Recipe {
            // `as` and `ld` come bundled with Xcode Command Line Tools
            // on macOS, so the probe targets `as` (the assembler) as a
            // proxy for the whole toolchain. On Linux they come from
            // binutils which is usually pre-installed.
            binary: "as",
            version_args: &["--version"],
            install: Some(InstallHint {
                manager: "xcode-select".into(),
                command: "xcode-select --install".into(),
                description: "Installs GNU as + ld via Xcode Command Line Tools (macOS) or binutils (Linux).".into(),
                ..Default::default()
            }),
        }),

        _ => None,
    }
}

/// Public Tauri command — see module docs.
#[tauri::command]
pub async fn probe_language_toolchain(
    language: String,
) -> Result<ToolchainStatus, String> {
    let Some(r) = recipe(&language) else {
        return Err(format!("unknown language: {language}"));
    };
    // Languages without a local toolchain short-circuit to "installed"
    // so the frontend banner logic doesn't have to special-case them.
    if r.binary.is_empty() {
        return Ok(ToolchainStatus {
            language,
            installed: true,
            version: None,
            install_hint: None,
        });
    }
    // Iterate every candidate path (not just the first) because macOS
    // ships a "please install Java" stub at /usr/bin/java that satisfies
    // `which java` but fails `java -version` with a stub marker. The
    // first candidate that passes probe_exec wins; if none do, the
    // toolchain is genuinely broken.
    let candidates = find_binary_all(r.binary);
    let working = candidates
        .iter()
        .find_map(|p| match probe_exec(p, r.version_args) {
            Outcome::Ok { version } => Some((p.clone(), version)),
            Outcome::Broken => None,
        });
    let mut installed = working.is_some();
    let version = working.as_ref().and_then(|(_, v)| v.clone());
    let mut install_hint = if installed { None } else { r.install.clone() };

    // Kotlin wraps the JVM: `kotlinc` can be fully functional and
    // `kotlinc -version` can return a real version string, yet trying
    // to compile still fails with "Unable to locate a Java Runtime" if
    // no JDK is installed. The generic stub detection above only runs
    // the PRIMARY binary's version probe — it would green-light Kotlin
    // in that partial-install case and no banner would appear. So when
    // Kotlin's own probe says OK, cross-check Java too and downgrade
    // the status with a Kotlin-specific install hint if the JDK half
    // of the toolchain is missing or stubbed.
    if language == "kotlin" && installed {
        let java_working = find_binary_all("java")
            .iter()
            .any(|p| matches!(probe_exec(p, &["-version"]), Outcome::Ok { .. }));
        if !java_working {
            installed = false;
            install_hint = Some(InstallHint {
                manager: "brew".into(),
                command: "brew install openjdk".into(),
                description:
                    "Kotlin's compiler is installed, but it needs a JDK to run and none was found. This installs OpenJDK via Homebrew."
                        .into(),
                title: Some("A JDK isn't installed".into()),
                button_label: Some("Install OpenJDK".into()),
                ..Default::default()
            });
        }
    }

    Ok(ToolchainStatus {
        language,
        installed,
        version,
        install_hint,
    })
}

/// Outcome of actually executing a version probe. Distinguishes a
/// real "the toolchain runs" from "the binary exists but dies" — the
/// macOS `java` / `javac` / `kotlinc` stubs are the motivating case.
pub(crate) enum Outcome {
    Ok { version: Option<String> },
    Broken,
}

/// Iterate `find_binary_all` candidates and return the first path whose
/// version probe succeeds — i.e. a binary that actually runs, not a
/// macOS stub that prints "Unable to locate a Java Runtime" and exits
/// 1. Used by native-runners so we spawn the real kotlinc/java instead
/// of hanging the app on the stub's Software Update modal.
pub(crate) fn find_working_binary(name: &str, version_args: &[&str]) -> Option<String> {
    for path in find_binary_all(name) {
        if matches!(probe_exec(&path, version_args), Outcome::Ok { .. }) {
            return Some(path);
        }
    }
    None
}

/// Run `path <args>`, decide whether the toolchain actually works, and
/// (if so) pull a short version string out of stdout/stderr. This is
/// the "does it actually run" check: exit 0, no stub markers, and
/// something version-shaped in the output. We spawn the probe with the
/// same `broadened_path` the real runners use so that shell-script
/// wrappers (kotlinc, specifically) can re-resolve their own deps
/// (`java`) without falling into `/usr/bin/java` — the macOS stub that
/// would make an otherwise-working kotlinc look broken.
pub(crate) fn probe_exec(path: &str, args: &[&str]) -> Outcome {
    let Ok(out) = Command::new(path)
        .env("PATH", broadened_path())
        .args(args)
        .output()
    else {
        return Outcome::Broken;
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    // macOS Java stub. `java -version` on a system without a JDK
    // exits 1 AND prints this to stderr — we belt-and-suspenders both
    // signals so a future stub variant with a zero exit still trips.
    const STUB_MARKERS: &[&str] = &[
        "Unable to locate a Java Runtime",
        "No Java runtime present",
        "to locate a Java Runtime",
    ];
    if STUB_MARKERS.iter().any(|m| stderr.contains(m) || stdout.contains(m)) {
        return Outcome::Broken;
    }
    if !out.status.success() {
        return Outcome::Broken;
    }
    // First non-empty line of stdout, falling back to stderr for the
    // "prints to stderr" tools (Java, older Kotlin).
    let version = [stdout.as_ref(), stderr.as_ref()]
        .iter()
        .flat_map(|s| s.lines())
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map(|s| s.to_string());
    Outcome::Ok { version }
}

/// Public Tauri command — runs the install recipe for `language`.
/// Returns `InstallResult` in every case (no Err unless the language
/// is unknown / has no installer) so the frontend renders the outcome
/// from one code path.
///
/// The caller may pass a `command` to run *exactly* that — used when
/// the banner's hint is derived, not static (e.g. Kotlin's JDK-missing
/// case shows `brew install openjdk`, but the language's default
/// recipe is `brew install kotlin`). When `command` is absent we fall
/// back to the recipe's canonical hint.
///
/// For recipes with `requires_password: true`, the frontend MUST supply
/// a non-empty `password`; the command pipes it into `sudo -S` via
/// stdin and we scrub it from logs.
#[tauri::command]
pub async fn install_language_toolchain(
    language: String,
    password: Option<String>,
    command: Option<String>,
) -> Result<InstallResult, String> {
    let Some(r) = recipe(&language) else {
        return Err(format!("unknown language: {language}"));
    };
    let Some(mut hint) = r.install else {
        return Err(format!(
            "no installer configured for: {language}"
        ));
    };
    // Caller-supplied command overrides the recipe's default — this is
    // how the Kotlin partial-install case gets `brew install openjdk`
    // instead of `brew install kotlin` when kotlinc is present but the
    // JDK is missing. We trust the banner's shown command because the
    // only path that sets it is our own probe (see the `language ==
    // "kotlin" && installed` block above).
    if let Some(cmd) = command {
        hint.command = cmd;
    }

    let start = Instant::now();

    // Preflight: brew-based recipes need brew itself on PATH. Catch
    // this up front with a friendly message instead of letting the
    // command error out with a raw `sh: brew: command not found`.
    if hint.manager == "brew" && find_binary("brew").is_none() {
        return Err("Homebrew isn't installed on your Mac. Visit https://brew.sh — paste the one-line install command into Terminal, then come back and click Install again.".into());
    }

    let output = if hint.requires_password {
        let Some(pw) = password.filter(|p| !p.is_empty()) else {
            return Err("This install needs a password but none was provided.".into());
        };
        // `sudo -S` reads the password from stdin. `-p ''` suppresses the
        // prompt string so we don't capture it in stderr. The outer `sh -c`
        // wraps so the recipe can include pipes / && / etc.
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(format!("sudo -S -p '' {}", hint.command))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn installer: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            // We intentionally never log `pw` — belt-and-suspenders even
            // though `stdin` is piped not spoken.
            let _ = writeln!(stdin, "{pw}");
            // Drop stdin explicitly so `sudo` sees EOF and stops waiting
            // for more input.
            drop(stdin);
        }
        child
            .wait_with_output()
            .map_err(|e| format!("installer failed to run to completion: {e}"))?
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(&hint.command)
            // Inherit a broader PATH so `brew` in /opt/homebrew/bin is
            // reachable even when the app was launched from Finder with
            // the trimmed system PATH.
            .env("PATH", broadened_path())
            .output()
            .map_err(|e| format!("failed to run installer: {e}"))?
    };

    Ok(InstallResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

/// Locate a binary on PATH with Homebrew fallback paths for macOS
/// GUI-launched apps (which inherit a minimal `/usr/bin:/bin:/usr/sbin:
/// /sbin` PATH that doesn't include `/opt/homebrew/bin`). Same pattern
/// as `ingest::find_pdftotext`. Returns the first matching path — use
/// `find_binary_all` when you need to consider every candidate (e.g.
/// Java, where `/usr/bin/java` is a macOS stub that shadows the real
/// Homebrew-installed binary).
fn find_binary(name: &str) -> Option<String> {
    find_binary_all(name).into_iter().next()
}

/// Enumerate every existing path where `name` might live, in priority
/// order. Callers that need to reject "exists-but-broken" candidates
/// (the macOS Java stub at `/usr/bin/java` being the motivating case)
/// can iterate the list and run their own liveness probe until one
/// passes — see `probe_language_toolchain`. `pub(crate)` so
/// native-runners can resolve a real `java` path at run time, skipping
/// the stub.
pub(crate) fn find_binary_all(name: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    // Try `which` first — works when we inherited a useful PATH.
    if let Ok(output) = Command::new("which").arg(name).output() {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !s.is_empty() {
                out.push(s);
            }
        }
    }
    // Homebrew + system fallbacks. Order matters — Apple Silicon first
    // because /opt/homebrew takes precedence over /usr/local on M-series
    // Macs even when both exist. JDK-adjacent paths last (they're only
    // relevant for `java`/`javac`) so they don't burden other binaries.
    let candidates = [
        format!("/opt/homebrew/bin/{name}"),
        format!("/usr/local/bin/{name}"),
        format!("/usr/bin/{name}"),
        format!("/opt/homebrew/opt/openjdk/bin/{name}"),
        format!("/usr/local/opt/openjdk/bin/{name}"),
        format!("/Library/Java/JavaVirtualMachines/openjdk.jdk/Contents/Home/bin/{name}"),
        format!("{}/.cargo/bin/{}", std::env::var("HOME").unwrap_or_default(), name),
    ];
    for p in &candidates {
        if std::path::Path::new(p).exists() && !out.iter().any(|q| q == p) {
            out.push(p.clone());
        }
    }
    out
}


/// Build a PATH string that includes the usual Homebrew + rustup
/// locations. Used when spawning the installer because the parent
/// process's PATH is likely the reduced GUI-launched one.
///
/// Also `pub(crate)` so the native-runners module can prepend these
/// paths before spawning kotlinc / java — otherwise `kotlinc` (a
/// shell script) internally re-resolves `java` against the parent
/// process's minimal PATH and picks up the macOS stub at /usr/bin/java.
pub(crate) fn broadened_path() -> String {
    let existing = std::env::var("PATH").unwrap_or_default();
    // Openjdk's Homebrew keg-only dirs go first so `java` resolves to
    // the real JDK before /usr/bin's macOS stub. Without this the
    // kotlinc shell script would internally `exec java` and land on
    // /usr/bin/java, which either prints "Unable to locate a Java
    // Runtime" or (worse) hangs the app while macOS pops its Software
    // Update modal for java.com.
    let extra = [
        "/opt/homebrew/opt/openjdk/bin",
        "/usr/local/opt/openjdk/bin",
        "/Library/Java/JavaVirtualMachines/openjdk.jdk/Contents/Home/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];
    let home = std::env::var("HOME").unwrap_or_default();
    let cargo_bin = format!("{home}/.cargo/bin");
    let mut parts: Vec<String> = extra.iter().map(|s| s.to_string()).collect();
    parts.push(cargo_bin);
    if !existing.is_empty() {
        parts.push(existing);
    }
    parts.join(":")
}
