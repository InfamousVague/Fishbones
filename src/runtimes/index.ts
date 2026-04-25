import type { LanguageId, WorkbenchAsset, WorkbenchFile } from "../data/types";
import { assembleRunnable } from "../lib/workbenchFiles";
import { runJavaScript, runTypeScript } from "./javascript";
import { runPython } from "./python";
import { runRust } from "./rust";
import { runSwift } from "./swift";
import { runGo } from "./go";
import { runWeb, isWebLesson } from "./web";
import { runReact } from "./react";
import { runReactNative } from "./reactnative";
import {
  runAssembly,
  runC,
  runCpp,
  runCSharp,
  runJava,
  runKotlin,
} from "./nativeRunners";
import type { RunResult } from "./types";

export type { RunResult, LogLine, TestResult } from "./types";
export { isPassing } from "./types";

/// Dispatch to the right in-browser runtime for a language.
/// `testCode` is optional; when provided, the runtime runs it against the
/// user's module.exports and reports per-test pass/fail results.
export async function runCode(
  language: LanguageId,
  code: string,
  testCode?: string,
): Promise<RunResult> {
  switch (language) {
    case "javascript":
      return runJavaScript(code, testCode);
    case "typescript":
      return runTypeScript(code, testCode);
    case "python":
      return runPython(code, testCode);
    case "rust":
      return runRust(code, testCode);
    case "swift":
      return runSwift(code, testCode);
    case "go":
      return runGo(code, testCode);
    case "c":
      return runC(code, testCode);
    case "cpp":
      return runCpp(code, testCode);
    case "java":
      return runJava(code, testCode);
    case "kotlin":
      return runKotlin(code, testCode);
    case "csharp":
      return runCSharp(code, testCode);
    case "assembly":
      return runAssembly(code, testCode);
    case "web":
    case "threejs":
    case "react":
    case "reactnative":
      // These are multi-file meta-languages — a single concatenated
      // string can't meaningfully run them. Callers must reach us via
      // `runFiles`, which preserves file structure. Returning an
      // explanatory error keeps the RunResult contract intact instead
      // of throwing.
      return {
        logs: [],
        error:
          `Language "${language}" is multi-file only — call runFiles(files, assets) instead of runCode.`,
        durationMs: 0,
      };
    default:
      // Exhaustiveness guard. If a new LanguageId slips in without
      // wiring a runtime (or a lesson's serialized JSON contains a
      // non-LanguageId string like a FileLanguage value leaking
      // through), return an explanatory RunResult rather than an
      // implicit `undefined` that crashes `isPassing` downstream.
      return {
        logs: [],
        error: `No runtime registered for language "${language as string}".`,
        durationMs: 0,
      };
  }
}

/// Multi-file variant used by the workbench UI. Picks the web runtime when
/// the file set includes HTML or CSS (regardless of primary language),
/// otherwise falls through to the single-language runner after assembling
/// the runnable files into one source string. `assets` are injected into
/// the iframe only on the web runtime path — other runtimes ignore them.
export async function runFiles(
  language: LanguageId,
  files: WorkbenchFile[],
  testCode?: string,
  assets?: WorkbenchAsset[],
): Promise<RunResult> {
  // React Native always takes its own preview path — the `isWebLesson`
  // heuristic below (.html/.css file check) would otherwise steal it.
  if (language === "reactnative") {
    return runReactNative(files);
  }
  // Plain React (web) is also a dedicated runtime: we ship our own
  // HTML host with React + ReactDOM bundled, so isWebLesson would
  // otherwise hijack it on the basis of a sibling .css file in the
  // file set.
  if (language === "react") {
    return runReact(files);
  }
  // Auto-route: the LLM sometimes tags a React Native lesson's
  // `language` as "javascript" / "typescript" because JSX transpiles
  // to JS. When that happens, sending the code to `runJavaScript`
  // ends with a `new AsyncFunction(...)` parse failure in the worker
  // ("AsyncFunction@[native code]") — useless error from the
  // learner's POV. Detect RN-looking source up front and flip the
  // dispatch so the runtime actually matches the content.
  if (
    (language === "javascript" || language === "typescript") &&
    looksLikeReactNative(files)
  ) {
    return runReactNative(files);
  }
  if (
    isWebLesson(files) ||
    language === "web" ||
    language === "threejs"
  ) {
    return runWeb(files, testCode, assets);
  }
  const code = assembleRunnable(files, language);
  return runCode(language, code, testCode);
}

/// Heuristic for "this file set is actually React Native, not plain JS".
/// Returns true when any file either imports from `react-native` /
/// `react-native-web` or contains what looks like a native JSX tag
/// (`<View`, `<Text`, `<Pressable`, etc.). Intentionally false-negative
/// friendly (a plain-JS file with the substring "react-native" in a
/// string literal won't trip it — we require the `from 'react-native'`
/// shape).
function looksLikeReactNative(files: WorkbenchFile[]): boolean {
  const RN_IMPORT = /\bfrom\s+["']react-native(?:-web)?["']/;
  const RN_TAGS =
    /<\s*(View|Text|Pressable|TouchableOpacity|ScrollView|FlatList|SectionList|SafeAreaView|TextInput|Image|ImageBackground|Button|Modal|ActivityIndicator)\b/;
  for (const f of files) {
    if (!f.content) continue;
    if (RN_IMPORT.test(f.content) || RN_TAGS.test(f.content)) return true;
  }
  return false;
}
