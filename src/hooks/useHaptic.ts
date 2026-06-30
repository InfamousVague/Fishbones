/// React hooks for the haptics service. Components shouldn't
/// touch `fireHaptic` directly — they reach for one of these
/// hooks so the call site reads as declarative ("haptic when X
/// changes", "haptic when this element scrolls into view") and
/// teardown is handled automatically on unmount.
///
/// Three patterns covered:
///
///   - `useHaptic()`          → returns a stable callback to
///     fire one ad-hoc intent. Use inside event handlers.
///   - `useHapticOnChange(v)` → fires when a tracked value
///     transitions. Use for "the success state just flipped to
///     true" or "the selected tab id changed."
///   - `useHapticOnVisible()` → fires once when a ref'd
///     element scrolls into the viewport. Use for hero CTAs
///     that should pulse when they first come into view.
///   - `useHapticAtAnimationEnd()` → fires on the matching
///     `animationend` / `transitionend` event. Use to sync a
///     haptic with the visual finale of a CSS animation.
///
/// All hooks no-op cleanly when haptics are disabled in
/// Settings, when the user prefers reduced motion, or when the
/// underlying device has no haptic hardware. Consumers don't
/// need to guard.

import { useCallback, useEffect, useRef } from "react";
import { fireHaptic, type HapticIntent } from "@/lib/haptics";

// ─── useHaptic ────────────────────────────────────────────────

/// Returns a stable callback that fires the given intent. The
/// returned function is referentially stable across re-renders
/// (memoised on `intent`), so it's safe to pass to children as
/// a prop or to `onClick` without breaking React.memo'd
/// downstream components.
///
/// Pass no argument to get the generic `(intent) => void`
/// dispatcher — useful when a single component fires several
/// different intents from different event handlers.
export function useHaptic(intent: HapticIntent): () => void;
export function useHaptic(): (intent: HapticIntent) => void;
export function useHaptic(intent?: HapticIntent) {
  return useCallback(
    (overrideIntent?: HapticIntent) => {
      const actual = (intent ?? overrideIntent) as HapticIntent | undefined;
      if (!actual) return;
      void fireHaptic(actual);
    },
    [intent],
  );
}

// ─── useHapticOnChange ────────────────────────────────────────

/// Fires the given intent every time the tracked value changes
/// (after the first render). Skips the initial mount so the
/// component doesn't buzz the user just for appearing — only
/// "things changed" triggers feedback.
///
/// Useful for:
///   - selected-tab changes (`selection`)
///   - completion-state flips (`notification-success`)
///   - streak counter increments (`streak-bump`)
export function useHapticOnChange<T>(
  value: T,
  intent: HapticIntent,
  options?: {
    /// When provided, only fires if the predicate returns true.
    /// Lets callers say "buzz when the count INCREASES, not on
    /// every change" without splitting their state.
    when?: (prev: T, next: T) => boolean;
    /// Skip the very first render even when the value is
    /// effectively a "transition" from undefined to its initial
    /// value. Defaults true. Set false when you want a haptic
    /// on mount (e.g. an unlock modal that appears with the
    /// value already in its post-unlock state).
    skipInitial?: boolean;
    /// Gate the haptic until the tracked data has loaded. While
    /// `ready` is false the baseline tracks the value but never
    /// buzzes, and the not-ready → ready transition is absorbed as
    /// the baseline — so async hydration on app load (a value going
    /// 0 → real once data loads) can't read as a change. Default true.
    ready?: boolean;
  },
): void {
  const prev = useRef<T>(value);
  const isFirst = useRef(true);
  const skipInitial = options?.skipInitial ?? true;
  const ready = options?.ready ?? true;
  const wasReady = useRef(ready);
  const when = options?.when;
  useEffect(() => {
    const becameReady = ready && !wasReady.current;
    wasReady.current = ready;
    if (isFirst.current) {
      isFirst.current = false;
      prev.current = value;
      if (skipInitial) return;
    }
    // Still loading, or data just finished loading this frame: keep
    // the baseline current and never fire.
    if (!ready || becameReady) {
      prev.current = value;
      return;
    }
    if (Object.is(prev.current, value)) return;
    const previous = prev.current;
    prev.current = value;
    if (when && !when(previous, value)) return;
    void fireHaptic(intent);
    // The intent string is part of the dependency list so a
    // dynamic intent (rare, but possible) re-binds correctly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, intent, ready]);
}

// ─── useHapticOnVisible ───────────────────────────────────────

/// Fires once when the referenced element first scrolls into
/// view. Useful for hero CTAs that should announce themselves
/// when the learner reaches them. Returns a ref to attach to
/// the target element.
///
/// Only fires ONCE per mount. The observer disconnects after
/// the first hit so a CTA can't re-fire on every scroll-in /
/// scroll-out cycle. To re-arm, unmount + remount the host
/// component (e.g. via a `key` change).
export function useHapticOnVisible<T extends HTMLElement>(
  intent: HapticIntent,
  options?: {
    /// IntersectionObserver `threshold`. 0.6 means "at least
    /// 60% of the element is visible before firing." Higher
    /// thresholds delay the haptic until the user has the
    /// element more comfortably in view; lower thresholds
    /// fire as soon as any part is visible.
    threshold?: number;
    /// Skip the haptic if the element is ALREADY in view on
    /// mount. Defaults true — we usually want the haptic only
    /// when the user scrolls TO the element, not when it
    /// happens to be on screen at mount. Set false for "fire
    /// when the page settles."
    skipInitiallyVisible?: boolean;
  },
): React.RefCallback<T> {
  const firedRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const mountedAt = useRef(Date.now());
  const threshold = options?.threshold ?? 0.6;
  const skipInitiallyVisible = options?.skipInitiallyVisible ?? true;

  return useCallback(
    (node: T | null) => {
      // Tear down any previous observer when the ref re-binds
      // (e.g. the parent re-rendered with a new element).
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!node || firedRef.current) return;
      if (typeof IntersectionObserver === "undefined") return;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            // First observation is synchronous-ish; if we're
            // within ~80ms of mount and the element is
            // visible, it was already on screen — skip per
            // the `skipInitiallyVisible` flag.
            if (
              skipInitiallyVisible &&
              Date.now() - mountedAt.current < 80
            ) {
              observer.disconnect();
              firedRef.current = true;
              return;
            }
            firedRef.current = true;
            void fireHaptic(intent);
            observer.disconnect();
            return;
          }
        },
        { threshold },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [intent, threshold, skipInitiallyVisible],
  );
}

// ─── useHapticAtAnimationEnd ──────────────────────────────────

/// Fires the given intent when an `animationend` or
/// `transitionend` event matching the optional name filter
/// reaches the referenced element. Useful for syncing a
/// haptic with the visual finale of a CSS animation — e.g.
/// fire `notification-success` exactly when the celebration's
/// last keyframe lands.
///
/// `animationName` filter: when provided, only events whose
/// `event.animationName` matches will trigger. Bare strings
/// match the @keyframes name; arrays match any of them.
/// `null` matches every animationend on the element.
export function useHapticAtAnimationEnd<T extends HTMLElement>(
  intent: HapticIntent,
  options?: {
    /// Filter on `event.animationName`. When null (default),
    /// every animationend on the element fires the haptic.
    animationName?: string | string[] | null;
    /// Also listen for `transitionend` events. When the
    /// `propertyName` matches, fires. Useful for CSS
    /// transitions that don't go through `@keyframes`.
    transitionPropertyName?: string | string[] | null;
  },
): React.RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      if (!node) return;
      const nameFilter = options?.animationName ?? null;
      const propFilter = options?.transitionPropertyName ?? null;

      const matches = (
        candidate: string,
        filter: string | string[] | null,
      ): boolean => {
        if (filter === null) return true;
        if (typeof filter === "string") return candidate === filter;
        return filter.includes(candidate);
      };

      const onAnimEnd = (ev: AnimationEvent) => {
        if (matches(ev.animationName, nameFilter)) {
          void fireHaptic(intent);
        }
      };
      const onTransEnd = (ev: TransitionEvent) => {
        if (propFilter !== null && matches(ev.propertyName, propFilter)) {
          void fireHaptic(intent);
        }
      };
      node.addEventListener("animationend", onAnimEnd);
      if (propFilter !== null) {
        node.addEventListener("transitionend", onTransEnd);
      }
      // No cleanup return — RefCallback fires once when the
      // ref attaches and again with null when it detaches.
      // The detach path runs through here with `node === null`
      // (handled at the top) so the addEventListener calls
      // bound to the old node go out of scope with the node.
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intent],
  );
}

// ─── Composite: tap-with-haptic ───────────────────────────────

/// Tiny composite for the most common pattern — "fire a tap
/// haptic in addition to whatever the click handler does." Wrap
/// your onClick to get the haptic without an extra line of body
/// in the component.
///
///   <button onClick={withHaptic(onClick)} />
///
/// The wrapped handler still receives the original event +
/// returns whatever the inner handler returns, so it's a drop-
/// in replacement.
export function withHaptic<E extends React.SyntheticEvent>(
  handler: ((ev: E) => void) | undefined,
  intent: HapticIntent = "tap",
): (ev: E) => void {
  return (ev: E) => {
    void fireHaptic(intent);
    handler?.(ev);
  };
}
