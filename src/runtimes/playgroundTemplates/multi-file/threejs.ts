/// Auto-split from the original `src/runtimes/playgroundTemplates.ts`
/// monolith. See `scripts/split-playground-templates.mjs` for the
/// splitter. Each multi-file template gets its own file; single-file
/// templates live together in `../single-file.ts`.

import type { WorkbenchFile } from "../../../data/types";

/// Three.js starter — importmap points at a CDN build, a rotating cube
/// sits on a transparent canvas so it pops against the Fishbones dark
/// palette. Educational intent: "scene + camera + renderer, add mesh,
/// animate in a requestAnimationFrame loop."
export const THREEJS_TEMPLATE_FILES: WorkbenchFile[] = [
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
  <!-- Three.js shipped from the local Tauri preview server's /vendor
       route. The addons/ tree isn't bundled — anything that needs an
       addon (OrbitControls, GLTFLoader, etc.) would need a follow-up
       vendor pass. Most learner-facing kata code uses just the core
       module so this covers the 90% case. -->
  <script type="importmap">
  {
    "imports": {
      "three": "/vendor/three.module.js"
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
