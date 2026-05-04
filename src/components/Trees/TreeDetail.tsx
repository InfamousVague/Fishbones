import { useEffect, useMemo, useRef, useState } from "react";
import type { Course } from "../../data/types";
import {
  iconForSkill,
  layoutTree,
  isSkillComplete,
  isSkillUnlocked,
  suggestNextSkill,
  treeProgressPercent,
  type SkillTree,
  type SkillNode,
} from "../../data/trees";
import { lock as lockIcon } from "@base/primitives/icon/icons/lock";
import { check as checkIcon } from "@base/primitives/icon/icons/check";
import { arrowLeft } from "@base/primitives/icon/icons/arrow-left";
import { ICON_REGISTRY } from "./iconRegistry";
import { layoutWeb, NODE_RADIUS } from "./layout";
import SkillPanel from "./SkillPanel";

/// Exported so the fishbones.academy marketing site can mount the
/// real tree visualiser on its homepage with mock courses /
/// completion data. Internal navigation (TreesView shelf <-> detail)
/// still uses this directly; nothing here knows it's being
/// rendered outside the Tauri shell.
export interface TreeDetailProps {
  tree: SkillTree;
  courses: readonly Course[];
  completed: Set<string>;
  onBack: () => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  /// Marketing-mode display toggle. When true:
  ///   - Wheel events pass through (page scroll works normally)
  ///   - Pointer drag-to-pan is disabled
  ///   - Node clicks are inert (no side panel, no goal tracking)
  ///   - Hover hit-testing still works (nodes glow on mouseover)
  /// Hover-only is the intended marketing presentation: visitors
  /// see the tree react to their cursor without being able to
  /// trap them in a deep navigation flow.
  viewOnly?: boolean;
  /// Slow continuous auto-pan around the tree's bounds. When set,
  /// the canvas drifts horizontally back-and-forth on a ~30s loop
  /// so visitors who scroll the homepage to this section see
  /// movement without having to interact. Pauses when the section
  /// scrolls out of view (cheap IntersectionObserver in the
  /// useEffect). No-op unless `viewOnly` is also true — the auto-
  /// pan would fight a learner's manual drag otherwise.
  autoPan?: boolean;
  /// Batch-install handler for "the path you picked needs books you
  /// don't have yet." Receives the deduped courseIds collected by
  /// the skill panel and is expected to resolve once every install
  /// has run (success or skip). When omitted, the panel hides the
  /// install affordance entirely — useful for marketing-mode where
  /// no install plumbing exists.
  onInstallMissingCourses?: (courseIds: string[]) => Promise<void>;
}

/// Detail view for a single tree — DAG visualiser with pan / zoom,
/// lesson side panel, prereq-chain highlight, and goal-tracking. See
/// `TreeDetailProps` for marketing-site usage notes.
export function TreeDetail({
  tree,
  courses,
  completed,
  onBack,
  onOpenLesson,
  viewOnly = false,
  autoPan = false,
  onInstallMissingCourses,
}: TreeDetailProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  // The "track goal" — a single skill the learner has marked as
  // their target. Setting it computes a prereq chain (BFS upward
  // through the DAG) which lights up on the tree as a coherent
  // path. Cleared if the same skill is set twice (toggle) or if
  // the user picks a different goal. Lives per-tree, not globally,
  // so opening another tree doesn't carry the chain over.
  const [trackGoalId, setTrackGoalId] = useState<string | null>(null);
  // Pan offset (the SVG is shifted by this much inside the viewport).
  // Positive x → SVG slides right (canvas moves right), positive y →
  // SVG slides down. Drag pan updates both axes.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Zoom factor. 1 = native size. Cmd/Ctrl+wheel zooms; trackpad
  // pinch-zoom on macOS arrives as wheel events with ctrlKey set,
  // so the same handler covers it. Clamped to a sane range.
  const [zoom, setZoom] = useState(1);
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 2.5;
  const containerRef = useRef<HTMLDivElement>(null);
  // Tracks the in-progress drag so pointermove can compute deltas
  // without React state churn each frame. Using a ref instead of
  // state keeps the drag at native pointermove rate without causing
  // re-renders for every pixel — only the pan setState causes a
  // re-render, and that batches naturally with the browser's frame.
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
    /// Latest pointer position + timestamp, used by pointerup to
    /// compute release velocity for the momentum coast.
    lastX: number;
    lastY: number;
    lastT: number;
    /// Velocity at the moment of the previous pointermove tick, in
    /// pixels per millisecond. Updated each move; read on release.
    velX: number;
    velY: number;
  } | null>(null);
  /// Active momentum-coast loop. Stores the rAF handle so we can
  /// cancel mid-flight when the user starts a new gesture, and the
  /// running velocity that decays each frame.
  const momentumRef = useRef<{ raf: number | null; vx: number; vy: number }>({
    raf: null,
    vx: 0,
    vy: 0,
  });
  const { positioned, primaryParent } = useMemo(() => layoutWeb(tree), [tree]);
  const byId = useMemo(() => {
    const m = new Map<string, SkillNode>();
    for (const n of tree.nodes) m.set(n.id, n);
    return m;
  }, [tree]);
  const nextUp = useMemo(
    () => suggestNextSkill(tree, completed),
    [tree, completed],
  );
  const pct = treeProgressPercent(tree, completed);

  // Track membership — every skill that the user must complete to
  // reach `trackGoalId` (the goal itself, plus all transitive
  // prereqs). Computed via BFS upward through the prereq DAG. The
  // ordered version (root → goal, sorted by depth) feeds the
  // panel's checklist; the Set version is for fast lookups when
  // styling nodes / edges.
  const track = useMemo(() => {
    if (!trackGoalId) return { set: new Set<string>(), ordered: [] as SkillNode[] };
    const set = new Set<string>();
    const queue = [trackGoalId];
    while (queue.length) {
      const id = queue.shift()!;
      if (set.has(id)) continue;
      set.add(id);
      const node = byId.get(id);
      if (!node) continue;
      for (const pid of node.prereqs) queue.push(pid);
    }
    // Order by depth so the checklist reads root → goal.
    const sized = layoutTree(tree);
    const depthMap = new Map(sized.map((n) => [n.id, n.depth] as const));
    const ordered = [...set]
      .map((id) => byId.get(id))
      .filter((n): n is SkillNode => !!n)
      .sort((a, b) => (depthMap.get(a.id) ?? 0) - (depthMap.get(b.id) ?? 0));
    return { set, ordered };
  }, [trackGoalId, byId, tree]);

  // Compute SVG viewBox + canvas size from the positioned nodes.
  // The greedy layout outputs raw coordinates; we shift them so the
  // leftmost node sits at x = padding and the SVG starts at 0.
  // PAD_Y is large enough to fit the LABEL below the last row's
  // node centre. Labels render at `+NODE_RADIUS + 16` below the
  // node centre — that's 44px of extra height for the deepest row.
  // With PAD_Y < that, the label text spills past the SVG box and
  // gets clipped by the surrounding viewport's `overflow: hidden`.
  const PAD_X = 60;
  const PAD_Y = 64;
  const minX = positioned.reduce((acc, n) => Math.min(acc, n.x), Infinity);
  const maxX = positioned.reduce((acc, n) => Math.max(acc, n.x), -Infinity);
  const maxY = positioned.reduce((acc, n) => Math.max(acc, n.y), 0);
  const offsetX = -minX + PAD_X;
  const width = maxX - minX + PAD_X * 2;
  const height = maxY + PAD_Y * 2;
  const posMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of positioned) m.set(n.id, { x: n.x + offsetX, y: n.y + PAD_Y });
    return m;
  }, [positioned, offsetX]);

  // Pan bounds. The user shouldn't be able to fling the canvas off
  // into empty space — the rule is: the SVG's far edge can come at
  // most VIGNETTE_BUFFER past the opposite viewport edge, so the
  // vignette has its full fade band to dissolve into but no
  // further. When the tree fits inside the viewport, we still allow
  // ±VIGNETTE_BUFFER of slop around the centred position so the
  // user can nudge it without it feeling stuck.
  const VIGNETTE_BUFFER = 60;
  const svgW = Math.max(width, 600);
  const svgH = height;
  // Pan clamp uses the SCALED canvas size (svgW * zoom) — when
  // zoomed in the canvas is bigger than its native dimensions, so
  // bounds widen accordingly; when zoomed out the canvas shrinks
  // and pan tightens to keep it on-screen.
  const clampPan = (
    cw: number,
    ch: number,
    x: number,
    y: number,
    z: number = zoom,
  ): { x: number; y: number } => {
    const sw = svgW * z;
    const sh = svgH * z;
    const xBounds =
      sw >= cw
        ? { min: cw - sw - VIGNETTE_BUFFER, max: VIGNETTE_BUFFER }
        : {
            min: (cw - sw) / 2 - VIGNETTE_BUFFER,
            max: (cw - sw) / 2 + VIGNETTE_BUFFER,
          };
    const yBounds =
      sh >= ch
        ? { min: ch - sh - VIGNETTE_BUFFER, max: VIGNETTE_BUFFER }
        : {
            min: (ch - sh) / 2 - VIGNETTE_BUFFER,
            max: (ch - sh) / 2 + VIGNETTE_BUFFER,
          };
    return {
      x: Math.max(xBounds.min, Math.min(xBounds.max, x)),
      y: Math.max(yBounds.min, Math.min(yBounds.max, y)),
    };
  };

  // Open at 100% zoom focused on the TOP of the tree — the user
  // wants to see the root first and explore downward, not start
  // zoomed-out across the full canvas. We pan horizontally so the
  // root sits at the viewport's horizontal centre, and vertically
  // so the root sits near the top with VIGNETTE_BUFFER of
  // breathing room. Drag-pan + zoom-buttons let the user navigate
  // from there. Re-runs only when the tree changes so manual
  // zoom/pan during a session is preserved.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    setZoom(1);
    // The root node sits at the top-centre of the SVG by virtue of
    // tidy-tree centering. svgW / 2 puts the SVG's horizontal
    // centre at the viewport centre (pan.x = (cw - svgW) / 2).
    // For y, we keep the SVG's top near the viewport's top so the
    // root is the first thing the user sees — VIGNETTE_BUFFER
    // gives a small margin so the root isn't faded by the mask.
    setPan(
      clampPan(
        cw,
        ch,
        (cw - svgW) / 2,
        VIGNETTE_BUFFER,
        1,
      ),
    );
  }, [tree.id, svgW, svgH]);

  // Auto-pan loop for marketing-mode mounts. Drifts the canvas
  // back-and-forth horizontally on a slow ~28-second sine sweep so
  // a visitor scrolling the homepage to this section sees motion
  // without having to interact. Vertical position is locked
  // (we just want to showcase the tree's lateral spread) so the
  // root row stays visible the whole time.
  //
  // Only runs when BOTH viewOnly AND autoPan are set — autoPan
  // alone (without viewOnly) would fight a learner's manual drag.
  // IntersectionObserver pauses the rAF when the section scrolls
  // out of view so we don't burn CPU off-screen.
  useEffect(() => {
    if (!viewOnly || !autoPan) return;
    const el = containerRef.current;
    if (!el) return;
    let rafId = 0;
    let inView = true;
    const startTime = performance.now();
    // Loop period in ms — one full back-and-forth sweep. 28s feels
    // unhurried; faster reads as anxious, slower reads as static.
    const PERIOD = 28_000;
    const tick = (now: number) => {
      if (!inView) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      // Pan amplitude: total horizontal travel = svgW (the laid-out
      // tree width) minus viewport width. Capped at 0 if the tree
      // already fits the viewport (no panning needed).
      const overflow = Math.max(0, svgW - cw);
      const amplitude = overflow / 2;
      // Sine sweep centred on (cw - svgW) / 2 — i.e. the same x
      // position the initial-pan effect anchors to. Phase starts
      // at sin(0) = 0 so the canvas begins centred and drifts left
      // first. (cos would start at the leftmost extreme; sin feels
      // calmer because the first motion is subtle.)
      const t = ((now - startTime) % PERIOD) / PERIOD;
      const offset = Math.sin(t * Math.PI * 2) * amplitude;
      setPan(
        clampPan(
          cw,
          ch,
          (cw - svgW) / 2 + offset,
          VIGNETTE_BUFFER,
          1,
        ),
      );
      rafId = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(el);
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOnly, autoPan, svgW, svgH]);

  // Drag-pan handlers. Pointer capture is DEFERRED until we know
  // the gesture is actually a drag (8px of movement) — capturing
  // on pointerdown redirects the subsequent click event to the
  // capturing element instead of the node the user pointed at, so
  // node selection breaks for real-mouse clicks even though
  // synthetic clicks dispatched directly to the node still work.
  // Once we cross the threshold and capture, the rest of the drag
  // is anchored to the viewport and survives the pointer leaving
  // the element bounds.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // viewOnly mode (marketing site) — drag-to-pan is disabled,
    // so a pointerdown is just a hover seed. Skip the drag-state
    // setup entirely and let onPointerMove fall through to its
    // hover hit-test branch.
    if (viewOnly) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // Cancel any in-flight momentum coast — a new touch should
    // immediately stop the canvas, the way maps/Figma behave.
    if (momentumRef.current.raf !== null) {
      cancelAnimationFrame(momentumRef.current.raf);
      momentumRef.current.raf = null;
      momentumRef.current.vx = 0;
      momentumRef.current.vy = 0;
    }
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      velX: 0,
      velY: 0,
    };
    // No setPointerCapture here — see comment above.
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      // Bump from 4 to 8 so jittery mice / trackpad taps don't get
      // misclassified as drags — real drag intent moves much more
      // than 8px from the down-press, and most clicks don't drift
      // more than 2-3px even on high-DPI sensors.
      if (!drag.moved && Math.hypot(dx, dy) > 8) {
        drag.moved = true;
        // NOW capture: the gesture is definitely a drag, and we
        // need capture so the drag continues if the user's pointer
        // leaves the viewport. Wrap in try because some
        // environments throw if the pointer is already released.
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {}
      }
      if (drag.moved) {
        const el = containerRef.current;
        const cw = el?.clientWidth ?? 0;
        const ch = el?.clientHeight ?? 0;
        setPan(clampPan(cw, ch, drag.startPanX + dx, drag.startPanY + dy));
        // Track instantaneous velocity (px / ms) so the release
        // momentum coast picks up where the user's finger left off.
        const now = performance.now();
        const dt = now - drag.lastT;
        if (dt > 0) {
          // Single-tick velocity is jittery — blend with previous
          // sample so the coast doesn't get a wild last-frame
          // direction. 0.3 weight on the new sample is enough to
          // track direction changes while smoothing pixel jitter.
          drag.velX = drag.velX * 0.7 + ((e.clientX - drag.lastX) / dt) * 0.3;
          drag.velY = drag.velY * 0.7 + ((e.clientY - drag.lastY) / dt) * 0.3;
        }
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        drag.lastT = now;
        // Drop hover state during pan so the tooltip doesn't flicker
        // on every node we sweep past.
        setHover((h) => (h ? null : h));
        return;
      }
      // Not moved yet — fall through to hover hit-test so hover
      // tracking continues even while the button is down.
    }
    // Hover hit-test against the panned + zoomed SVG.
    // getBoundingClientRect returns the visually-scaled rect, so
    // (clientX - rect.left) is in SCREEN pixels relative to the
    // SVG's top-left. posMap entries are in UNSCALED SVG coords,
    // so we divide by zoom before comparing distances.
    const svg = e.currentTarget.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const n of positioned) {
      const p = posMap.get(n.id);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < NODE_RADIUS + 6 && d < bestD) {
        bestD = d;
        bestId = n.id;
      }
    }
    setHover((h) => {
      if (!bestId) return h ? null : h;
      if (h?.nodeId === bestId) return h;
      const p = posMap.get(bestId)!;
      return { nodeId: bestId, x: p.x, y: p.y };
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    // releasePointerCapture is a no-op if we never captured.
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    // Kick off a momentum coast if the release had real velocity.
    // Threshold (0.15 px/ms ≈ 150 px/s) keeps idle drags from
    // drifting; a real toss is comfortably above. The coast feels
    // "tiny" because the per-frame multiplier is 16ms, so even at
    // 1 px/ms only ~16px is added per frame, and decay (0.86)
    // halves the velocity in ~5 frames (~80ms). The whole coast
    // lives for under 250ms, which is the "tiny bit" the user
    // asked for — enough to acknowledge release inertia without
    // turning navigation into bowling.
    if (drag.moved) {
      const speed = Math.hypot(drag.velX, drag.velY);
      if (speed > 0.15) {
        const el = containerRef.current;
        const cw = el?.clientWidth ?? 0;
        const ch = el?.clientHeight ?? 0;
        momentumRef.current.vx = drag.velX;
        momentumRef.current.vy = drag.velY;
        const tick = () => {
          const m = momentumRef.current;
          // Apply per-frame displacement (~16ms at 60fps).
          setPan((p) => clampPan(cw, ch, p.x + m.vx * 16, p.y + m.vy * 16));
          // Decay velocity. 0.86 → ~10× decay over 16 frames,
          // i.e. the coast is over in about a quarter second.
          m.vx *= 0.86;
          m.vy *= 0.86;
          if (Math.hypot(m.vx, m.vy) > 0.01) {
            m.raf = requestAnimationFrame(tick);
          } else {
            m.raf = null;
          }
        };
        momentumRef.current.raf = requestAnimationFrame(tick);
      }
    }
    // Keep the ref alive briefly so the synthetic click that fires
    // after pointerup can check `moved` before clearing. Without the
    // delay, click handlers see a null dragRef and treat every pan
    // as a node selection.
    if (drag.moved) {
      window.setTimeout(() => {
        if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
      }, 50);
    } else {
      dragRef.current = null;
    }
  };

  // Wheel-to-pan: trackpad two-finger gestures and mouse-wheel
  // scrolling translate into pan deltas. preventDefault() stops the
  // browser from scrolling the parent container instead — without
  // it, wheel events bubble up to the app body. Wheel deltas are
  // applied as negative pan (scroll-down → content moves up,
  // matching how a scroll surface would feel).
  // Zoom around a cursor point: keep the world point under the
  // cursor in the same screen position after the zoom change. This
  // is what makes Figma / Maps zoom feel right — the focal point
  // stays anchored under the cursor rather than the canvas
  // jumping around.
  const zoomAroundPoint = (
    cursorX: number,
    cursorY: number,
    nextZoom: number,
  ) => {
    const el = containerRef.current;
    const cw = el?.clientWidth ?? 0;
    const ch = el?.clientHeight ?? 0;
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextZoom));
    // World coords (in unscaled SVG space) of the point under cursor
    // BEFORE the zoom change.
    const worldX = (cursorX - pan.x) / zoom;
    const worldY = (cursorY - pan.y) / zoom;
    // After the zoom change, choose pan so worldX/worldY land back
    // at the same cursor position.
    const nextPan = clampPan(
      cw,
      ch,
      cursorX - worldX * z,
      cursorY - worldY * z,
      z,
    );
    setZoom(z);
    setPan(nextPan);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // viewOnly mode (marketing site) — let the wheel event bubble
    // up to the page. Without this early-return the section would
    // trap scroll and the visitor couldn't scroll past the tree.
    if (viewOnly) return;
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    // ctrlKey covers BOTH Ctrl+wheel (mouse) AND macOS trackpad
    // pinch-zoom (which the OS synthesises as a wheel event with
    // ctrlKey set, regardless of the actual modifier state).
    // metaKey adds Cmd+wheel for parity with other zoom UIs.
    if (e.ctrlKey || e.metaKey) {
      const r = el.getBoundingClientRect();
      const cursorX = e.clientX - r.left;
      const cursorY = e.clientY - r.top;
      // Wheel deltaY → multiplicative scale change. Bumped the
      // sensitivity from 0.0025 → 0.01 so trackpad pinch reaches a
      // useful zoom level in 4–6 finger movements instead of 20+.
      // Mouse wheel events still feel proportional because they
      // deliver larger deltas — exp() naturally compresses them.
      const factor = Math.exp(-e.deltaY * 0.01);
      zoomAroundPoint(cursorX, cursorY, zoom * factor);
      return;
    }
    setPan((p) => clampPan(cw, ch, p.x - e.deltaX, p.y - e.deltaY));
  };

  // Discrete zoom controls (buttons / keyboard). zoomBy(1.2) zooms
  // in, zoomBy(1/1.2) zooms out; both anchor on the viewport
  // centre so the user doesn't need to position the cursor first.
  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAroundPoint(r.width / 2, r.height / 2, zoom * factor);
  };
  const zoomReset = () => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    setZoom(1);
    setPan(clampPan(cw, ch, (cw - svgW) / 2, (ch - svgH) / 2, 1));
  };

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const hovered = hover ? byId.get(hover.nodeId) ?? null : null;

  return (
    <div
      className="fishbones-trees fishbones-trees--detail"
      style={{ "--tree-accent": tree.accent } as React.CSSProperties}
    >
      <header className="fishbones-trees__detail-head">
        <button
          type="button"
          className="fishbones-trees__back"
          onClick={onBack}
        >
          <svg
            className="fishbones-trees__back-icon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            dangerouslySetInnerHTML={{ __html: arrowLeft }}
          />
          All trees
        </button>
        <div className="fishbones-trees__detail-meta">
          <h1 className="fishbones-trees__detail-title">{tree.title}</h1>
          <p className="fishbones-trees__detail-blurb">{tree.description}</p>
        </div>
        <div className="fishbones-trees__detail-progress">
          <div className="fishbones-trees__detail-pct">{pct}%</div>
          <div className="fishbones-trees__detail-pct-label">
            {/* Exclude section hubs from both numerator and
                denominator — they're categorical organizers, not
                learnable skills, so counting them would
                misrepresent progress. */}
            {tree.nodes.filter((n) => n.kind !== "section" && isSkillComplete(n, completed)).length}/
            {tree.nodes.filter((n) => n.kind !== "section").length} skills
          </div>
        </div>
      </header>

      <div
        className="fishbones-trees__web-scroll"
        ref={containerRef}
        // Drag-pan navigation. Pointer handlers do double duty: they
        // start/finish a pan when the user drags, and they keep
        // running the hover hit-test the rest of the time. See the
        // helper definitions above for the movement-threshold logic
        // that distinguishes a click from a drag.
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!dragRef.current) setHover(null);
        }}
        onWheel={onWheel}
      >
        <svg
          className="fishbones-trees__web"
          width={Math.max(width, 600)}
          height={height}
          viewBox={`0 0 ${Math.max(width, 600)} ${height}`}
          style={{
            // Scale first, then translate. With `transform-origin: 0 0`
            // (set in CSS), the scale anchors at the SVG's top-left,
            // so the math in zoomAroundPoint — pan = cursor - world*z
            // — lines up cleanly. `translate3d` keeps everything on
            // the GPU compositing layer for smooth drag + zoom.
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          }}
        >
          {/* Edge mask — paints the canvas white (visible) with a
              black disc punched out at each node centre. Wrapping
              the edge layer in `mask="url(#trees-edge-mask)"` then
              clips the connecting lines so they never poke through
              a circle. We use NODE_RADIUS + 2 for the punch radius
              so the line ends a pixel shy of the stroke and there's
              no faint sliver bleeding under the circle's border. */}
          <defs>
            <mask id="trees-edge-mask" maskUnits="userSpaceOnUse">
              <rect
                x={0}
                y={0}
                width={Math.max(width, 600)}
                height={height}
                fill="white"
              />
              {positioned.map((n) => {
                const p = posMap.get(n.id);
                if (!p) return null;
                return (
                  <circle
                    key={n.id}
                    cx={p.x}
                    cy={p.y}
                    r={NODE_RADIUS + 2}
                    fill="black"
                  />
                );
              })}
            </mask>
          </defs>
          {/* Edges — drawn under the circles via the mask above.
              Orthogonal "tree line" shape (drop down → cross
              horizontally → drop down). Every edge bending from
              row D into row D+1 uses the SAME baseMidY, so all
              horizontals between two adjacent rows lie on a
              single shared y-coord. Combined with the low-alpha
              monochrome stroke that's CSS-applied on each path,
              multiple edges that share a horizontal run stack
              their alpha and thicken naturally — that's where the
              "denser trunk" look comes from. We tried per-parent
              stagger here once but it scattered same-level edges
              into separate rows and lost the visual cohesion. */}
          <g mask="url(#trees-edge-mask)">
          {(() => {
            return tree.nodes.flatMap((n) => {
              const childPos = posMap.get(n.id);
              if (!childPos) return [];
              const childComplete = isSkillComplete(n, completed);
              const childUnlocked = isSkillUnlocked(n, byId, completed);
              return n.prereqs.map((pid) => {
                const parentPos = posMap.get(pid);
                if (!parentPos) return null;
                const parentNode = byId.get(pid);
                const parentComplete = parentNode
                  ? isSkillComplete(parentNode, completed)
                  : false;
                const active = parentComplete && childComplete;
                const reachable = parentComplete && childUnlocked;
                const isPrimary = primaryParent.get(n.id) === pid;
                // An edge is "in track" only if BOTH endpoints are
                // in the track set — otherwise we'd light up edges
                // that exit the track and confuse the path reading.
                const inTrack = track.set.has(pid) && track.set.has(n.id);
                // Single shared bend-Y for every edge between this
                // parent's row and this child's row. Multiple edges
                // running between the same two rows therefore share
                // their horizontal segment exactly — alpha-stacking
                // turns the shared run into a thicker visual trunk.
                const by = (parentPos.y + childPos.y) / 2;
                const d = `M ${parentPos.x} ${parentPos.y + NODE_RADIUS} V ${by} H ${childPos.x} V ${childPos.y - NODE_RADIUS}`;
                return (
                  <path
                    key={`${pid}->${n.id}`}
                    className={[
                      "fishbones-trees__edge",
                      !isPrimary && "fishbones-trees__edge--cross",
                      active && "fishbones-trees__edge--active",
                      !active && reachable && "fishbones-trees__edge--reachable",
                      inTrack && "fishbones-trees__edge--in-track",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    d={d}
                    fill="none"
                  />
                );
              });
            });
          })()}
          </g>

          {/* Nodes — circle + lucide icon, with state-based class
              modifiers for complete / locked / next-up / gap. No
              per-node mouse handlers; the single pointermove on
              the scroll container drives the hover state. */}
          {positioned.map((n) => {
            const pos = posMap.get(n.id)!;
            const complete = isSkillComplete(n, completed);
            const unlocked = isSkillUnlocked(n, byId, completed);
            const isNext = nextUp?.id === n.id;
            // Section nodes are NOT gaps — they're categorical
            // organizers that should render distinct from the
            // "Coming soon" empty-content placeholders.
            const isGap = n.matches.length === 0 && n.kind !== "section";
            const isSection = n.kind === "section";
            const iconName = iconForSkill(n.id);
            const iconPaths = ICON_REGISTRY[iconName] ?? ICON_REGISTRY.circle;
            return (
              <g
                key={n.id}
                className={[
                  "fishbones-trees__node",
                  complete && "fishbones-trees__node--complete",
                  !unlocked && "fishbones-trees__node--locked",
                  isNext && "fishbones-trees__node--next",
                  isGap && "fishbones-trees__node--gap",
                  isSection && "fishbones-trees__node--section",
                  selectedId === n.id && "fishbones-trees__node--selected",
                  track.set.has(n.id) && "fishbones-trees__node--in-track",
                  trackGoalId === n.id && "fishbones-trees__node--track-goal",
                ]
                  .filter(Boolean)
                  .join(" ")}
                transform={`translate(${pos.x} ${pos.y})`}
                onClick={() => {
                  // viewOnly mode (marketing site) — clicks are
                  // inert. The hover state still highlights the
                  // node + its prereq chain, but no side panel
                  // opens and no goal tracking fires.
                  if (viewOnly) return;
                  // Suppress the click that synthesizes after a
                  // pan gesture — without this every drag would
                  // also select the node we released on.
                  if (dragRef.current?.moved) return;
                  setSelectedId(n.id);
                }}
              >
                <circle
                  className="fishbones-trees__node-circle"
                  r={NODE_RADIUS}
                  cx={0}
                  cy={0}
                />
                {isNext && !complete && (
                  <circle
                    className="fishbones-trees__node-pulse"
                    r={NODE_RADIUS + 4}
                    cx={0}
                    cy={0}
                    fill="none"
                  />
                )}
                <g
                  className="fishbones-trees__node-icon"
                  transform="translate(-12 -12)"
                  dangerouslySetInnerHTML={{ __html: iconPaths }}
                />
                <text
                  className="fishbones-trees__node-text"
                  y={NODE_RADIUS + 16}
                  textAnchor="middle"
                >
                  {n.label.length > 20 ? n.label.slice(0, 18) + "…" : n.label}
                </text>
                {/* State badges — small circles with lucide icons
                    sit on the line where it joins the node's top.
                    Lock = locked, Check = complete. Drawing them
                    at (0, -R) puts them directly on the joint
                    between the connecting line and the circle. */}
                {!unlocked && (
                  <g
                    className="fishbones-trees__node-badge fishbones-trees__node-badge--lock"
                    transform={`translate(0 ${-NODE_RADIUS})`}
                  >
                    <circle r={9} cx={0} cy={0} />
                    <g
                      transform="translate(-7 -7) scale(0.58)"
                      dangerouslySetInnerHTML={{ __html: lockIcon }}
                    />
                  </g>
                )}
                {complete && (
                  <g
                    className="fishbones-trees__node-badge fishbones-trees__node-badge--check"
                    transform={`translate(0 ${-NODE_RADIUS})`}
                  >
                    <circle r={9} cx={0} cy={0} />
                    <g
                      transform="translate(-7 -7) scale(0.58)"
                      dangerouslySetInnerHTML={{ __html: checkIcon }}
                    />
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip — separate HTML layer so we can style with
            real CSS (text wrapping, padding, drop-shadow) and keep
            a11y predictable. Positioned in the SCROLL container,
            not the page, so it tracks scroll naturally. */}
        {hover && hovered && (() => {
          // Edge-aware tooltip positioning. Default placement is to
          // the RIGHT of the hovered node. If that would overflow
          // the viewport on the right (or get covered by the open
          // skill panel), flip to the LEFT side instead. Same logic
          // for vertical: if the tooltip would clip the bottom or
          // top, anchor it inside the viewport.
          //
          // We use estimated tooltip dimensions (CSS caps width at
          // 260px and the body rarely exceeds 130px tall). Being
          // off by a few pixels is harmless — the goal is just to
          // avoid the obvious "tooltip cut off" case the user hit.
          const TT_W = 280;
          const TT_H = 140;
          const containerEl = containerRef.current;
          const cw = containerEl?.clientWidth ?? Infinity;
          const ch = containerEl?.clientHeight ?? Infinity;
          // The skill panel (when open) covers the right ~370px of
          // the page in fixed positioning. Subtract that from the
          // available container width so tooltips on right-side
          // nodes flip before crossing under the panel.
          const panelOpen = !!selectedId;
          const rightLimit = panelOpen ? cw - 380 : cw;
          // hover.{x,y} is in unscaled SVG space; multiply by zoom
          // before adding pan to land in viewport coords. The
          // NODE_RADIUS offset also scales (so the gap between the
          // tooltip and the visual node circle stays a node-width
          // apart at any zoom).
          const nx = hover.x * zoom + pan.x;
          const ny = hover.y * zoom + pan.y;
          const scaledRadius = NODE_RADIUS * zoom;
          const wouldOverflowRight = nx + scaledRadius + 12 + TT_W > rightLimit;
          const left = wouldOverflowRight
            ? Math.max(8, nx - scaledRadius - 12 - TT_W)
            : nx + scaledRadius + 12;
          // Vertical: try to align tooltip top near the node, but
          // pull up if it would clip the bottom.
          let top = ny - 4;
          if (top + TT_H > ch - 8) top = Math.max(8, ch - TT_H - 8);
          return (
          <div
            className={[
              "fishbones-trees__tooltip",
              wouldOverflowRight && "fishbones-trees__tooltip--flipped",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ left, top }}
            role="tooltip"
          >
            <div className="fishbones-trees__tooltip-title">
              {hovered.label}
            </div>
            <div className="fishbones-trees__tooltip-body">
              {hovered.summary}
            </div>
            <div className="fishbones-trees__tooltip-state">
              {isSkillComplete(hovered, completed) && (
                <span className="fishbones-trees__tooltip-flag fishbones-trees__tooltip-flag--done">
                  Complete
                </span>
              )}
              {nextUp?.id === hovered.id && !isSkillComplete(hovered, completed) && (
                <span className="fishbones-trees__tooltip-flag">
                  Next up
                </span>
              )}
              {!isSkillUnlocked(hovered, byId, completed) && (
                <span className="fishbones-trees__tooltip-flag fishbones-trees__tooltip-flag--locked">
                  Locked — needs {hovered.prereqs.length} prereq
                  {hovered.prereqs.length === 1 ? "" : "s"}
                </span>
              )}
              {hovered.matches.length === 0 && (
                <span className="fishbones-trees__tooltip-flag fishbones-trees__tooltip-flag--gap">
                  Coming soon
                </span>
              )}
            </div>
          </div>
          );
        })()}

        {/* Zoom controls — small floating cluster in the bottom-left
            of the viewport. Clicking +/- zooms around the centre,
            % button resets to 100% and re-centres. We render this
            INSIDE the scroll container so the controls track the
            viewport (and stay below the topbar / outside the right
            skill panel). */}
        <div className="fishbones-trees__zoom" aria-label="Zoom controls">
          <button
            type="button"
            className="fishbones-trees__zoom-btn"
            onClick={() => zoomBy(1 / 1.2)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="fishbones-trees__zoom-btn fishbones-trees__zoom-btn--readout"
            onClick={zoomReset}
            aria-label="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="fishbones-trees__zoom-btn"
            onClick={() => zoomBy(1.2)}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      {selected && (
        <SkillPanel
          node={selected}
          tree={tree}
          courses={courses}
          completed={completed}
          unlocked={isSkillUnlocked(selected, byId, completed)}
          isNext={nextUp?.id === selected.id}
          isTrackGoal={trackGoalId === selected.id}
          trackOrdered={track.ordered}
          onSetTrack={() =>
            setTrackGoalId((current) => (current === selected.id ? null : selected.id))
          }
          onClose={() => setSelectedId(null)}
          onOpenLesson={onOpenLesson}
          onInstallMissingCourses={onInstallMissingCourses}
        />
      )}
    </div>
  );
}
