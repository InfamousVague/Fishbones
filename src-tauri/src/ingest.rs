//! In-app PDF ingest plumbing.
//!
//! The frontend picks a file via the Tauri dialog plugin, then calls
//! `extract_pdf_text(path)` which shells out to the system `pdftotext`
//! (poppler-utils). We return the raw text; the frontend (TypeScript)
//! handles chapter / section splitting using the same logic as the standalone
//! ingest CLI. This keeps the parsing code in one language.
//!
//! If `pdftotext` isn't installed we return a clear error so the UI can
//! show a one-click-install hint.

use std::process::Command;
use serde::Serialize;
use tauri::Manager;

#[derive(Debug, serde::Serialize)]
pub struct ExtractResult {
    pub text: String,
    /// Populated when pdftotext isn't on PATH so the UI can prompt the user.
    pub error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct StatResult {
    pub bytes: u64,
}

#[derive(Debug, serde::Serialize)]
pub struct ExtractImagesResult {
    /// Relative file names (not full paths) of the images that were written
    /// into `dest_dir`. Ordered by page, then by position on page — the
    /// pipeline's prose can reference them as figure-N.ext if it wants a
    /// stable identifier.
    pub images: Vec<String>,
    /// Directory the images were written to. Absolute path.
    pub dir: String,
    /// Populated when `pdfimages` isn't available on PATH so the UI can
    /// prompt the user to install poppler-utils.
    pub error: Option<String>,
}

/// Cheap metadata read for the ingest progress UI so we can show "reading
/// 142 MB PDF" before handing off to pdftotext (which otherwise runs silent
/// for tens of seconds on large books).
#[tauri::command]
pub fn stat_file(path: String) -> Result<StatResult, String> {
    match std::fs::metadata(&path) {
        Ok(m) => Ok(StatResult { bytes: m.len() }),
        Err(e) => Err(format!("stat {path}: {e}")),
    }
}

/// Extract every image embedded in the PDF into `dest_dir`, using the
/// `pdfimages` binary (poppler-utils) with `-all` so native-format (PNG,
/// JPEG, etc.) images come through without a lossy re-encode. Returns the
/// list of written filenames so the ingest pipeline can reference them
/// from lesson markdown.
///
/// Runs as a Tauri command rather than a Node subprocess because the
/// pipeline runs inside the webview and can't shell out directly; the same
/// reason `extract_pdf_text` lives here.
#[tauri::command]
pub fn extract_pdf_images(
    app: tauri::AppHandle,
    path: String,
    book_id: String,
) -> ExtractImagesResult {
    // Images live inside the same ingest-cache tree the pipeline already
    // uses, so clearing a book's cache nukes its images too. Per-book dir
    // keeps the cache browsable if someone opens it in Finder.
    let dest_dir: String = match app.path().app_data_dir() {
        Ok(d) => d
            .join("ingest-cache")
            .join(&book_id)
            .join("images")
            .to_string_lossy()
            .into_owned(),
        Err(e) => {
            return ExtractImagesResult {
                images: Vec::new(),
                dir: String::new(),
                error: Some(format!("couldn't resolve app data dir: {e}")),
            };
        }
    };
    if let Err(e) = std::fs::create_dir_all(&dest_dir) {
        return ExtractImagesResult {
            images: Vec::new(),
            dir: dest_dir,
            error: Some(format!("couldn't create dest dir: {e}")),
        };
    }
    // `-all` writes each image in its native format with a `-N-M` suffix
    // (page-index, per-page-index). `img` is the filename prefix we
    // strip when building the returned list.
    let prefix = "img";
    let output = match Command::new("pdfimages")
        .arg("-all")
        .arg(&path)
        .arg(format!("{dest_dir}/{prefix}"))
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            let hint = if e.kind() == std::io::ErrorKind::NotFound {
                "pdfimages not found on PATH — install poppler-utils first (on macOS: `brew install poppler`).".to_string()
            } else {
                format!("failed to launch pdfimages: {e}")
            };
            return ExtractImagesResult {
                images: Vec::new(),
                dir: dest_dir,
                error: Some(hint),
            };
        }
    };
    if !output.status.success() {
        return ExtractImagesResult {
            images: Vec::new(),
            dir: dest_dir,
            error: Some(format!(
                "pdfimages exited with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            )),
        };
    }

    // Read the dir and return everything matching our prefix, sorted for a
    // stable reference order across runs. We don't filter by extension —
    // `pdfimages -all` can emit PNG, JPG, TIFF, JBIG2, etc depending on
    // what's embedded; downstream consumers get to decide what's renderable.
    let mut images: Vec<String> = match std::fs::read_dir(&dest_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| n.starts_with(prefix))
            .collect(),
        Err(e) => {
            return ExtractImagesResult {
                images: Vec::new(),
                dir: dest_dir,
                error: Some(format!("couldn't list dest dir: {e}")),
            };
        }
    };
    images.sort();

    ExtractImagesResult {
        images,
        dir: dest_dir,
        error: None,
    }
}

/// Common Homebrew prefixes where `pdftotext` might live. macOS GUI apps
/// launched from Finder/Launchpad get a minimal inherited PATH (`/usr/bin:
/// /bin:/usr/sbin:/sbin`) that does NOT include Homebrew. When the bare
/// `pdftotext` lookup fails we try each of these in order before giving
/// up. Covers Apple Silicon (/opt/homebrew), Intel Macs (/usr/local), and
/// Linuxbrew.
const BREW_PATHS: &[&str] = &[
    "/opt/homebrew/bin/pdftotext",
    "/usr/local/bin/pdftotext",
    "/home/linuxbrew/.linuxbrew/bin/pdftotext",
];

/// Same Homebrew prefix list but for the sibling `pdftoppm` binary we
/// use to render book covers. Lives in the same poppler-utils package
/// as pdftotext, so if one is present the other usually is too — we
/// still probe independently in case someone custom-built one.
const BREW_PPM_PATHS: &[&str] = &[
    "/opt/homebrew/bin/pdftoppm",
    "/usr/local/bin/pdftoppm",
    "/home/linuxbrew/.linuxbrew/bin/pdftoppm",
];

/// Locate a runnable `pdftotext` binary. Returns the first candidate that
/// actually exists on disk, or `None` if nothing matched (user hasn't
/// installed poppler at all).
fn find_pdftotext() -> Option<String> {
    // Try the plain name first — works when the app was launched from a
    // shell (`npm run tauri:dev`) that already has brew on PATH.
    if Command::new("pdftotext")
        .arg("-v")
        .output()
        .is_ok()
    {
        return Some("pdftotext".to_string());
    }
    // Fall back to common Homebrew prefixes. This is the path for a
    // notarized .app launched from /Applications where PATH is stripped.
    for candidate in BREW_PATHS {
        if std::path::Path::new(candidate).exists() {
            return Some((*candidate).to_string());
        }
    }
    None
}

/// Locate a runnable `pdftoppm` binary. Same fallback pattern as
/// `find_pdftotext` — covers the macOS `.app` case where Homebrew
/// prefixes aren't on the inherited PATH.
fn find_pdftoppm() -> Option<String> {
    if Command::new("pdftoppm").arg("-v").output().is_ok() {
        return Some("pdftoppm".to_string());
    }
    for candidate in BREW_PPM_PATHS {
        if std::path::Path::new(candidate).exists() {
            return Some((*candidate).to_string());
        }
    }
    None
}

#[tauri::command]
pub fn extract_pdf_text(path: String) -> ExtractResult {
    let binary = match find_pdftotext() {
        Some(b) => b,
        None => {
            return ExtractResult {
                text: String::new(),
                error: Some(
                    "pdftotext not found — install poppler first (on macOS: `brew install poppler`). \
                     If poppler IS installed but you're seeing this, please report the Homebrew \
                     prefix you use so we can include it in the lookup fallback list."
                        .to_string(),
                ),
            };
        }
    };

    // -layout preserves column boundaries + form feeds (chapter breaks) which
    // the downstream parser relies on.
    let output = match Command::new(&binary)
        .arg("-layout")
        .arg(&path)
        .arg("-") // write to stdout
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            return ExtractResult {
                text: String::new(),
                error: Some(format!("failed to launch {binary}: {e}")),
            };
        }
    };

    if !output.status.success() {
        return ExtractResult {
            text: String::new(),
            error: Some(format!(
                "pdftotext exited with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            )),
        };
    }

    ExtractResult {
        text: String::from_utf8_lossy(&output.stdout).into_owned(),
        error: None,
    }
}

// ---- PDF cover extraction ---------------------------------------------------

/// Shape returned to the frontend from `extract_pdf_cover`. The frontend
/// uses `fetched_at` as a cache-buster when swapping covers in place.
#[derive(Debug, Serialize)]
pub struct CoverResult {
    /// When non-empty, absolute path to the written cover PNG (useful
    /// for logging; the frontend loads bytes via `load_course_cover`).
    pub path: String,
    /// Epoch millis at write-time so the frontend can blow past any
    /// previously-cached blob URL / object URL and render fresh.
    pub fetched_at: u64,
    /// Populated on failure — surfaced in the UI.
    pub error: Option<String>,
}

/// Render page 1 of `pdf_path` as a PNG and write it to
/// `<courses_dir>/<course_id>/cover.png`. Overwrites any existing cover
/// at that path (re-running is idempotent / safe to invoke from the
/// "Fetch cover artwork…" button in Course Settings).
///
/// Rendering DPI of 150 gives roughly 900×1350 on a standard 6×9"
/// paperback — plenty for the 180×270 shelf-card display size while
/// keeping the on-disk file under ~200 KB.
///
/// Only page 1 is used. Covers-on-page-2 edge cases (books that start
/// with a blank colophon) can be handled by the user pointing the
/// "Fetch cover artwork…" button at a better PDF.
#[tauri::command]
pub fn extract_pdf_cover(
    app: tauri::AppHandle,
    pdf_path: String,
    course_id: String,
) -> CoverResult {
    let binary = match find_pdftoppm() {
        Some(b) => b,
        None => {
            return CoverResult {
                path: String::new(),
                fetched_at: 0,
                error: Some(
                    "pdftoppm not found — install poppler first (on macOS: `brew install poppler`)."
                        .to_string(),
                ),
            };
        }
    };

    // The course folder must already exist (import pipeline creates it
    // as a side-effect of the first `save_course` call). If it doesn't,
    // create it now so running this command on a pristine install still
    // works (the frontend may not have saved anything yet when we're
    // called via the import-dialog fast path).
    let courses_dir = match crate::courses::courses_dir(&app) {
        Ok(d) => d,
        Err(e) => {
            return CoverResult {
                path: String::new(),
                fetched_at: 0,
                error: Some(format!("courses_dir: {e}")),
            };
        }
    };
    let course_dir = courses_dir.join(&course_id);
    if let Err(e) = std::fs::create_dir_all(&course_dir) {
        return CoverResult {
            path: String::new(),
            fetched_at: 0,
            error: Some(format!("create course dir: {e}")),
        };
    }

    let final_path = course_dir.join("cover.png");

    // pdftoppm writes to `<prefix>-NNN.png`. We give it a temp prefix
    // inside the course dir, then rename the single emitted file to the
    // canonical name.
    let temp_prefix = course_dir.join(".cover-tmp");
    // -f 1 -l 1 = first page only. -r 150 = 150 dpi. -png = PNG output.
    let output = match Command::new(&binary)
        .arg("-f").arg("1")
        .arg("-l").arg("1")
        .arg("-r").arg("150")
        .arg("-png")
        .arg(&pdf_path)
        .arg(&temp_prefix)
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            return CoverResult {
                path: String::new(),
                fetched_at: 0,
                error: Some(format!("failed to launch {binary}: {e}")),
            };
        }
    };
    if !output.status.success() {
        return CoverResult {
            path: String::new(),
            fetched_at: 0,
            error: Some(format!(
                "pdftoppm exited with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            )),
        };
    }

    // pdftoppm's output filename: `<prefix>-<page>.png`. For page 1 with
    // no zero-padding it's `<prefix>-1.png`. Recent poppler versions
    // default to zero-padding to the length of the max-page number —
    // since we render only page 1 that's still `-1.png`, but we glob
    // defensively just in case.
    let rendered = match std::fs::read_dir(&course_dir)
        .ok()
        .and_then(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .find(|p| {
                    p.file_name()
                        .and_then(|s| s.to_str())
                        .map(|n| n.starts_with(".cover-tmp-") && n.ends_with(".png"))
                        .unwrap_or(false)
                })
        }) {
        Some(p) => p,
        None => {
            return CoverResult {
                path: String::new(),
                fetched_at: 0,
                error: Some("pdftoppm produced no output file".to_string()),
            };
        }
    };

    if let Err(e) = std::fs::rename(&rendered, &final_path) {
        return CoverResult {
            path: String::new(),
            fetched_at: 0,
            error: Some(format!("rename cover: {e}")),
        };
    }

    // pdftoppm at 150 dpi on a 2:3 book-cover page produces ~1200x1800
    // PNGs (~3 MB). Downsample to the UI's max render size so the on-
    // disk footprint and the base64 IPC payload both stay small.
    downsample_cover_in_place(&final_path);

    // Stamp coverFetchedAt into course.json if it exists. This is what
    // makes the field consistent on-disk — meaning when the course is
    // later exported as a .fishbones, the JSON INSIDE the archive
    // already carries the marker, and a fresh import on another
    // machine sees it without needing the source PDF available.
    //
    // If course.json doesn't exist yet (the AI-ingest path calls this
    // command before the first save_course lands), the helper skips —
    // the pipeline's next save will write course.json fresh WITHOUT
    // the marker, but that's fine because the cover.png file itself
    // is the source of truth; `load_course_cover` always probes the
    // filesystem rather than trusting the JSON field.
    let fetched_at = stamp_cover_fetched_at(&course_dir);
    CoverResult {
        path: final_path.to_string_lossy().into_owned(),
        fetched_at,
        error: None,
    }
}

/// Format-agnostic entry point for the importer. Dispatches on the
/// file extension so the frontend doesn't need to know whether a
/// given book is PDF or EPUB — it just calls `extract_source_text`
/// and gets back the same `ExtractResult` shape either way.
#[tauri::command]
pub fn extract_source_text(path: String) -> ExtractResult {
    if crate::epub_ingest::is_epub_path(&path) {
        return crate::epub_ingest::extract_epub_text_impl(&path);
    }
    extract_pdf_text(path)
}

/// Max cover dimensions written to disk. The library shelf renders at
/// ~170-260px wide, sidebar carousel at 74px — so 512×768 covers 2x
/// retina with headroom. Shrinks an older 1024×1536 PNG (~3.5 MB) to
/// roughly 700 KB with no visible quality loss at render size, and
/// cuts the base64 payload `load_course_cover` ships over IPC ~5x.
const COVER_MAX_WIDTH: u32 = 512;
const COVER_MAX_HEIGHT: u32 = 768;

/// Decode the PNG at `path`, downsample to fit within COVER_MAX_WIDTH ×
/// COVER_MAX_HEIGHT (aspect-ratio preserved), and re-encode in place.
/// Idempotent: if the source is already within bounds, does nothing so
/// repeated calls don't re-compress. Logs failures as warnings and
/// leaves the original file — a too-big cover is a quality-of-life
/// regression, not a correctness bug.
pub fn downsample_cover_in_place(path: &std::path::Path) {
    let reader = match image::ImageReader::open(path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[cover] skip downsample for {path:?}: open failed: {e}");
            return;
        }
    };
    let reader = match reader.with_guessed_format() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[cover] skip downsample for {path:?}: probe failed: {e}");
            return;
        }
    };
    let img = match reader.decode() {
        Ok(i) => i,
        Err(e) => {
            eprintln!("[cover] skip downsample for {path:?}: decode failed: {e}");
            return;
        }
    };
    if img.width() <= COVER_MAX_WIDTH && img.height() <= COVER_MAX_HEIGHT {
        return;
    }
    let resized = img.resize(
        COVER_MAX_WIDTH,
        COVER_MAX_HEIGHT,
        image::imageops::FilterType::Lanczos3,
    );
    if let Err(e) = resized.save_with_format(path, image::ImageFormat::Png) {
        eprintln!("[cover] failed to write downsampled cover {path:?}: {e}");
    }
}

/// Write `coverFetchedAt` into `<course_dir>/course.json` if that file
/// exists. Returns the epoch-millis stamp it recorded (or 0 on clock
/// failure). Shared by every cover-writing command so the on-disk
/// marker stays consistent regardless of how the cover arrived (PDF
/// render, EPUB manifest, AI generation, user import).
pub fn stamp_cover_fetched_at(course_dir: &std::path::Path) -> u64 {
    let fetched_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let course_json_path = course_dir.join("course.json");
    if course_json_path.exists() {
        if let Ok(bytes) = std::fs::read(&course_json_path) {
            if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(obj) = value.as_object_mut() {
                    obj.insert(
                        "coverFetchedAt".to_string(),
                        serde_json::Value::from(fetched_at),
                    );
                    if let Ok(next) = serde_json::to_vec_pretty(&value) {
                        let _ = std::fs::write(&course_json_path, next);
                    }
                }
            }
        }
    }
    fetched_at
}

/// User-supplied image → course cover. Accepts PNG/JPEG/WebP/GIF (the
/// `image` crate features we compiled in), decodes, re-encodes as PNG,
/// and writes to `<courses_dir>/<course_id>/cover.png`. Returns the
/// same `CoverResult` shape as `extract_pdf_cover` so the frontend
/// handler is uniform across every cover source.
#[tauri::command]
pub fn import_course_cover(
    app: tauri::AppHandle,
    image_path: String,
    course_id: String,
) -> CoverResult {
    let courses_dir = match crate::courses::courses_dir(&app) {
        Ok(d) => d,
        Err(e) => {
            return CoverResult {
                path: String::new(),
                fetched_at: 0,
                error: Some(format!("courses_dir: {e}")),
            };
        }
    };
    let course_dir = courses_dir.join(&course_id);
    if let Err(e) = std::fs::create_dir_all(&course_dir) {
        return CoverResult {
            path: String::new(),
            fetched_at: 0,
            error: Some(format!("create course dir: {e}")),
        };
    }

    let img = match image::ImageReader::open(&image_path) {
        Ok(r) => match r.with_guessed_format() {
            Ok(r) => match r.decode() {
                Ok(img) => img,
                Err(e) => {
                    return CoverResult {
                        path: String::new(),
                        fetched_at: 0,
                        error: Some(format!(
                            "decode image: {e}. Supported formats: PNG, JPEG, WebP, GIF.",
                        )),
                    };
                }
            },
            Err(e) => {
                return CoverResult {
                    path: String::new(),
                    fetched_at: 0,
                    error: Some(format!("probe image format: {e}")),
                };
            }
        },
        Err(e) => {
            return CoverResult {
                path: String::new(),
                fetched_at: 0,
                error: Some(format!("open image: {e}")),
            };
        }
    };

    let final_path = course_dir.join("cover.png");
    // Shrink to the UI's max render size before encoding — a user's
    // 4000×6000 screenshot drop would otherwise cost megabytes on
    // disk and pay a 4x base64 tax on every `load_course_cover` IPC.
    let sized = if img.width() > COVER_MAX_WIDTH || img.height() > COVER_MAX_HEIGHT {
        img.resize(
            COVER_MAX_WIDTH,
            COVER_MAX_HEIGHT,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };
    if let Err(e) = sized.save_with_format(&final_path, image::ImageFormat::Png) {
        return CoverResult {
            path: String::new(),
            fetched_at: 0,
            error: Some(format!("write cover.png: {e}")),
        };
    }

    let fetched_at = stamp_cover_fetched_at(&course_dir);
    CoverResult {
        path: final_path.to_string_lossy().into_owned(),
        fetched_at,
        error: None,
    }
}

/// Sibling of `extract_source_text` for cover extraction. EPUBs carry
/// their cover in the manifest so we skip the poppler shell-out
/// entirely; PDFs keep going through pdftoppm.
#[tauri::command]
pub fn extract_source_cover(
    app: tauri::AppHandle,
    source_path: String,
    course_id: String,
) -> CoverResult {
    if crate::epub_ingest::is_epub_path(&source_path) {
        return crate::epub_ingest::extract_epub_cover_impl(&app, &source_path, &course_id);
    }
    extract_pdf_cover(app, source_path, course_id)
}

/// Read the cover PNG for a course (if one exists) and return it as a
/// base64 data URL that the frontend can drop straight into `<img src>`.
/// Returns `None` when no cover is present — callers render their
/// fallback tile in that case.
#[tauri::command]
pub fn load_course_cover(
    app: tauri::AppHandle,
    course_id: String,
) -> Result<Option<String>, String> {
    let courses_dir = crate::courses::courses_dir(&app).map_err(|e| e.to_string())?;
    let cover_path = courses_dir.join(&course_id).join("cover.png");
    if !cover_path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&cover_path).map_err(|e| format!("read cover: {e}"))?;
    // `base64` crate uses the `Engine` API in 0.22+. Use the standard
    // config (with padding, alphabet = a-zA-Z0-9+/).
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:image/png;base64,{b64}")))
}
