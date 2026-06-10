/// Floating Docs window — the booklet surface routed by main.tsx
/// when the URL carries `?docs=1` (opened via lib/docsPopout.ts).
///
/// Layout: curated booklet sidebar on the left (one entry per
/// language, hand-picked pages into that language's OFFICIAL docs),
/// article pane on the right. Pages are fetched through the
/// `fetch_doc_page` Tauri command (main-content extraction +
/// html2md, the same pipeline the docs-import crawler uses) and
/// rendered with the app's lesson markdown renderer — so MDN / the
/// Rust Book / docs.python.org read in Libre's own theme, Shiki
/// highlighting included, instead of as an embedded foreign site.
///
/// In-content links whose host is in the booklet's allow-list
/// navigate INSIDE this window (fetched + re-rendered, with
/// back/forward history); everything else opens in the system
/// browser. Browser builds (no Tauri) render a static layout
/// preview instead of fetching.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@base/primitives/icon";
import { arrowLeft } from "@base/primitives/icon/icons/arrow-left";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import { externalLink } from "@base/primitives/icon/icons/external-link";
import { bookOpen } from "@base/primitives/icon/icons/book-open";
import "@base/primitives/icon/icon.css";
import {
  DOCS_BOOKLETS,
  bookletById,
  type DocsBooklet,
} from "../../data/docsBooklets";
import { DOCS_NAV_CHANNEL } from "../../lib/docsPopout";
import { renderMarkdown } from "../Lesson/markdown";
import { openExternal } from "../../lib/openExternal";
import { SkeletonText } from "../Shared/Skeleton";
import { useT } from "../../i18n/i18n";
import "../Lesson/LessonReader.css";
import "./DocsPopoutView.css";

interface DocPage {
  url: string;
  title: string;
  markdown: string;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/// Browser-build stand-in so the window still shows a coherent
/// layout preview when there's no Rust side to fetch through.
const WEB_DEMO_MD = [
  "# Docs preview",
  "",
  "The floating docs window fetches official documentation (MDN, the Rust Book, docs.python.org, …) through the desktop app's extraction pipeline and re-renders it here in Libre's own theme.",
  "",
  "> This is a browser build — fetching external docs needs the desktop app, so you're looking at a layout preview.",
  "",
  "```js",
  'const docs = "official references, in Libre\'s own theme";',
  "console.log(docs);",
  "```",
].join("\n");

function stripFragment(url: string): string {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}

export default function DocsPopoutView() {
  const t = useT();
  const [booklet, setBooklet] = useState<DocsBooklet>(() => {
    const params = new URLSearchParams(window.location.search);
    return bookletById(params.get("booklet")) ?? DOCS_BOOKLETS[0];
  });
  const [page, setPage] = useState<DocPage | null>(null);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // History lives in refs (no render dependency beyond the
  // back/forward disabled states, tracked by navTick).
  const historyRef = useRef<string[]>([]);
  const idxRef = useRef(-1);
  const [, setNavTick] = useState(0);
  const articleRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bookletRef = useRef(booklet);
  bookletRef.current = booklet;

  const loadPage = useCallback(async (url: string, push = true) => {
    setLoading(true);
    setError(null);
    try {
      const doc: DocPage = isTauri()
        ? await invoke<DocPage>("fetch_doc_page", { url })
        : { url, title: "Docs preview", markdown: WEB_DEMO_MD };
      const rendered = await renderMarkdown(doc.markdown);
      setPage(doc);
      setHtml(rendered);
      if (push) {
        const next = historyRef.current.slice(0, idxRef.current + 1);
        next.push(stripFragment(url));
        historyRef.current = next;
        idxRef.current = next.length - 1;
      }
      setNavTick((n) => n + 1);
      scrollRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Booklet switch (initial mount included): open its first page and
  // reset history — the booklet is a fresh reading context.
  useEffect(() => {
    historyRef.current = [];
    idxRef.current = -1;
    const first = booklet.pages[0];
    if (first) void loadPage(first.url);
    document.title = `Libre · Docs — ${booklet.label}`;
  }, [booklet, loadPage]);

  // The opener re-targets an already-open window via BroadcastChannel
  // instead of spawning a duplicate.
  useEffect(() => {
    const ch = new BroadcastChannel(DOCS_NAV_CHANNEL);
    ch.onmessage = (e: MessageEvent<{ bookletId?: string }>) => {
      const next = bookletById(e.data?.bookletId ?? null);
      if (next && next.id !== bookletRef.current.id) setBooklet(next);
    };
    return () => ch.close();
  }, []);

  // Imperative innerHTML — same pattern as LessonReader (a fresh
  // dangerouslySetInnerHTML object every render would rebuild the
  // article's children on every state tick).
  useLayoutEffect(() => {
    const el = articleRef.current;
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }, [html]);

  const back = () => {
    if (idxRef.current <= 0) return;
    idxRef.current -= 1;
    void loadPage(historyRef.current[idxRef.current], false);
  };
  const forward = () => {
    if (idxRef.current >= historyRef.current.length - 1) return;
    idxRef.current += 1;
    void loadPage(historyRef.current[idxRef.current], false);
  };

  /// Route clicks on rendered-content links: allow-listed hosts stay
  /// in-window, fragments scroll, everything else opens externally.
  const onArticleClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    if (href.startsWith("#")) {
      const target = articleRef.current?.querySelector(
        `[id="${CSS.escape(href.slice(1))}"]`,
      );
      target?.scrollIntoView({ block: "start" });
      return;
    }
    let abs: URL;
    try {
      abs = new URL(href, page?.url ?? undefined);
    } catch {
      return;
    }
    if (booklet.allowHosts.includes(abs.host)) {
      void loadPage(abs.toString());
    } else {
      void openExternal(abs.toString());
    }
  };

  const currentUrl = page ? stripFragment(page.url) : null;

  return (
    <div className="libre-docs-popout">
      <header className="libre-docs-popout__bar">
        <button
          type="button"
          className="libre-docs-popout__nav-btn"
          onClick={back}
          disabled={idxRef.current <= 0}
          aria-label={t("docsViewer.back")}
          title={t("docsViewer.back")}
        >
          <Icon icon={arrowLeft} size="xs" color="currentColor" />
        </button>
        <button
          type="button"
          className="libre-docs-popout__nav-btn"
          onClick={forward}
          disabled={idxRef.current >= historyRef.current.length - 1}
          aria-label={t("docsViewer.forward")}
          title={t("docsViewer.forward")}
        >
          <Icon icon={arrowRight} size="xs" color="currentColor" />
        </button>
        <div className="libre-docs-popout__bar-title">
          {page?.title ?? t("docsViewer.title")}
        </div>
        {page && (
          <button
            type="button"
            className="libre-docs-popout__nav-btn"
            onClick={() => void openExternal(page.url)}
            aria-label={t("docsViewer.openInBrowser")}
            title={t("docsViewer.openInBrowser")}
          >
            <Icon icon={externalLink} size="xs" color="currentColor" />
          </button>
        )}
      </header>

      <div className="libre-docs-popout__body">
        <aside className="libre-docs-popout__side">
          <label className="libre-docs-popout__booklet">
            <span className="libre-docs-popout__booklet-icon" aria-hidden>
              <Icon icon={bookOpen} size="xs" color="currentColor" />
            </span>
            <select
              value={booklet.id}
              onChange={(e) => {
                const next = bookletById(e.target.value);
                if (next) setBooklet(next);
              }}
              aria-label={t("docsViewer.booklet")}
            >
              {DOCS_BOOKLETS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <nav className="libre-docs-popout__toc" aria-label={t("docsViewer.pages")}>
            {booklet.pages.map((p) => (
              <button
                key={p.url}
                type="button"
                className={
                  "libre-docs-popout__toc-item" +
                  (currentUrl === stripFragment(p.url)
                    ? " libre-docs-popout__toc-item--active"
                    : "")
                }
                onClick={() => void loadPage(p.url)}
              >
                {p.title}
              </button>
            ))}
          </nav>
        </aside>

        <div className="libre-docs-popout__content" ref={scrollRef}>
          {loading && (
            <div className="libre-docs-popout__skeleton">
              <SkeletonText lines={9} />
            </div>
          )}
          {error && !loading && (
            <div className="libre-docs-popout__error" role="alert">
              <p>{t("docsViewer.error")}</p>
              <code>{error}</code>
              <div className="libre-docs-popout__error-actions">
                <button
                  type="button"
                  onClick={() => page && void loadPage(page.url, false)}
                >
                  {t("docsViewer.retry")}
                </button>
              </div>
            </div>
          )}
          <article
            ref={articleRef}
            className="libre-reader-body libre-docs-popout__article"
            style={loading || error ? { display: "none" } : undefined}
            onClick={onArticleClick}
          />
        </div>
      </div>
    </div>
  );
}
