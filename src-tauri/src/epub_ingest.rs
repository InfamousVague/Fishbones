//! EPUB ingest — mirrors the PDF helpers in `ingest.rs` so both book
//! formats funnel into the same downstream splitter.
//!
//! The EPUB path is simpler than PDF because we already have per-
//! chapter XHTML documents (spine items). We walk the spine, flatten
//! each XHTML to plain text, and emit a single string where each
//! spine item is prefixed with `\f` (form-feed) + a synthetic
//! `"Chapter N. <title>"` header. That way `splitChapters()` in
//! `pdfParser.ts` — which recognises `\fChapter N. ...` — works
//! unchanged. No second TS parser, no on-disk divergence between a
//! book that came in as PDF vs EPUB.
//!
//! For covers: EPUBs store the cover as a manifest item flagged with
//! `properties="cover-image"` or an old-style `<meta name="cover"
//! content="id"/>`. The `epub` crate's `get_cover()` tries both.
//! We write the raw bytes to `cover.png` (the browser sniffs the
//! format regardless of the extension) to keep the rest of the app's
//! cover plumbing unchanged.

use std::path::Path;

use epub::doc::EpubDoc;
use scraper::{Html, Selector};

use crate::ingest::{CoverResult, ExtractResult};

/// Extract the full text of an EPUB into one string the PDF chapter
/// splitter can consume. Returns an ExtractResult so the frontend's
/// error path is identical to the PDF one — no conditional UI.
pub fn extract_epub_text_impl(path: &str) -> ExtractResult {
    let mut doc = match EpubDoc::new(path) {
        Ok(d) => d,
        Err(e) => {
            return ExtractResult {
                text: String::new(),
                error: Some(format!("open epub {path}: {e}")),
            };
        }
    };

    // `EpubDoc` starts on the first spine item. We iterate explicitly
    // rather than relying on `go_next` so we can emit sensible
    // Chapter-N labels even when a book's own XHTML headings are
    // missing or structured oddly. `get_current_str()` returns
    // (body, mime) — we only care about the body.
    let mut out = String::new();
    let mut chapter_index = 0usize;
    let total = doc.get_num_chapters();

    for idx in 0..total {
        if !doc.set_current_chapter(idx) {
            // Spine item we couldn't navigate to. Skip rather than
            // bail — the book may still have mostly-readable content.
            continue;
        }
        let (body, _mime) = match doc.get_current_str() {
            Some(tuple) => tuple,
            None => continue,
        };
        let (heading, prose) = flatten_xhtml(&body);
        // Skip "cover page" / "copyright" spine items that produce
        // effectively no prose — they just add noise to the LLM's
        // input. A 40-char floor lets a one-sentence dedication
        // through but drops a bare title page.
        if prose.trim().len() < 40 {
            continue;
        }
        chapter_index += 1;
        // Prepend the synthetic marker that `splitChapters()` already
        // knows how to parse (pattern A: `\fChapter N. Title`).
        // We use the extracted heading when present, falling back to
        // the book's declared title for that spine item, and finally
        // a bare "Section N" so we never emit a malformed header.
        let resolved_title = heading
            .map(|h| h.trim().to_string())
            .filter(|h| !h.is_empty())
            .unwrap_or_else(|| format!("Section {chapter_index}"));
        // `\x0c` is the form-feed (U+000C) byte pdftotext emits at
        // page boundaries — the downstream splitter keys on it.
        out.push_str(&format!(
            "\x0cChapter {chapter_index}. {resolved_title}\n"
        ));
        out.push_str(prose.trim_end());
        out.push_str("\n\n");
    }

    if out.is_empty() {
        return ExtractResult {
            text: String::new(),
            error: Some(
                "epub parsed but produced no readable prose — spine items were empty or too short"
                    .to_string(),
            ),
        };
    }

    ExtractResult {
        text: out,
        error: None,
    }
}

/// Pull the cover image out of the EPUB manifest and write it to
/// `<course_dir>/cover.png`. Mirrors the PDF path's side-effects so
/// the rest of the app doesn't need to know a book came in as EPUB.
///
/// EPUB covers can be JPEG, PNG, or GIF; we write the raw bytes
/// under `cover.png` because the frontend loads them as a blob and
/// the browser sniffs the real format. If we ever need strict
/// extension honesty we can branch on the returned mime.
pub fn extract_epub_cover_impl(
    app: &tauri::AppHandle,
    epub_path: &str,
    course_id: &str,
) -> CoverResult {
    let courses_dir = match crate::courses::courses_dir(app) {
        Ok(d) => d,
        Err(e) => {
            return CoverResult {
                path: String::new(),
                fetched_at: 0,
                error: Some(format!("courses_dir: {e}")),
            };
        }
    };
    let course_dir = courses_dir.join(course_id);
    if let Err(e) = std::fs::create_dir_all(&course_dir) {
        return CoverResult {
            path: String::new(),
            fetched_at: 0,
            error: Some(format!("create course dir: {e}")),
        };
    }

    let mut doc = match EpubDoc::new(epub_path) {
        Ok(d) => d,
        Err(e) => {
            return CoverResult {
                path: String::new(),
                fetched_at: 0,
                error: Some(format!("open epub: {e}")),
            };
        }
    };

    let (bytes, _mime) = match doc.get_cover() {
        Some(t) => t,
        None => {
            return CoverResult {
                path: String::new(),
                fetched_at: 0,
                error: Some("no cover image in epub manifest".to_string()),
            };
        }
    };

    let final_path = course_dir.join("cover.png");
    if let Err(e) = std::fs::write(&final_path, &bytes) {
        return CoverResult {
            path: String::new(),
            fetched_at: 0,
            error: Some(format!("write cover: {e}")),
        };
    }

    // EPUB covers come through at the publisher's source resolution —
    // often 1600×2400+ and multi-megabyte. Downsample to the UI's max
    // render size in place so we don't bloat disk + the IPC payload.
    crate::ingest::downsample_cover_in_place(&final_path);

    let fetched_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // Stamp coverFetchedAt into course.json if it exists, matching
    // the PDF cover path. Best-effort — a failure here still leaves
    // the on-disk cover.png as the source of truth.
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

    CoverResult {
        path: final_path.to_string_lossy().into_owned(),
        fetched_at,
        error: None,
    }
}

/// Return `(best-guess chapter heading, prose text)` for one spine
/// item's XHTML. The heading is the text of the first `<h1>`, falling
/// back to the first `<h2>` / `<h3>` / `<title>`. Prose is every text
/// node in document order, separated by single spaces within a block
/// and double newlines between block-level elements.
fn flatten_xhtml(xhtml: &str) -> (Option<String>, String) {
    let doc = Html::parse_document(xhtml);

    // Heading priority: h1 > h2 > h3 > title.
    let heading = ["h1", "h2", "h3", "title"]
        .iter()
        .find_map(|tag| first_text(&doc, tag));

    // Block-level tags we treat as paragraph breaks — everything else
    // concatenates inline. This roughly matches what pdftotext -layout
    // produces for a page: natural paragraph breaks, no excessive
    // inline whitespace.
    //
    // `pre` stays intact (code blocks); `li` gets a leading `• ` so
    // bullet lists survive the flatten without turning into a wall
    // of joined sentences.
    let block_selectors = [
        "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "div",
    ];

    let mut out = String::with_capacity(xhtml.len() / 2);
    for sel_str in block_selectors {
        let sel = match Selector::parse(sel_str) {
            Ok(s) => s,
            Err(_) => continue,
        };
        for el in doc.select(&sel) {
            let text = el
                .text()
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string();
            if text.is_empty() {
                continue;
            }
            let prefix = if sel_str == "li" { "• " } else { "" };
            out.push_str(prefix);
            out.push_str(&text);
            out.push('\n');
            out.push('\n');
        }
    }

    (heading, out)
}

fn first_text(doc: &Html, tag: &str) -> Option<String> {
    let sel = Selector::parse(tag).ok()?;
    let el = doc.select(&sel).next()?;
    let text = el
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Cheap extension sniff for the dispatch layer in `ingest.rs`.
/// Returns true when the path ends in a case-insensitive `.epub`.
pub fn is_epub_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("epub"))
        .unwrap_or(false)
}
