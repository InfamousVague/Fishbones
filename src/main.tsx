import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PoppedWorkbench from "./components/Workbench/PoppedWorkbench";
import PhonePopoutView from "./components/PhonePopout/PhonePopoutView";
import { GanacheDock } from "./components/GanacheDock/GanacheDock";
import { applyTheme, loadTheme } from "./theme/themes";
import "./theme/themes.css";
import "./App.css";

// Apply the user's chosen theme (or system preference for the first-run
// default) before React mounts so we don't flash the wrong palette.
applyTheme(loadTheme());

// Three render modes out of a single bundle:
// - default: full App (sidebar + reader + workbench)
// - ?popped=1&course=…&lesson=…: standalone workbench only. Used by
//   the pop-out window opened via window.open from the main window,
//   so learners can drag the editor + console onto a second monitor.
// - ?phone=1&scope=…: standalone phone simulator. Replaces the in-app
//   FloatingPhone modal — RN previews now open in a separate OS
//   window and the main editor pushes new preview URLs over a bus.
const params = new URLSearchParams(window.location.search);
const isPopped = params.get("popped") === "1";
const isPhone = params.get("phone") === "1";
// Standalone Ganache-style dock window. Mounts only the chain UI in
// popout variant — see `evmDockPopout.ts` for the open-side helper.
const isEvmDock = params.get("evmDock") === "1";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isEvmDock ? (
      <GanacheDock variant="popout" />
    ) : isPhone ? (
      <PhonePopoutView />
    ) : isPopped ? (
      <PoppedWorkbench />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);

// Hand off from the inline index.html preloader to React's in-app
// bootloader. `is-booted` fades the preloader out via the CSS rule in
// index.html; App's `.fishbones__bootloader` (or MobileApp's
// `.m-app__boot`) takes over until the course list resolves.
//
// The handoff is now driven by App / MobileApp via a `useLayoutEffect`
// so the inline preloader stays visible until React has actually
// committed its first render — previously the eager
// `queueMicrotask`/`setTimeout(0)` fired before React painted on slow
// devices (esp. iOS WebKit cold-starting the bundle), leaving a black
// gap between the inline preloader fading and the React loader
// appearing. The 4s safety timeout below only kicks in if React fails
// to mount entirely (e.g. a syntax error in a downstream module) — at
// that point the user is going to see *something* broken, but at least
// the preloader doesn't camp the screen forever.
setTimeout(() => document.body.classList.add("is-booted"), 4000);
