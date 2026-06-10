/// Curated registry for the floating Docs window.
///
/// Each booklet is a hand-picked table of contents into a language's
/// OFFICIAL public documentation (MDN, doc.rust-lang.org,
/// docs.python.org, …). Pages are fetched on demand through the
/// `fetch_doc_page` Tauri command (the same main-content-extraction +
/// html2md pipeline the docs-import crawler uses) and rendered with
/// the app's own lesson renderer — so the official docs read in
/// Libre's theme instead of an embedded foreign website.
///
/// `allowHosts` governs in-content link navigation: links whose host
/// is listed open inside the docs window (fetched + re-rendered);
/// anything else opens in the system browser. This is the only
/// "allowlist" in the feature — the Rust command itself is generic,
/// the curation lives here.

export interface DocsPage {
  title: string;
  url: string;
}

export interface DocsBooklet {
  id: string;
  /// Sidebar label, e.g. "JavaScript · MDN".
  label: string;
  /// Lesson `language` ids that map to this booklet (used to
  /// pre-select the right booklet when opened from a lesson).
  languages: string[];
  /// Hosts whose links stay inside the docs window.
  allowHosts: string[];
  pages: DocsPage[];
}

export const DOCS_BOOKLETS: DocsBooklet[] = [
  {
    id: "javascript",
    label: "JavaScript · MDN",
    languages: ["javascript", "js", "node", "web"],
    allowHosts: ["developer.mozilla.org"],
    pages: [
      { title: "Introduction", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction" },
      { title: "Grammar and types", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types" },
      { title: "Control flow & error handling", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Control_flow_and_error_handling" },
      { title: "Loops and iteration", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Loops_and_iteration" },
      { title: "Functions", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Functions" },
      { title: "Working with objects", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Working_with_objects" },
      { title: "Indexed collections (arrays)", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Indexed_collections" },
      { title: "Using classes", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_classes" },
      { title: "Using promises", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises" },
      { title: "Modules", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules" },
      { title: "Reference: Array", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array" },
      { title: "Reference: String", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String" },
      { title: "Reference: Object", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object" },
      { title: "Reference: Promise", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise" },
      { title: "Reference: Map", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map" },
      { title: "Reference: JSON", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON" },
    ],
  },
  {
    id: "typescript",
    label: "TypeScript · Handbook",
    languages: ["typescript", "ts"],
    allowHosts: ["www.typescriptlang.org"],
    pages: [
      { title: "The Basics", url: "https://www.typescriptlang.org/docs/handbook/2/basic-types.html" },
      { title: "Everyday Types", url: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html" },
      { title: "Narrowing", url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html" },
      { title: "More on Functions", url: "https://www.typescriptlang.org/docs/handbook/2/functions.html" },
      { title: "Object Types", url: "https://www.typescriptlang.org/docs/handbook/2/objects.html" },
      { title: "Generics", url: "https://www.typescriptlang.org/docs/handbook/2/generics.html" },
      { title: "Keyof / Typeof operators", url: "https://www.typescriptlang.org/docs/handbook/2/keyof-types.html" },
      { title: "Classes", url: "https://www.typescriptlang.org/docs/handbook/2/classes.html" },
      { title: "Modules", url: "https://www.typescriptlang.org/docs/handbook/2/modules.html" },
      { title: "Utility Types", url: "https://www.typescriptlang.org/docs/handbook/utility-types.html" },
    ],
  },
  {
    id: "python",
    label: "Python · docs.python.org",
    languages: ["python", "py"],
    allowHosts: ["docs.python.org"],
    pages: [
      { title: "An Informal Introduction", url: "https://docs.python.org/3/tutorial/introduction.html" },
      { title: "Control Flow Tools", url: "https://docs.python.org/3/tutorial/controlflow.html" },
      { title: "Data Structures", url: "https://docs.python.org/3/tutorial/datastructures.html" },
      { title: "Modules", url: "https://docs.python.org/3/tutorial/modules.html" },
      { title: "Input and Output", url: "https://docs.python.org/3/tutorial/inputoutput.html" },
      { title: "Errors and Exceptions", url: "https://docs.python.org/3/tutorial/errors.html" },
      { title: "Classes", url: "https://docs.python.org/3/tutorial/classes.html" },
      { title: "Standard Library Tour", url: "https://docs.python.org/3/tutorial/stdlib.html" },
      { title: "Built-in Functions", url: "https://docs.python.org/3/library/functions.html" },
    ],
  },
  {
    id: "rust",
    label: "Rust · The Book",
    languages: ["rust", "rs"],
    allowHosts: ["doc.rust-lang.org"],
    pages: [
      { title: "Variables and Mutability", url: "https://doc.rust-lang.org/book/ch03-01-variables-and-mutability.html" },
      { title: "Data Types", url: "https://doc.rust-lang.org/book/ch03-02-data-types.html" },
      { title: "Functions", url: "https://doc.rust-lang.org/book/ch03-03-how-functions-work.html" },
      { title: "Control Flow", url: "https://doc.rust-lang.org/book/ch03-05-control-flow.html" },
      { title: "What Is Ownership?", url: "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html" },
      { title: "References and Borrowing", url: "https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html" },
      { title: "Defining Structs", url: "https://doc.rust-lang.org/book/ch05-01-defining-structs.html" },
      { title: "Defining Enums", url: "https://doc.rust-lang.org/book/ch06-01-defining-an-enum.html" },
      { title: "Vectors", url: "https://doc.rust-lang.org/book/ch08-01-vectors.html" },
      { title: "Recoverable Errors with Result", url: "https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html" },
      { title: "Generic Data Types", url: "https://doc.rust-lang.org/book/ch10-01-syntax.html" },
      { title: "Traits", url: "https://doc.rust-lang.org/book/ch10-02-traits.html" },
    ],
  },
  {
    id: "go",
    label: "Go · go.dev",
    languages: ["go", "golang"],
    allowHosts: ["go.dev"],
    pages: [
      { title: "Getting started", url: "https://go.dev/doc/tutorial/getting-started" },
      { title: "Create a module", url: "https://go.dev/doc/tutorial/create-module" },
      { title: "Error handling", url: "https://go.dev/doc/tutorial/handle-errors" },
      { title: "Effective Go", url: "https://go.dev/doc/effective_go" },
    ],
  },
  {
    id: "web",
    label: "HTML & CSS · MDN",
    languages: ["html", "css", "svelte", "react", "reactnative"],
    allowHosts: ["developer.mozilla.org"],
    pages: [
      { title: "HTML basics", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Your_first_website/Creating_the_content" },
      { title: "CSS basics", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Your_first_website/Styling_the_content" },
      { title: "CSS: Flexbox", url: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout/Basic_concepts_of_flexbox" },
      { title: "CSS: Grid", url: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Basic_concepts_of_grid_layout" },
      { title: "Reference: CSS selectors", url: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_selectors" },
    ],
  },
];

/// Resolve which booklet a lesson language should open. Falls back to
/// JavaScript (the app's lingua franca) when nothing matches.
export function bookletForLanguage(language?: string): DocsBooklet {
  const lang = (language ?? "").toLowerCase();
  return (
    DOCS_BOOKLETS.find((b) => b.languages.includes(lang)) ?? DOCS_BOOKLETS[0]
  );
}

export function bookletById(id: string | null): DocsBooklet | null {
  if (!id) return null;
  return DOCS_BOOKLETS.find((b) => b.id === id) ?? null;
}
