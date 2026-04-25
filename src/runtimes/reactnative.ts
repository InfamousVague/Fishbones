import { invoke } from "@tauri-apps/api/core";
import type { WorkbenchFile } from "../data/types";
import type { RunResult } from "./types";

/// React Native runtime — assembles an HTML shell that pulls in React,
/// ReactDOM, and react-native-web from esm.sh + @babel/standalone from
/// unpkg, transpiles the learner's JSX in-browser, and mounts the
/// result via `AppRegistry.runApplication`. The rendered page is
/// served from the local Tauri preview server, same as the plain web
/// runtime — the user opens it in a browser and gets DevTools.
///
/// Scope note: this runtime only covers the "render a component in
/// react-native-web" slice of RN. The `open_in_ios_sim` /
/// `probe_expo_server` Tauri commands hanging off OutputPane handle
/// the "see it in a real simulator / Expo Go" story, but those require
/// Xcode + Node tooling on the host.

export async function runReactNative(files: WorkbenchFile[]): Promise<RunResult> {
  const started = Date.now();

  // Pick the primary source. Conventionally the starter template uses
  // `App.js` — but we accept any .js / .jsx file so the learner can
  // rename freely. Falls back to the first file if there's nothing
  // JS-ish (rare; Monaco's save path keeps at least one file present).
  const source =
    files.find((f) => /\.(jsx?|tsx?)$/i.test(f.name))?.content ??
    files[0]?.content ??
    "";

  const html = buildPreviewHtml(source);

  let previewUrl: string | undefined;
  try {
    const handle = await invoke<{ url: string }>("serve_web_preview", {
      html,
    });
    previewUrl = handle.url;
  } catch {
    previewUrl = undefined;
  }

  return {
    logs: [],
    previewUrl,
    previewKind: "reactnative",
    durationMs: Date.now() - started,
  };
}

/// Construct the standalone HTML that hosts the learner's component.
/// Deliberately inlines everything (CDN script tags + user source
/// base64-encoded) so the preview server can serve a single document
/// with no fetches of its own beyond the CDN bundles.
function buildPreviewHtml(userSource: string): string {
  // Base64 the user source so we don't fight escape-in-template-in-
  // template edge cases (backticks, `${}`, nested quotes). Eval-time we
  // decode via atob.
  const sourceB64 =
    typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(userSource)))
      : Buffer.from(userSource, "utf-8").toString("base64");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>Fishbones — React Native preview</title>
  <style>
    html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
      background: #0b0b10;
      color: #f5f5f7;
      -webkit-font-smoothing: antialiased;
    }
    #__fishbones_error {
      position: fixed; inset: 0;
      padding: 24px;
      background: #1a0b0f;
      color: #f3b0b0;
      font: 12px/1.5 "SF Mono", ui-monospace, Menlo, monospace;
      white-space: pre-wrap;
      overflow: auto;
      z-index: 999;
    }
  </style>
  <!-- Classic script: exposes \`Babel\` globally. Version pinned to a
       known-good @babel/standalone release. -->
  <script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js"
          crossorigin="anonymous"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    ${CONSOLE_SHIM}
    import React from "https://esm.sh/react@18.2.0";
    import * as ReactNative from "https://esm.sh/react-native-web@0.19.12?deps=react@18.2.0,react-dom@18.2.0";

    const { AppRegistry } = ReactNative;

    const source = atob("${sourceB64}");

    // Strip ES-module \`import\` statements from the user source. The
    // runtime binds React + react-native-web into scope directly, and
    // leaving \`import { View } from 'react-native'\` in would trip a
    // browser parse error once Babel transforms it to a \`require\`.
    const cleaned = source
      .replace(/^\\s*import\\s[\\s\\S]+?;\\s*$/gm, "")
      .replace(/^\\s*export\\s+default\\s+function/m, "function")
      .replace(/^\\s*export\\s+default\\s+class/m, "class")
      .replace(/^\\s*export\\s+default\\s+/m, "const __appExport = ")
      .replace(/^\\s*export\\s+/gm, "");

    // Three phases, three separate try blocks — so a Babel parse error
    // (user code has bad JS), a new-Function construction error (our
    // injected preamble broke), and a runtime render error (App threw
    // while mounting) each surface with a clear "phase: message"
    // instead of a single try/catch collapsing them into "Unexpected
    // identifier 'code'" with no hint of which layer produced it.
    let transpiled;
    try {
      const out = Babel.transform(cleaned, {
        presets: [["react", { runtime: "classic" }]],
        filename: "App.js",
        // sourceType "script" is deliberate — the transpiled output
        // gets spliced into a \`new Function(body)\` wrapper (script
        // semantics, top-level \`return\` allowed). "module" mode would
        // stamp module semantics onto the output and the appended
        // return below becomes "Return statements are only valid
        // inside functions". Script also skips the automatic
        // "use strict" directive which can clash with the surrounding
        // wrapper.
        sourceType: "script",
      });
      transpiled = out.code;
    } catch (err) {
      showPhaseError("parse", err, cleaned);
      console.error("[babel parse]", err);
      return;
    }

    // Wrap the user's transpiled code in an IIFE. Two reasons:
    //
    // 1. Scope isolation — a stray top-level identifier in user code
    //    stays in the IIFE, doesn't leak.
    //
    // 2. Brace-mismatch containment — if the user / LLM emitted code
    //    with an unbalanced \\\`}\\\` (extra closer, unclosed block), it
    //    would otherwise close our outer \\\`new Function\\\` body early
    //    and our trailing \\\`return\\\` would sit at script top level,
    //    triggering the exact "Return statements are only valid inside
    //    functions" error we kept hitting. The IIFE absorbs those
    //    stray braces so the damage is contained — at worst the IIFE
    //    ends early, the user's App function never gets declared, and
    //    we surface a clean "No component found" from the null return.
    let factory;
    try {
      factory = new Function(
        "React",
        "ReactNative",
        [
          "const { Component, Fragment, StrictMode, useState, useEffect, useMemo, useCallback, useRef, useReducer, useContext, createContext, useLayoutEffect, useTransition, useDeferredValue } = React;",
          "const {",
          "  AppRegistry, View, Text, TextInput, ScrollView, FlatList, SectionList, VirtualizedList,",
          "  Pressable, TouchableOpacity, TouchableWithoutFeedback, TouchableHighlight,",
          "  Button, Switch, Image, ImageBackground, SafeAreaView, ActivityIndicator,",
          "  StyleSheet, Platform, Dimensions, Animated, Easing, Alert, Keyboard, KeyboardAvoidingView, Linking,",
          "  StatusBar, Modal, RefreshControl, PixelRatio, Share, Appearance,",
          "  useColorScheme, useWindowDimensions, processColor,",
          "} = ReactNative;",
          "return (function __fishbonesUserModule() {",
          transpiled,
          "  return typeof App !== 'undefined' ? App : typeof __appExport !== 'undefined' ? __appExport : null;",
          "})();",
        ].join("\\n"),
      );
    } catch (err) {
      // new Function(...) parse failures look like "SyntaxError:
      // Unexpected identifier 'code'" when Babel emitted something
      // valid-in-module-mode but invalid in Function-body mode (a
      // stray top-level await, a bare import-name, etc.). Surface
      // the transpiled body so we can see what actually shipped.
      showPhaseError("compile", err, transpiled || cleaned);
      // Dump the raw inputs to console so the author can paste them
      // back when opening an issue — easier than retyping the lesson.
      console.group("[factory compile] failure");
      console.error(err);
      console.log("cleaned source:", cleaned);
      console.log("transpiled:", transpiled);
      console.groupEnd();
      return;
    }

    try {
      const App = factory(React, ReactNative);
      if (!App) {
        throw new Error(
          "No component found. Declare \`function App() { ... }\` or \`export default function App()\`."
        );
      }
      AppRegistry.registerComponent("FishbonesApp", () => App);
      AppRegistry.runApplication("FishbonesApp", {
        rootTag: document.getElementById("root"),
      });
    } catch (err) {
      showPhaseError("render", err);
      console.error("[render]", err);
    }

    /// Render an error into a full-screen pre overlay. Combines name +
    /// message + stack so WebKit's stack-only default (which looks like
    /// "anonymous@\nmodule code@http://.../:84:26" without any message)
    /// stops being a mystery. Dedupes: calling twice reuses the same
    /// element so the second error doesn't hide the first.
    function showError(err) {
      showPhaseError("", err);
    }

    /// Variant of \`showError\` that labels which pipeline phase failed
    /// (parse / compile / render) and optionally shows a code snippet
    /// near the failure site. \`phase\` can be empty for the post-mount
    /// window.error path.
    function showPhaseError(phase, err, sourceHint) {
      const name = err && err.name ? err.name : "Error";
      const msg = err && err.message ? err.message : String(err);
      const stack = err && err.stack ? err.stack : "(no stack)";
      const label = phase ? "[" + phase + "] " : "";
      let snippet = "";
      if (sourceHint && err && typeof err.loc === "object" && err.loc) {
        // Babel SyntaxErrors carry \`loc: { line, column }\` — show the
        // ±3 line window around that point so the learner can see
        // exactly where the parser choked.
        snippet = buildSnippet(sourceHint, err.loc.line, err.loc.column);
      }
      let pre = document.getElementById("__fishbones_error");
      if (!pre) {
        pre = document.createElement("pre");
        pre.id = "__fishbones_error";
        document.body.appendChild(pre);
      }
      pre.textContent =
        label + name + ": " + msg + "\\n\\n" + stack +
        (snippet ? "\\n\\n---\\n" + snippet : "");
    }

    function buildSnippet(source, line, column) {
      const lines = source.split("\\n");
      const target = Math.max(1, line || 1);
      const start = Math.max(1, target - 3);
      const end = Math.min(lines.length, target + 3);
      const out = [];
      for (let i = start; i <= end; i++) {
        const num = String(i).padStart(4, " ");
        out.push(num + " | " + lines[i - 1]);
        if (i === target && typeof column === "number") {
          out.push("     | " + " ".repeat(Math.max(0, column)) + "^");
        }
      }
      return out.join("\\n");
    }
  </script>
</body>
</html>`;
}

/// Tiny console shim so uncaught errors reach the browser console
/// reliably even when the eval chain swallows them. Mirrors the intent
/// of the web runtime's postMessage shim but skips the cross-origin
/// plumbing — RN previews open in a real browser, so the user reads
/// logs via DevTools rather than the OutputPane.
///
/// ALSO renders the error into the #__fishbones_error overlay (created on
/// demand) so the learner sees WebKit's otherwise-bare stack with an
/// actual name + message attached. Without this, async errors (a
/// useEffect callback throwing, a Promise rejecting) produce only a
/// stack frame like "anonymous@ module code@http://.../:84:26" with
/// no indication of what went wrong.
const CONSOLE_SHIM = `
function __fishbonesShowError(err) {
  var name = err && err.name ? err.name : "Error";
  var msg = err && err.message ? err.message : (typeof err === "string" ? err : String(err));
  var stack = err && err.stack ? err.stack : "(no stack)";
  var pre = document.getElementById("__fishbones_error");
  if (!pre) {
    pre = document.createElement("pre");
    pre.id = "__fishbones_error";
    document.body.appendChild(pre);
  }
  pre.textContent = name + ": " + msg + "\\n\\n" + stack;
}
window.addEventListener("error", (e) => {
  var err = e.error || new Error(e.message || "Script error");
  console.error("[preview error]", e.message, "(" + (e.filename || "?") + ":" + (e.lineno || "?") + ")", err);
  __fishbonesShowError(err);
});
window.addEventListener("unhandledrejection", (e) => {
  var err = e.reason instanceof Error ? e.reason : new Error(e.reason && e.reason.message ? e.reason.message : String(e.reason));
  console.error("[preview rejection]", err);
  __fishbonesShowError(err);
});
`.trim();
