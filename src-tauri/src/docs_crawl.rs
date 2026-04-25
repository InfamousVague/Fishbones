//! Documentation-site crawler.
//!
//! Given a start URL like `https://reactnative.dev/docs/getting-started`,
//! crawl every page under the same origin + path prefix, extract each
//! page's main content, convert to markdown, and hand the result back to
//! the frontend which feeds it to the LLM pipeline to generate lessons.
//!
//! Design choices:
//!   - Plain HTML only. No headless browser. Most modern doc generators
//!     (Docusaurus, Nextra, Sphinx, VitePress with SSR) emit enough
//!     content in the raw HTML response for us to work with. Sites that
//!     hide everything behind client-side JS fall back to the manual
//!     "import a .fishbones archive" path.
//!   - Same-origin + same-path-prefix crawl scope. Prefix is auto-
//!     detected from the start URL up to the last "/segment" (so
//!     `https://site.com/docs/a/b` → prefix `https://site.com/docs/`).
//!   - Rate-limited (configurable delay between requests, default 250ms)
//!     to be polite to the hosting server.
//!   - Images get downloaded inline to the course's ingest cache so the
//!     resulting `.fishbones` archive is self-contained.
//!
//! The actual LLM work happens downstream in the frontend pipeline:
//! `crawl_docs_site` just returns the extracted markdown + metadata.

use std::collections::{HashSet, VecDeque};
use std::time::{Duration, Instant};

use base64::Engine;
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use url::Url;

/// Configuration for a crawl run. The frontend assembles this from the
/// DocsImportDialog inputs and hands it to `crawl_docs_site`.
#[derive(Debug, Deserialize)]
pub struct CrawlConfig {
    /// The starting URL. Also anchors the path-prefix filter — only URLs
    /// that start with this URL's "directory" (everything up to and
    /// including the last `/`) will be crawled.
    pub start_url: String,
    /// Hard upper bound on the number of pages fetched. Protects against
    /// accidentally starting a crawl on a 10 000-page reference site.
    pub max_pages: u32,
    /// Max link-follow depth from the start URL. 0 = only the start
    /// page. Default from frontend is 3, enough for most doc trees.
    /// Ignored when `nav_tree` is provided — the nav tree's own shape
    /// drives the order.
    pub max_depth: u32,
    /// Millisecond delay between HTTP requests. Rate-limits the crawler
    /// so we don't hammer the server. 250 is a reasonable default; bump
    /// to 1000+ for sites with strict rate limits.
    pub request_delay_ms: u64,
    /// If true, download each image referenced in the extracted content
    /// and inline it as a `data:image/...;base64,...` URL in the
    /// markdown. Makes the resulting course self-contained (ships in
    /// the `.fishbones` archive without external fetches) at the cost
    /// of extra network + a larger course JSON. Skipped images keep
    /// their original remote URLs.
    pub download_images: bool,
    /// Course id — reserved for future features (per-book image cache
    /// dir, re-sync dedup, etc.). Not used by the current crawler but
    /// required from the caller so adding those features later doesn't
    /// force a Tauri-command signature change.
    pub book_id: String,
    /// Pre-extracted navigation tree. When present, the crawler visits
    /// pages in the order the tree presents them and stamps each page
    /// with its chapter label (the category it sits under in the nav).
    /// When None, falls back to BFS + URL-path grouping — the same
    /// behaviour as before sidebar-aware crawling landed.
    pub nav_tree: Option<NavTree>,
}

/// Documentation site's sidebar nav as a flat-able tree. Extracted from
/// the start page's DOM — doc generators like Docusaurus, MkDocs,
/// Sphinx, Nextra, VitePress all emit a curated `<ul>/<li>` structure
/// that captures the site author's intended learning path. We mirror
/// that structure here and let the crawler walk it in order instead of
/// blindly BFS-ing.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct NavTree {
    pub children: Vec<NavNode>,
}

/// One node in the sidebar. Categories have children + optionally a
/// URL (Docusaurus "category index pages"); leaf pages have a URL + no
/// children. A node with neither is dropped during parsing.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NavNode {
    pub title: String,
    pub url: Option<String>,
    pub children: Vec<NavNode>,
}

/// One crawled page ready for the LLM pipeline. All URLs are absolute
/// at this point — the crawler rewrites relative links during extraction.
#[derive(Debug, Serialize)]
pub struct CrawledPage {
    /// The URL we fetched. Used later as a stable lesson identifier.
    pub url: String,
    /// Best-effort page title — falls back to URL path if none found.
    pub title: String,
    /// Main-content markdown, code-block fences preserved. Feed this
    /// straight to `generate_lesson_from_docs_page`.
    pub markdown: String,
    /// Number of ``` code blocks detected in the markdown. Drives the
    /// heuristic: code-heavy pages get exercises, text-heavy pages get
    /// quizzes, pure-reference pages stay reading-only.
    pub code_block_count: u32,
    /// Chapter title — the nav category this page sits under. Populated
    /// when the crawl was driven by a NavTree; `None` when we fell back
    /// to BFS + URL-path grouping. Drives chaptering in the frontend
    /// pipeline when present, otherwise the frontend derives chapters
    /// from URL segments as before.
    pub chapter: Option<String>,
    /// Position within the chapter (0-indexed). Used to order lessons
    /// inside a chapter in nav-driven mode. Meaningless when `chapter`
    /// is None.
    pub chapter_position: u32,
    /// Depth from the start URL (0 = start page, 1 = linked from start,
    /// etc.). Used for logging + the path-based chapter grouping.
    pub depth: u32,
    /// Count of inlined (base64-embedded) images in the markdown. Used
    /// by the frontend's stats panel to report "N pages, M images
    /// inlined" during the crawl phase.
    pub inlined_images: u32,
}

/// Full crawl result handed back to the frontend. Error is set when the
/// crawl fails entirely (e.g. start URL unreachable) — per-page failures
/// are logged and skipped rather than bubbled up here.
#[derive(Debug, Serialize)]
pub struct CrawlResult {
    pub pages: Vec<CrawledPage>,
    /// Diagnostic line per skipped page (404s, parse failures, etc.) —
    /// lets the UI surface a "we skipped N pages" note without flooding.
    pub skipped: Vec<String>,
    pub error: Option<String>,
}

/// Main CSS selectors we try in order to find the "real content" of a
/// doc page. Most modern static generators drop content into one of
/// these wrappers; we fall back to `<body>` minus nav/footer when none
/// match, which is imperfect but better than giving up.
const CONTENT_SELECTORS: &[&str] = &[
    "main article",
    "article",
    "main",
    "[role=\"main\"]",
    ".main-content",
    ".markdown",
    ".docMainContainer",
    ".theme-doc-markdown",
    ".content",
    "#content",
    ".post-content",
];

/// Noise selectors stripped from any extracted content region. These
/// are navigation widgets, edit-on-github buttons, table-of-contents
/// sidebars that happen to be inside `<main>`, etc. Removing them
/// before HTML→markdown conversion keeps the LLM from hallucinating
/// lesson content from chrome.
const NOISE_SELECTORS: &[&str] = &[
    "nav",
    "header",
    "footer",
    "aside",
    ".navbar",
    ".sidebar",
    ".toc",
    ".table-of-contents",
    ".edit-page",
    ".edit-link",
    ".pagination-nav",
    ".theme-doc-toc-mobile",
    ".theme-doc-toc-desktop",
    ".theme-doc-breadcrumbs",
    ".theme-last-updated",
    "[aria-label=\"Main\"] + *",
    "script",
    "style",
    "noscript",
];

/// CSS selectors we try (in order) to find the site's primary sidebar
/// navigation. First one that matches and yields a non-empty tree wins.
/// Covers the major doc generators:
///
///   - Docusaurus 2/3: `nav[aria-label="Docs sidebar"]` + `.theme-doc-sidebar-menu`
///   - Nextra:          `aside nav` (page-local) — usually holds the tree
///   - MkDocs Material: `.md-nav--primary` on mobile, `.md-sidebar__inner .md-nav` on desktop
///   - Sphinx:          `.sphinxsidebar` / `.bd-sidenav` (pydata theme)
///   - VitePress:       `.VPSidebar` / `.sidebar`
///   - Generic:         `nav.sidebar`, aria-label fallback
const SIDEBAR_SELECTORS: &[&str] = &[
    "nav[aria-label=\"Docs sidebar\"]",
    ".theme-doc-sidebar-menu",
    "aside.theme-doc-sidebar-container nav",
    "nav.md-nav--primary",
    ".md-sidebar__inner .md-nav",
    ".sphinxsidebar",
    ".bd-sidenav",
    ".VPSidebar",
    ".VPSidebarItem",
    "aside nav ul",
    "nav.sidebar",
    "nav.sidebar-nav",
    "nav[aria-label=\"Main navigation\"]",
    "aside[role=\"navigation\"]",
];

/// Entry point: crawl a doc site and return extracted pages.
///
/// Uses the async `reqwest::Client` so HTTP work doesn't block the
/// tokio runtime. `scraper`'s `Html` is !Send, so we scope all DOM
/// parsing to synchronous blocks between `.await` points — that's why
/// `fetch_and_extract` awaits `.text()` first, THEN does all parsing
/// before returning.
#[tauri::command]
pub async fn crawl_docs_site(
    _app: tauri::AppHandle,
    config: CrawlConfig,
) -> Result<CrawlResult, String> {
    // Parse + validate the start URL up front so bad input fails fast
    // before we spin up an HTTP client.
    let start = Url::parse(&config.start_url)
        .map_err(|e| format!("invalid start URL: {e}"))?;
    if !matches!(start.scheme(), "http" | "https") {
        return Err("start URL must be http:// or https://".to_string());
    }
    let Some(_host) = start.host_str() else {
        return Err("start URL has no host".to_string());
    };
    // Touch the book_id so rustc doesn't warn — kept in the config
    // because the frontend pre-allocates it and we'll use it once we
    // add a per-book image cache / resync dedup in a later phase.
    let _book_id = &config.book_id;

    // Auto-detect the path prefix from the start URL. Everything up to
    // and including the last `/` in the path is the crawl "root" —
    // only URLs that start with this prefix will be followed.
    // Example: `/docs/getting-started` → prefix `/docs/`.
    let path_prefix = {
        let path = start.path();
        match path.rfind('/') {
            Some(i) => path[..=i].to_string(),
            None => "/".to_string(),
        }
    };

    // Dedicated client so we can set a friendly User-Agent (some sites
    // 403 requests with no UA) and a reasonable per-request timeout.
    let client = reqwest::Client::builder()
        .user_agent("Fishbones/0.1 (learning-app; +https://fishbones.app)")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("couldn't build HTTP client: {e}"))?;

    // NAV-DRIVEN CRAWL — when the frontend handed us a sidebar tree, use
    // it as the crawl plan. Pages visit in nav order, chapter markers
    // come from the top-level category labels. Branches early because
    // none of the BFS state below (queue/visited) is needed.
    if let Some(ref nav) = config.nav_tree {
        let plan = flatten_nav(nav);
        if !plan.is_empty() {
            return crawl_from_plan(&client, &plan, &config).await;
        }
        // Empty tree → fall through to BFS. The frontend can also force
        // BFS by passing None.
    }

    // BFS queue. Set of visited URLs dedupes — we normalize fragments
    // off (#section-anchors aren't new pages) before inserting.
    let mut queue: VecDeque<(Url, u32)> = VecDeque::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut pages: Vec<CrawledPage> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    queue.push_back((start.clone(), 0));
    visited.insert(strip_fragment(&start));

    while let Some((url, depth)) = queue.pop_front() {
        if pages.len() as u32 >= config.max_pages {
            break;
        }

        // Rate limit everything after the first request. Async sleep so
        // the tokio runtime stays free to service other Tauri commands
        // (e.g. a user clicking Cancel) while we wait.
        if !pages.is_empty() {
            tokio::time::sleep(Duration::from_millis(config.request_delay_ms)).await;
        }

        match fetch_and_extract(&client, &url).await {
            Ok(extracted) => {
                // Harvest same-prefix links before we move extracted.
                if depth < config.max_depth {
                    for link in &extracted.links {
                        let norm = strip_fragment(link);
                        if visited.contains(&norm) {
                            continue;
                        }
                        if !same_crawl_scope(link, &start, &path_prefix) {
                            continue;
                        }
                        visited.insert(norm);
                        queue.push_back((link.clone(), depth + 1));
                    }
                }

                // Embed images as base64 data URLs directly in the
                // markdown. Keeps the course self-contained — no
                // secondary asset-loading plumbing needed, and the
                // `.fishbones` archive is portable by default.
                let mut inlined = 0u32;
                let mut markdown = extracted.markdown;
                if config.download_images {
                    for (remote, _alt) in &extracted.images {
                        match download_image_as_data_url(&client, remote).await {
                            Ok(data_url) => {
                                // html2md uses the original absolute URL
                                // in its `![alt](url)` output — a
                                // straight replace swaps every
                                // occurrence in one shot.
                                markdown = markdown.replace(remote.as_str(), &data_url);
                                inlined += 1;
                            }
                            Err(e) => {
                                skipped.push(format!("image {remote}: {e}"));
                            }
                        }
                    }
                }

                let code_block_count = count_fenced_code_blocks(&markdown);

                pages.push(CrawledPage {
                    url: url.to_string(),
                    title: extracted.title,
                    markdown,
                    code_block_count,
                    chapter: None,
                    chapter_position: 0,
                    depth,
                    inlined_images: inlined,
                });
            }
            Err(e) => {
                skipped.push(format!("{}: {}", url, e));
            }
        }
    }

    Ok(CrawlResult {
        pages,
        skipped,
        error: None,
    })
}

/// Output of the per-page extraction step. Collected into a CrawledPage
/// after the caller layers on image downloading + code-block counting.
struct Extracted {
    title: String,
    markdown: String,
    links: Vec<Url>,
    /// (absolute URL, alt text). Referenced by the crawler to download
    /// and rewrite the markdown if `download_images` is on.
    images: Vec<(Url, String)>,
}

/// Fetch one page, run the main-content selector cascade, convert the
/// winning region to markdown, and return the extracted data.
///
/// The HTML parsing pass (title, main-content selectors, link/image
/// harvest, html2md conversion) all happens in a single synchronous
/// block AFTER the last `.await`. That's deliberate: `scraper::Html` is
/// `!Send`, so it must never cross an await point.
async fn fetch_and_extract(
    client: &reqwest::Client,
    url: &Url,
) -> Result<Extracted, String> {
    let resp = client
        .get(url.as_str())
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    // Skip non-HTML responses BEFORE reading the body — saves bandwidth
    // on PDF and other binary links.
    let ct_is_html = {
        let header = resp
            .headers()
            .get("content-type")
            .and_then(|v: &reqwest::header::HeaderValue| v.to_str().ok())
            .map(|s| s.to_lowercase());
        match header {
            None => true, // missing content-type — assume HTML and try
            Some(ct) => ct.contains("html"),
        }
    };
    if !ct_is_html {
        return Err("skipping non-HTML content-type".to_string());
    }

    let body = resp.text().await.map_err(|e| format!("read body: {e}"))?;

    // Parse synchronously — Html is !Send so this block cannot await.
    Ok(parse_page(&body, url))
}

/// Pure-sync parser: hand it the HTML + the page's URL, get back the
/// extracted title, markdown, links, and images. Kept separate from
/// `fetch_and_extract` so the `scraper::Html` locals stay scoped to a
/// non-async function where the `!Send` constraint is irrelevant.
fn parse_page(body: &str, url: &Url) -> Extracted {
    let doc = Html::parse_document(body);

    // Title: prefer the <title> tag; fall back to the first <h1>.
    let title = {
        let title_sel = Selector::parse("title").unwrap();
        let h1_sel = Selector::parse("h1").unwrap();
        doc.select(&title_sel)
            .next()
            .map(|t| t.text().collect::<String>().trim().to_string())
            .or_else(|| {
                doc.select(&h1_sel)
                    .next()
                    .map(|t| t.text().collect::<String>().trim().to_string())
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| url.path().trim_matches('/').to_string())
    };

    // Try each content selector in order. First hit wins. If we hit
    // nothing, fall back to the body (stripped of obvious chrome).
    let main_html = find_main_content(body);

    // Collect links + images from the extracted HTML so the crawler
    // can enqueue + download them respectively.
    let inner_doc = Html::parse_fragment(&main_html);
    let link_sel = Selector::parse("a[href]").unwrap();
    let img_sel = Selector::parse("img[src]").unwrap();

    let mut links: Vec<Url> = Vec::new();
    for a in inner_doc.select(&link_sel) {
        if let Some(href) = a.value().attr("href") {
            if let Ok(abs) = url.join(href) {
                if matches!(abs.scheme(), "http" | "https") {
                    links.push(abs);
                }
            }
        }
    }

    let mut images: Vec<(Url, String)> = Vec::new();
    for img in inner_doc.select(&img_sel) {
        if let Some(src) = img.value().attr("src") {
            if let Ok(abs) = url.join(src) {
                if matches!(abs.scheme(), "http" | "https") {
                    let alt = img.value().attr("alt").unwrap_or("").to_string();
                    images.push((abs, alt));
                }
            }
        }
    }

    // html2md gives us passable markdown. It's not perfect — code-block
    // language hints sometimes get lost — but it handles headings,
    // lists, links, and code fences reliably. We post-process below.
    let md = html2md::parse_html(&main_html);
    let md = tidy_markdown(&md);

    Extracted {
        title,
        markdown: md,
        links,
        images,
    }
}

/// Walk the content-selector cascade and return the HTML of the first
/// matching element, with noise-selector children removed. Returns the
/// full body (sans noise) as a last resort.
fn find_main_content(html: &str) -> String {
    let doc = Html::parse_document(html);

    for selector in CONTENT_SELECTORS {
        let Ok(sel) = Selector::parse(selector) else {
            continue;
        };
        if let Some(el) = doc.select(&sel).next() {
            return strip_noise(&el.html());
        }
    }

    // No explicit main-content region found. Return the body tag — the
    // noise stripping below removes obvious chrome so it's still usable.
    let body_sel = Selector::parse("body").unwrap();
    if let Some(body) = doc.select(&body_sel).next() {
        return strip_noise(&body.html());
    }
    strip_noise(html)
}

/// Remove known-noisy DOM regions (nav bars, TOC sidebars, scripts, etc.)
/// from an HTML fragment. `scraper` doesn't have an in-place tree mutate
/// API — we clone the fragment and scan its text for elements to drop,
/// then serialize the survivors. Good enough for static doc sites.
fn strip_noise(html: &str) -> String {
    let doc = Html::parse_fragment(html);
    // Build a set of the noise elements' ranges in the original source,
    // then emit everything BUT those ranges. This preserves formatting
    // inside the kept regions (whitespace, etc.) that a full DOM rebuild
    // via serializer would flatten.
    let mut drop_ranges: Vec<(usize, usize)> = Vec::new();
    for selector in NOISE_SELECTORS {
        let Ok(sel) = Selector::parse(selector) else {
            continue;
        };
        for el in doc.select(&sel) {
            // ElementRef gives us the starting byte offset via its DOM
            // position — but scraper doesn't expose offsets directly.
            // Fallback: rebuild by replacing the element's outer HTML
            // with empty string in the source text. Not efficient for
            // many noise matches but fine for typical doc pages (<50
            // noise elements).
            let outer = el.html();
            if !outer.is_empty() {
                if let Some(start) = html.find(&outer) {
                    drop_ranges.push((start, start + outer.len()));
                }
            }
        }
    }
    if drop_ranges.is_empty() {
        return html.to_string();
    }
    // Merge overlapping ranges, then rebuild by concatenating surviving
    // regions.
    drop_ranges.sort();
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(drop_ranges.len());
    for r in drop_ranges {
        if let Some(last) = merged.last_mut() {
            if r.0 <= last.1 {
                last.1 = last.1.max(r.1);
                continue;
            }
        }
        merged.push(r);
    }
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    for (s, e) in merged {
        if s > cursor {
            out.push_str(&html[cursor..s]);
        }
        cursor = e;
    }
    if cursor < html.len() {
        out.push_str(&html[cursor..]);
    }
    out
}

/// Second-pass cleanup on the markdown emitted by html2md. We collapse
/// runs of blank lines (html2md sometimes emits 4+ in a row), trim
/// trailing whitespace, and drop the occasional leading `[![alt](url)]`
/// anchor-wrapped-image pattern that html2md renders awkwardly.
fn tidy_markdown(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut blank_run = 0;
    for line in md.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            blank_run += 1;
            if blank_run <= 2 {
                out.push('\n');
            }
        } else {
            blank_run = 0;
            out.push_str(line);
            out.push('\n');
        }
    }
    out.trim().to_string() + "\n"
}

/// Count fenced code blocks (opening ```) in markdown. Used downstream
/// to decide whether a lesson should get an exercise (≥2 blocks) or a
/// quiz (0–1 blocks).
fn count_fenced_code_blocks(md: &str) -> u32 {
    let mut count = 0;
    let mut in_block = false;
    for line in md.lines() {
        if line.trim_start().starts_with("```") {
            if !in_block {
                count += 1;
            }
            in_block = !in_block;
        }
    }
    count
}

/// Returns true if `u` is in the crawl scope: same scheme + host as
/// `start`, and its path starts with `path_prefix`.
fn same_crawl_scope(u: &Url, start: &Url, path_prefix: &str) -> bool {
    if u.scheme() != start.scheme() {
        return false;
    }
    if u.host_str() != start.host_str() {
        return false;
    }
    u.path().starts_with(path_prefix)
}

/// Strip any `#fragment` from a URL and return it as a string. Two URLs
/// that differ only in fragment are the same page for our purposes.
fn strip_fragment(u: &Url) -> String {
    let mut clone = u.clone();
    clone.set_fragment(None);
    clone.to_string()
}

/// Best-effort MIME guess for a downloaded image. Prefers the response
/// Content-Type header when set; falls back to the URL extension; last
/// resort is image/png so browsers at least attempt to render.
fn guess_mime(url: &Url, content_type: Option<&str>) -> &'static str {
    if let Some(ct) = content_type {
        let ct = ct.to_lowercase();
        // Strip `; charset=...` etc.
        let ct = ct.split(';').next().unwrap_or("").trim().to_string();
        let known = [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/svg+xml",
            "image/avif",
            "image/bmp",
        ];
        for k in known {
            if ct == k {
                return k;
            }
        }
    }
    let path = url.path().to_lowercase();
    if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".gif") {
        "image/gif"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "image/png"
    }
}

/// Download an image and return it as a `data:image/...;base64,...`
/// URL ready to paste into markdown. Returns early on non-2xx or
/// network errors so the crawler can log + skip the image without
/// failing the page.
async fn download_image_as_data_url(
    client: &reqwest::Client,
    url: &Url,
) -> Result<String, String> {
    let start = Instant::now();
    let resp = client
        .get(url.as_str())
        .send()
        .await
        .map_err(|e| format!("fetch: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v: &reqwest::header::HeaderValue| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp.bytes().await.map_err(|e| format!("read: {e}"))?;
    // Cap per-image at 5 MB — doc-site diagrams are rarely larger, and
    // a bigger file inlined as base64 would bloat every lesson that
    // references it.
    if bytes.len() > 5 * 1024 * 1024 {
        return Err("image too large (>5 MB)".to_string());
    }
    let mime = guess_mime(url, content_type.as_deref());
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    if start.elapsed() > Duration::from_secs(10) {
        eprintln!(
            "[docs_crawl] slow image download: {} ({}ms)",
            url,
            start.elapsed().as_millis()
        );
    }
    Ok(format!("data:{};base64,{}", mime, b64))
}

// ---------------------------------------------------------------------------
// Nav-tree extraction + nav-driven crawl
// ---------------------------------------------------------------------------

/// Entry in the flat crawl plan built from a NavTree. Ordered by nav
/// position; chapter carries the top-level category label so the
/// frontend can build Fishbones chapters directly from it.
struct PlanItem {
    url: Url,
    chapter: String,
    chapter_position: u32,
}

/// Walk a NavTree depth-first and produce a flat crawl plan. Top-level
/// nodes become chapters:
///   - If the top-level node has children, its title is the chapter
///     name and its descendants (+ its own URL if present, as lesson 0)
///     are the chapter's pages in DFS order.
///   - If the top-level node is a bare leaf (URL + no children), it
///     still becomes a one-page chapter titled after itself, so the
///     carousel/library don't hide it.
/// Pages without a URL are dropped; pages with URLs that fail to
/// parse are dropped with a warn log.
fn flatten_nav(tree: &NavTree) -> Vec<PlanItem> {
    let mut out: Vec<PlanItem> = Vec::new();
    for top in &tree.children {
        let chapter = top.title.trim().to_string();
        if chapter.is_empty() {
            continue;
        }
        let mut position = 0u32;

        // Category-with-url (Docusaurus category-index pages) become the
        // FIRST lesson in their own chapter. Feels natural in a book —
        // you read the chapter intro, then the subtopics.
        if let Some(ref u) = top.url {
            if let Ok(parsed) = Url::parse(u) {
                out.push(PlanItem {
                    url: parsed,
                    chapter: chapter.clone(),
                    chapter_position: position,
                });
                position += 1;
            }
        }

        // Descendants, DFS. Deeper categories-within-categories flatten
        // into the parent chapter rather than becoming their own — most
        // doc sites only use one level of nesting, and flattening
        // two-levels gives the learner longer chapters (which matches
        // the "book-like" feel the user asked for).
        for child in &top.children {
            walk_child(child, &chapter, &mut position, &mut out);
        }
    }
    out
}

fn walk_child(
    node: &NavNode,
    chapter: &str,
    position: &mut u32,
    out: &mut Vec<PlanItem>,
) {
    if let Some(ref u) = node.url {
        if let Ok(parsed) = Url::parse(u) {
            out.push(PlanItem {
                url: parsed,
                chapter: chapter.to_string(),
                chapter_position: *position,
            });
            *position += 1;
        }
    }
    for c in &node.children {
        walk_child(c, chapter, position, out);
    }
}

/// Fetch + extract every item in the plan, attaching chapter info to
/// each returned CrawledPage. Same rate-limiting + image-inlining
/// behaviour as the BFS path, just a different "what do we fetch next"
/// driver. Stops at `config.max_pages` — the frontend can warn the
/// user if their nav has more pages than the cap.
async fn crawl_from_plan(
    client: &reqwest::Client,
    plan: &[PlanItem],
    config: &CrawlConfig,
) -> Result<CrawlResult, String> {
    let mut pages: Vec<CrawledPage> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();

    for item in plan {
        if pages.len() as u32 >= config.max_pages {
            break;
        }
        let key = strip_fragment(&item.url);
        if visited.contains(&key) {
            continue;
        }
        visited.insert(key);

        if !pages.is_empty() {
            tokio::time::sleep(Duration::from_millis(config.request_delay_ms)).await;
        }

        match fetch_and_extract(client, &item.url).await {
            Ok(extracted) => {
                let mut inlined = 0u32;
                let mut markdown = extracted.markdown;
                if config.download_images {
                    for (remote, _alt) in &extracted.images {
                        match download_image_as_data_url(client, remote).await {
                            Ok(data_url) => {
                                markdown = markdown.replace(remote.as_str(), &data_url);
                                inlined += 1;
                            }
                            Err(e) => {
                                skipped.push(format!("image {remote}: {e}"));
                            }
                        }
                    }
                }
                let code_block_count = count_fenced_code_blocks(&markdown);
                pages.push(CrawledPage {
                    url: item.url.to_string(),
                    title: extracted.title,
                    markdown,
                    code_block_count,
                    chapter: Some(item.chapter.clone()),
                    chapter_position: item.chapter_position,
                    depth: 0,
                    inlined_images: inlined,
                });
            }
            Err(e) => {
                skipped.push(format!("{}: {}", item.url, e));
            }
        }
    }

    Ok(CrawlResult {
        pages,
        skipped,
        error: None,
    })
}

/// Extract the site's sidebar navigation as a tree. The frontend calls
/// this FIRST (before `crawl_docs_site`) so it can:
///   - drive the crawl in the site's own order + chapter structure
///   - show the user a preview / trim dialog before burning LLM tokens
///
/// Returns a NavTree with zero children when no sidebar is detected —
/// the caller can fall back to BFS-style crawling in that case.
#[tauri::command]
pub async fn extract_docs_nav(url: String) -> Result<NavTree, String> {
    let start = Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    if !matches!(start.scheme(), "http" | "https") {
        return Err("URL must be http:// or https://".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Fishbones/0.1 (learning-app; +https://fishbones.app)")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("couldn't build HTTP client: {e}"))?;

    let resp = client
        .get(start.as_str())
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| format!("read body: {e}"))?;

    Ok(parse_nav_tree(&body, &start))
}

/// Synchronous nav-tree parsing. Walks the selector cascade, returns
/// the first non-empty tree. `scraper::Html` is `!Send`, so this stays
/// out of the async function that owns it — same pattern
/// `fetch_and_extract` uses.
fn parse_nav_tree(body: &str, base: &Url) -> NavTree {
    let doc = Html::parse_document(body);
    for selector in SIDEBAR_SELECTORS {
        let Ok(sel) = Selector::parse(selector) else {
            continue;
        };
        for container in doc.select(&sel) {
            // The container might BE the <ul>/<ol>, or might WRAP one
            // (common with Docusaurus's outer <aside>/<nav>). Try the
            // element itself first, then scan its descendants for the
            // deepest list with >= 2 items (heuristic for "this is the
            // actual sidebar tree, not a tab strip").
            let roots = find_list_roots(container);
            for root in roots {
                let children = parse_list(root, base);
                if !children.is_empty() {
                    return NavTree { children };
                }
            }
        }
    }
    NavTree::default()
}

/// Collect candidate list-root elements (<ul>/<ol>) rooted at `container`.
/// If the container itself is a list, it's the only candidate; otherwise
/// we return every descendant <ul>/<ol>, caller picks the first that
/// parses to a non-empty tree.
fn find_list_roots<'a>(container: ElementRef<'a>) -> Vec<ElementRef<'a>> {
    let name = container.value().name();
    if name == "ul" || name == "ol" {
        return vec![container];
    }
    let mut out = Vec::new();
    // scraper's `.select(Selector)` on an ElementRef does document-rooted
    // CSS matching, not subtree-scoped, so we iterate children manually.
    collect_lists(container, &mut out);
    out
}

fn collect_lists<'a>(node: ElementRef<'a>, out: &mut Vec<ElementRef<'a>>) {
    for child in node.children() {
        if let Some(el) = ElementRef::wrap(child) {
            let name = el.value().name();
            if name == "ul" || name == "ol" {
                out.push(el);
            } else {
                collect_lists(el, out);
            }
        }
    }
}

/// Parse a <ul>/<ol> into a list of NavNodes. Skips nodes with no title
/// AND no URL (pure layout wrappers).
fn parse_list(list: ElementRef, base: &Url) -> Vec<NavNode> {
    let mut out = Vec::new();
    for child in list.children() {
        let Some(el) = ElementRef::wrap(child) else {
            continue;
        };
        if el.value().name() != "li" {
            continue;
        }
        if let Some(node) = parse_item(el, base) {
            out.push(node);
        }
    }
    out
}

/// Parse one <li> into a NavNode. Handles the three common shapes:
///   - `<li><a href>Title</a></li>`                     (leaf)
///   - `<li><div|span|label|button>Title</*></li>`      (category, no URL)
///   - `<li><a href>Title</a><ul>...</ul></li>`         (category with URL)
///   - MkDocs: `<li><label>Title</label><nav><ul>...`   (nested nav wrapper)
fn parse_item(li: ElementRef, base: &Url) -> Option<NavNode> {
    let mut title = String::new();
    let mut url: Option<String> = None;
    let mut children: Vec<NavNode> = Vec::new();

    for child in li.children() {
        let Some(el) = ElementRef::wrap(child) else {
            continue;
        };
        match el.value().name() {
            "a" => {
                let t = el.text().collect::<String>().trim().to_string();
                if !t.is_empty() && title.is_empty() {
                    title = t;
                }
                if url.is_none() {
                    if let Some(href) = el.value().attr("href") {
                        // Skip fragment-only links — they're in-page
                        // anchors, not separate doc pages.
                        if !href.starts_with('#') {
                            if let Ok(abs) = base.join(href) {
                                if matches!(abs.scheme(), "http" | "https") {
                                    url = Some(strip_fragment_string(&abs));
                                }
                            }
                        }
                    }
                }
            }
            "div" | "span" | "label" | "p" | "button" | "strong" | "h1" | "h2"
            | "h3" | "h4" => {
                if title.is_empty() {
                    let t = el.text().collect::<String>().trim().to_string();
                    if !t.is_empty() {
                        title = t;
                    }
                }
                // Docusaurus wraps the click target of a category in a
                // <div class="menu__link menu__link--sublist">; the href
                // lives on an <a> inside. Recurse one layer to find it.
                if url.is_none() {
                    if let Some(a) = find_first_anchor(el) {
                        if let Some(href) = a.value().attr("href") {
                            if !href.starts_with('#') {
                                if let Ok(abs) = base.join(href) {
                                    if matches!(abs.scheme(), "http" | "https") {
                                        url = Some(strip_fragment_string(&abs));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "ul" | "ol" => {
                children.extend(parse_list(el, base));
            }
            "nav" => {
                // MkDocs wraps nested lists in <nav>. Recurse.
                for grand in el.children() {
                    if let Some(g) = ElementRef::wrap(grand) {
                        if g.value().name() == "ul" || g.value().name() == "ol" {
                            children.extend(parse_list(g, base));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Dedupe noise: if we ended up with neither a title nor children,
    // drop it. Empty category stubs sometimes show up in client-rendered
    // sidebars where the title is rendered via JS.
    if title.is_empty() && children.is_empty() {
        return None;
    }
    Some(NavNode {
        title,
        url,
        children,
    })
}

fn find_first_anchor<'a>(root: ElementRef<'a>) -> Option<ElementRef<'a>> {
    for child in root.children() {
        if let Some(el) = ElementRef::wrap(child) {
            if el.value().name() == "a" {
                return Some(el);
            }
            if let Some(inner) = find_first_anchor(el) {
                return Some(inner);
            }
        }
    }
    None
}

fn strip_fragment_string(u: &Url) -> String {
    let mut clone = u.clone();
    clone.set_fragment(None);
    clone.to_string()
}
