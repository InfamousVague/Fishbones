/// Reusable holographic-foil overlay. Wraps any container in a
/// rainbow-foil + diagonal-shine pair sized to inset:0 of the
/// parent, so the parent gets the same iridescent treatment the
/// CertificateTicket pioneered without each consumer hand-rolling
/// the gradient + sparkle mask machinery.
///
/// Usage:
///   1. Make the parent `position: relative` and `overflow:
///      hidden` (the overlay is absolutely positioned and would
///      otherwise spill).
///   2. Drop `<Hologram />` somewhere inside the parent.
///   3. Pass `surface="dark"` if the parent's bg is dark — that
///      switches the foil's blend mode from multiply (designed
///      for parchment) to plus-lighter (designed for dark
///      surfaces) so the rainbow remains visible.
///   4. The overlay never transforms its parent. Auto-animation
///      only changes the foil's background-position + opacity,
///      both inside the overlay's own absolute layer; the
///      parent's stacking context, layout, and Z-index are
///      untouched. Drop this on any card/button without worrying
///      about the parent visibly shifting.
///
/// The component accepts an optional `intensity` to dial the
/// resting foil opacity per surface — chrome wants subtle; cert
/// stamps want vivid. `ambient` toggles the drift loop on / off
/// (some surfaces only want the foil to wake on hover).

import "./Hologram.css";

interface HologramProps {
  /// Light parchment-style surfaces (cert tickets, paper-tinted
  /// stamps) want `multiply` so the rainbow reads as DARK
  /// pigment soaked into the surface. Dark chrome surfaces
  /// (achievement cards, dark CTAs) want `plus-lighter` so the
  /// foil reads as LIGHT additive sheen on top.
  /// Defaults to "dark" since that's the more common in-app
  /// surface (the cert ticket / mini banner each pass "light").
  surface?: "light" | "dark";

  /// Resting opacity tier:
  ///   "whisper" — barely-there iridescence (chrome, completion
  ///               glints). Good for surfaces where the foil is
  ///               supporting rather than the focal element.
  ///   "subtle"  — visible but quiet (default). Used by the cert
  ///               banner / stamp.
  ///   "vivid"   — prominent foil, the holo IS the surface
  ///               (achievement cards, completed stamps, run-
  ///               button accent).
  intensity?: "whisper" | "subtle" | "vivid";

  /// Whether to run the ambient breathe/drift loop. False = the
  /// foil sits at its resting position; consumers can drive it
  /// via :hover state or other custom keyframes if they want
  /// motion. Defaults true.
  ambient?: boolean;

  /// Boosted state — when true the foil swings faster + harder,
  /// with two overlapping sine-like loops on the foil layer that
  /// don't lock into a steady beat. Designed to read as "live /
  /// excited / something's happening." The sidebar's chapter
  /// grid switches this on while a lesson run is executing so
  /// the completed cells feel alive in sync with the work the
  /// learner just kicked off.
  ///
  /// `excited` overrides `ambient` while it's true — there's no
  /// reason to also keep the slow drift loop running underneath.
  /// Falling out of excited mode reverts to the previous ambient
  /// state with no flash because both animation systems share
  /// the same registered `--libre-holo-h` / `--libre-holo-p`
  /// custom properties.
  excited?: boolean;

  /// Optional extra class on the wrapper for consumer-side
  /// tweaks (border-radius matching, custom blend mode, etc.).
  className?: string;

  /// Sparkle stencil. The Hologram tiles a small SVG-or-PNG
  /// shape via `mask-image` so the rainbow shows through only
  /// where the stencil is opaque — that's where the "iridescent
  /// dust" look comes from. Default is `star` (a four-pointed
  /// star geometrically tuned to tile cleanly at any size).
  /// Set to `snake` to swap in the greyscale brand mark
  /// (`/new-logo-tile.png`) — looks great at medium-to-large
  /// surfaces (~40px+) where the silhouette is recognisable;
  /// reads as soft blobs at the hairline sizes the sandbox
  /// accent strips use, so consider keeping `star` for those.
  sparkle?: "star" | "snake";

  /// Sparkle tile size. Controls how big each rainbow-glyph
  /// instance renders inside the foil — applied as a fixed-
  /// pixel `mask-size` (so cells stay square regardless of the
  /// wrapper's aspect ratio).
  ///
  ///   `xxs` — 10px tiles. Nav-rail pills, status chips,
  ///                       anywhere the silhouette needs to be
  ///                       a tiny brand-mark dot rather than
  ///                       a readable shape.
  ///   `xs`  — 14px tiles. Accent strips, lesson Next button,
  ///                       tight chrome where the snake should
  ///                       feel like background texture.
  ///   `sm`  — 22px tiles. Editor run button, small toggles.
  ///   `md`  — 36px tiles. Default. AI orb, achievement badge,
  ///                       cert stamp.
  ///   `lg`  — 56px tiles. Full-width cert ticket, hero cards.
  ///   `xl`  — 88px tiles. Wallpaper-scale surfaces (capstone
  ///                       celebration cards, etc.).
  ///
  /// Consumers can still override via their own CSS for cases
  /// the tier doesn't cover; the sandbox hairline strips do
  /// this with an `!important` 4×4px mask to force tiny dots.
  size?: "xxs" | "xs" | "sm" | "md" | "lg" | "xl";
}

export default function Hologram({
  surface = "dark",
  intensity = "subtle",
  ambient = true,
  excited = false,
  className,
  sparkle = "star",
  size = "md",
}: HologramProps) {
  const classes = [
    "libre-holo",
    `libre-holo--${surface}`,
    `libre-holo--${intensity}`,
    // `excited` is checked first — when on it owns the animation,
    // and we drop the `--ambient` class so the slow drift doesn't
    // try to also animate the same custom property.
    excited
      ? "libre-holo--excited"
      : ambient
        ? "libre-holo--ambient"
        : "",
    // Sparkle-stencil opt-in. `star` is the default geometry the
    // primitive ships with — no class needed. `snake` swaps
    // the mask source via a sibling modifier; see Hologram.css.
    sparkle !== "star" ? `libre-holo--sparkle-${sparkle}` : "",
    // Tile-size tier. Always emitted (even for `md`) so consumer
    // rules can target a specific tier via `.libre-holo--size-md`
    // when they need finer-grained overrides than `!important`.
    `libre-holo--size-${size}`,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} aria-hidden>
      <span className="libre-holo__foil" />
      <span className="libre-holo__shine" />
    </span>
  );
}
