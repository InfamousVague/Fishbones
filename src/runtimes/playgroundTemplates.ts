import type { FileLanguage, LanguageId, WorkbenchFile } from "../data/types";

/// Starter snippets shown when the learner first opens the playground
/// for a given language. Kept short and "it prints Hello, world!" so the
/// first click of Run always produces something, not a compile error.

interface Template {
  /// Default workbench filename — e.g. `main.go`, `user.py`. Matches the
  /// single-file-lesson conventions in `src/lib/workbenchFiles.ts`.
  /// Only used by `templateFiles()` for single-file templates.
  filename: string;
  /// Monaco / syntax-highlight language id. Only used by
  /// `templateFiles()` for single-file templates.
  fileLanguage: FileLanguage;
  /// Starter content. For multi-file templates (`files` is set) this
  /// is used as the LEGACY single-file fallback — new code paths check
  /// `files` first.
  content: string;
  /// When set, `templateFiles()` returns this multi-file array instead
  /// of synthesizing a single file from `filename` + `content`. Used by
  /// the web + three.js templates which need HTML + CSS + JS side-by-
  /// side from the first paint.
  files?: WorkbenchFile[];
}

/// The playground's "Hello, world!" shim for a three-file web project.
/// Buttons click, logs appear — nothing clever, enough to show the
/// learner that Run → DOM + console wiring is live.
const WEB_TEMPLATE_FILES: WorkbenchFile[] = [
  {
    name: "index.html",
    language: "html",
    content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fishbones Playground</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello, world!</h1>
    <button id="greet">Click me</button>
    <p id="out"></p>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
  },
  {
    name: "style.css",
    language: "css",
    content: `:root {
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
}
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #0b0b10;
  color: #e6e6ea;
}
main { text-align: center; }
button {
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid #2a2a33;
  border-radius: 8px;
  background: #16161d;
  color: inherit;
  cursor: pointer;
}
button:hover { background: #1d1d27; }
`,
  },
  {
    name: "script.js",
    language: "javascript",
    content: `const btn = document.getElementById('greet');
const out = document.getElementById('out');
let count = 0;

btn.addEventListener('click', () => {
  count++;
  out.textContent = \`Clicked \${count} time\${count === 1 ? '' : 's'}\`;
  console.log('click', count);
});
`,
  },
];

/// React Native starter — rendered via react-native-web in the local
/// preview server. A single-file component is enough: the runtime
/// weaves in React + ReactNative imports at mount time and looks for
/// a top-level `App` component to register. No Expo boilerplate here —
/// the in-app runtime doesn't need a Metro bundler; the Expo path
/// (iOS sim / QR code) is handled separately as a dev-tool escape
/// hatch for when the user has their own Expo project running.
const REACT_NATIVE_TEMPLATE_FILES: WorkbenchFile[] = [
  {
    name: "App.js",
    language: "javascript",
    content: `import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

// Declare a top-level \`App\` component. The runtime registers it with
// AppRegistry and mounts it into a full-height root element. Write RN
// as you would in a real Expo project — react-native-web translates
// Views to divs, Text to spans, StyleSheet to inline styles, etc.
export default function App() {
  const [count, setCount] = useState(0);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello from React Native</Text>
      <Text style={styles.subtitle}>
        Rendered via react-native-web in the local preview.
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.btn,
          pressed && styles.btnPressed,
        ]}
        onPress={() => setCount((c) => c + 1)}
      >
        <Text style={styles.btnLabel}>
          Tapped {count} {count === 1 ? 'time' : 'times'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0b0b10',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f5f5f7',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#8a8a95',
    marginBottom: 20,
    textAlign: 'center',
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: '#f5f5f7',
  },
  btnPressed: { opacity: 0.7 },
  btnLabel: { fontSize: 14, fontWeight: '600', color: '#0b0b10' },
});
`,
  },
];

/// Three.js starter — importmap points at a CDN build, a rotating cube
/// sits on a transparent canvas so it pops against the Fishbones dark
/// palette. Educational intent: "scene + camera + renderer, add mesh,
/// animate in a requestAnimationFrame loop."
const THREEJS_TEMPLATE_FILES: WorkbenchFile[] = [
  {
    name: "index.html",
    language: "html",
    content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Three.js Playground</title>
  <link rel="stylesheet" href="style.css">
  <!-- ES-module import-map so \`import * as THREE from 'three'\` resolves.
       Pinned to a specific three.js version so the lesson is stable. -->
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
  </script>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script type="module" src="main.js"></script>
</body>
</html>
`,
  },
  {
    name: "style.css",
    language: "css",
    content: `:root { color-scheme: dark; }
html, body { margin: 0; height: 100%; background: #0b0b10; }
#canvas { display: block; width: 100%; height: 100%; }
`,
  },
  {
    name: "main.js",
    language: "javascript",
    content: `import * as THREE from 'three';

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  canvas.clientWidth / canvas.clientHeight,
  0.1,
  100,
);
camera.position.set(2, 2, 3);
camera.lookAt(0, 0, 0);

// A rotating cube lit by one directional light.
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x7cc1d9, roughness: 0.4 }),
);
scene.add(cube);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(3, 5, 4);
scene.add(key);

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function frame(t) {
  cube.rotation.x = t * 0.0005;
  cube.rotation.y = t * 0.0008;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
`,
  },
];

/// React (web) starter — a counter component that exercises hooks and
/// CSS so the learner sees the "JSX + state + styles" loop wired up
/// from the first Run. The runtime (`runReact`) imports React + ReactDOM
/// from esm.sh and bundles the App component into the iframe; the user
/// just declares `function App()` (or `export default function …`).
const REACT_TEMPLATE_FILES: WorkbenchFile[] = [
  {
    name: "App.jsx",
    language: "javascript",
    content: `function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="app">
      <h1>Hello, React</h1>
      <p>You clicked {count} time{count === 1 ? '' : 's'}.</p>
      <button onClick={() => setCount(count + 1)}>Click me</button>
    </main>
  );
}
`,
  },
  {
    name: "style.css",
    language: "css",
    content: `:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
.app {
  font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  text-align: center;
  padding: 32px;
}
.app h1 { margin: 0 0 12px; font-weight: 700; letter-spacing: -0.01em; }
.app p { color: #aaa; margin-bottom: 16px; }
.app button {
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  background: #fff;
  color: #000;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.app button:hover { opacity: 0.9; }
`,
  },
];

export const PLAYGROUND_TEMPLATES: Record<LanguageId, Template> = {
  javascript: {
    filename: "main.js",
    fileLanguage: "javascript",
    content: `console.log("Hello, world!");\n`,
  },
  typescript: {
    filename: "main.ts",
    fileLanguage: "typescript",
    content: `const greet = (name: string): string => \`Hello, \${name}!\`;\n\nconsole.log(greet("world"));\n`,
  },
  python: {
    filename: "main.py",
    fileLanguage: "python",
    content: `print("Hello, world!")\n`,
  },
  rust: {
    filename: "src/main.rs",
    fileLanguage: "rust",
    content: `fn main() {\n    println!("Hello, world!");\n}\n`,
  },
  swift: {
    filename: "main.swift",
    fileLanguage: "swift",
    content: `print("Hello, world!")\n`,
  },
  go: {
    filename: "main.go",
    fileLanguage: "go",
    content: `package main

import "fmt"

func main() {
\tfmt.Println("Hello, world!")
}
`,
  },
  web: {
    // Multi-file — `templateFiles()` returns the `files` array for these.
    // The top-level filename/fileLanguage/content are kept populated so
    // the Template shape doesn't need to be optional across the map.
    filename: "index.html",
    fileLanguage: "html",
    content: WEB_TEMPLATE_FILES[0].content,
    files: WEB_TEMPLATE_FILES,
  },
  threejs: {
    filename: "index.html",
    fileLanguage: "html",
    content: THREEJS_TEMPLATE_FILES[0].content,
    files: THREEJS_TEMPLATE_FILES,
  },
  react: {
    filename: "App.jsx",
    fileLanguage: "javascript",
    content: REACT_TEMPLATE_FILES[0].content,
    files: REACT_TEMPLATE_FILES,
  },
  reactnative: {
    filename: "App.js",
    fileLanguage: "javascript",
    content: REACT_NATIVE_TEMPLATE_FILES[0].content,
    files: REACT_NATIVE_TEMPLATE_FILES,
  },
  c: {
    filename: "main.c",
    fileLanguage: "c",
    content: `#include <stdio.h>

int main(void) {
    printf("Hello, world!\\n");
    return 0;
}
`,
  },
  cpp: {
    filename: "main.cpp",
    fileLanguage: "cpp",
    content: `#include <iostream>

int main() {
    std::cout << "Hello, world!" << std::endl;
    return 0;
}
`,
  },
  java: {
    filename: "App.java",
    fileLanguage: "java",
    content: `public class App {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}
`,
  },
  kotlin: {
    // Runner compiles with \`kotlinc -include-runtime\` + \`java -jar\`,
    // which is app mode (not .kts script mode) — so top-level
    // statements aren't valid and we need a \`fun main\` entry point.
    filename: "Main.kt",
    fileLanguage: "kotlin",
    content: `fun main() {
    val greeting = "Hello, world!"
    println(greeting)
}
`,
  },
  csharp: {
    // \`.csx\` is dotnet-script's top-level-statements format — same
    // reasoning as the Kotlin template: minimal ceremony on hello
    // world so the first Run isn't a nine-line ritual.
    filename: "main.csx",
    fileLanguage: "csharp",
    content: `using System;

Console.WriteLine("Hello, world!");
`,
  },
  assembly: {
    // macOS x86_64 / arm64 exit-with-code-42 via the BSD syscall ABI.
    // We use \`.global _main\` + a direct syscall because the user's
    // expected ergonomics for a kata is "does it exit cleanly?" rather
    // than "does it print to stdout via libc" (which requires linker
    // wrangling we don't want as a first-run experience).
    filename: "main.s",
    fileLanguage: "assembly",
    content: `        .global _main
        .align 2

_main:
        // exit(42) via the macOS BSD syscall ABI.
        //   x16 holds the syscall number; exit = 1.
        //   x0 is the argument — our exit code.
        mov     x0, #42
        mov     x16, #1
        svc     #0x80
`,
  },
};

/// Resolve the starter-file set for a playground language. Multi-file
/// templates (web, threejs) return their full file array; single-file
/// templates synthesize one `WorkbenchFile` from the template's
/// filename + fileLanguage + content. Cloned so downstream edits can't
/// poison the template singleton.
export function templateFiles(language: LanguageId): WorkbenchFile[] {
  const t = PLAYGROUND_TEMPLATES[language];
  if (t.files && t.files.length > 0) {
    return t.files.map((f) => ({ ...f }));
  }
  return [
    {
      name: t.filename,
      language: t.fileLanguage,
      content: t.content,
    },
  ];
}
