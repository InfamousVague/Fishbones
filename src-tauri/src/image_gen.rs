//! AI cover-art generation.
//!
//! Calls OpenAI's `gpt-image-1` with a fixed style prompt so every
//! book in the library ends up with a consistent visual language.
//! Writes the result to `<courses_dir>/<course_id>/cover.png` and
//! stamps `coverFetchedAt` into course.json — same shape / contract
//! as `ingest::extract_pdf_cover` so the frontend handler is
//! interchangeable between "fetch from source PDF" and "generate
//! fresh with AI".
//!
//! Why OpenAI specifically: Anthropic (our text provider) doesn't
//! offer image gen, so we need a second provider. `gpt-image-1` is
//! the highest-quality option for brand-style consistency when
//! holding the prompt fixed, and it supports 2:3 portrait natively
//! (`1024x1536`). Cost is ~$0.04 per cover at standard quality —
//! a full library of 50 books = $2.

use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::settings::SettingsState;

const OPENAI_IMAGE_API: &str = "https://api.openai.com/v1/images/generations";
const OPENAI_MODEL: &str = "gpt-image-1";
/// 2:3 portrait, native book-cover aspect. 1024×1536 is the largest
/// portrait gpt-image-1 exposes — plenty for the ~200×300 shelf-card
/// display we render into.
const IMAGE_SIZE: &str = "1024x1536";

/// Style prompt — identical for every generation so the library feels
/// like a cohesive shelf. Hard-coded inside the binary (not
/// configurable from the frontend) so one user's tweak doesn't drift
/// against another's. The only per-book substitutions are title and
/// language, appended below.
const STYLE_PROMPT: &str = "Minimalist editorial book cover art. Abstract geometric composition with a single bold focal shape and a warm, muted gradient background layered with one cool accent. Evocative of the book's topic without being literal or photorealistic. Absolutely NO text, NO letterforms, NO typography, NO words anywhere in the image. High contrast composition suitable for a tall vertical 2:3 book cover. Digital illustration, editorial design language — think New York Review of Books meets Bauhaus poster, clean lines, confident negative space.";

/// Payload the frontend hands us. `title` + `language` shape the
/// per-book half of the prompt; `course_id` anchors the output file.
#[derive(Debug, Deserialize)]
pub struct CoverGenParams {
    pub course_id: String,
    pub title: String,
    pub author: Option<String>,
    pub language: String,
}

/// Same shape as `ingest::CoverResult` on purpose — frontend handlers
/// for "fetch from PDF" and "generate with AI" are interchangeable.
#[derive(Debug, Serialize)]
pub struct CoverGenResult {
    pub path: String,
    pub fetched_at: u64,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
struct OpenAiRequest<'a> {
    model: &'a str,
    prompt: String,
    n: u32,
    size: &'a str,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    data: Vec<OpenAiImage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiImage {
    b64_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiError {
    error: OpenAiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorDetail {
    message: String,
}

/// Entry point. Generates cover art and writes it to the course dir.
/// Returns `CoverGenResult` in all cases — errors land inside
/// `result.error` so the frontend renders them the same way the
/// PDF-based cover flow does.
#[tauri::command]
pub async fn generate_cover_art(
    app: tauri::AppHandle,
    settings: tauri::State<'_, SettingsState>,
    params: CoverGenParams,
) -> Result<CoverGenResult, String> {
    let api_key = {
        let s = settings.0.lock();
        s.openai_api_key.clone()
    };
    let Some(api_key) = api_key.filter(|k| !k.trim().is_empty()) else {
        return Ok(CoverGenResult {
            path: String::new(),
            fetched_at: 0,
            error: Some(
                "No OpenAI API key set. Add one in Settings → AI to enable AI cover generation."
                    .to_string(),
            ),
        });
    };

    // Resolve the destination course dir. Mirrors the PDF cover path
    // in `ingest::extract_pdf_cover` — same `<courses_dir>/<id>/cover.png`
    // sink so every cover-producer writes to the same spot.
    let courses_dir = crate::courses::courses_dir(&app).map_err(|e| e.to_string())?;
    let course_dir: PathBuf = courses_dir.join(&params.course_id);
    std::fs::create_dir_all(&course_dir)
        .map_err(|e| format!("create course dir: {e}"))?;
    let final_path = course_dir.join("cover.png");

    // Build the prompt. STYLE_PROMPT is fixed — only the book-specific
    // tail changes per call. Keep it terse so gpt-image-1 leans on the
    // visual description rather than trying to spell the title.
    let author_bit = match &params.author {
        Some(a) if !a.trim().is_empty() => format!(" by {a}"),
        _ => String::new(),
    };
    let full_prompt = format!(
        "{STYLE_PROMPT}\n\nTopic: \"{title}\"{author} — a book about {language} programming.",
        title = params.title,
        author = author_bit,
        language = params.language,
    );

    // 60s timeout — gpt-image-1 typically finishes in 5–15s but we've
    // seen spikes during load; we'd rather surface a slow-api error than
    // hang the UI indefinitely.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let body = OpenAiRequest {
        model: OPENAI_MODEL,
        prompt: full_prompt,
        n: 1,
        size: IMAGE_SIZE,
    };

    let resp = client
        .post(OPENAI_IMAGE_API)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("openai request failed: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("openai read body: {e}"))?;

    if !status.is_success() {
        // OpenAI's error body is `{"error":{"message":"..."}}` — try to
        // surface the message string directly so rate-limit and
        // billing errors don't hide behind a status code.
        let msg = serde_json::from_str::<OpenAiError>(&text)
            .map(|e| e.error.message)
            .unwrap_or_else(|_| text.clone());
        return Ok(CoverGenResult {
            path: String::new(),
            fetched_at: 0,
            error: Some(format!("OpenAI {}: {}", status.as_u16(), msg)),
        });
    }

    let parsed: OpenAiResponse = serde_json::from_str(&text)
        .map_err(|e| format!("openai response parse: {e}"))?;

    let Some(b64) = parsed.data.into_iter().find_map(|img| img.b64_json) else {
        return Ok(CoverGenResult {
            path: String::new(),
            fetched_at: 0,
            error: Some("OpenAI returned no image data".to_string()),
        });
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 decode: {e}"))?;

    std::fs::write(&final_path, &bytes).map_err(|e| format!("write cover: {e}"))?;

    // OpenAI returns 1024×1536 PNGs (~3.5 MB). The UI renders at 170-
    // 260px wide; keeping the native size burns disk and ~5x base64
    // payload on every `load_course_cover` IPC. Downsample in place.
    crate::ingest::downsample_cover_in_place(&final_path);

    let fetched_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // Stamp coverFetchedAt into course.json if present. Same behaviour
    // as `extract_pdf_cover` so the field reaches disk consistently and
    // exported `.fishbones` archives carry the marker.
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

    Ok(CoverGenResult {
        path: final_path.to_string_lossy().into_owned(),
        fetched_at,
        error: None,
    })
}
