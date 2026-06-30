import "./AiCharacter.css";
import Hologram from "@/components/atoms/Hologram/Hologram";
import { useT } from "@/i18n/i18n";

interface Props {
  /// Whether the chat panel is open. Drives a subtle "pressed" pose so
  /// the button reads as toggle state rather than a static affordance.
  open: boolean;
  streaming: boolean;
  /// True while we're holding a "you just passed a lesson!" state.
  /// Wins over every state except the alert dot — a celebration
  /// outranks "panel just opened" but never cancels a hard error.
  celebrating?: boolean;
  /// Click handler. Toggles the chat panel open/closed. The parent
  /// owns panel state so the character can be triggered from other
  /// affordances too (e.g. a hint button on a failing test).
  onClick: () => void;
  /// When true, swap to the alert palette + render a small red dot.
  /// Used for "Ollama isn't reachable" / "model not installed".
  alert?: boolean;
}

/// Floating bottom-right entry point to the local AI tutor. A small
/// black disc with the universal "sparkles" AI glyph inside, wrapped
/// in a thin accent ring so the orb reads as a piece with the rest
/// of the chrome whichever theme is active.
///
/// Mood drives a CSS class on the wrapper for any future per-mood
/// outline tinting; the icon glyph itself stays identical across
/// moods.
///
/// Mood priority (top wins):
///   alert       → alert palette + alert dot
///   celebrating → warm gold/pink palette
///   streaming   → cyan/violet palette
///   idle        → neutral cool palette
export default function AiCharacter({
  open,
  streaming,
  celebrating,
  onClick,
  alert,
}: Props) {
  const t = useT();
  let mood: "idle" | "streaming" | "celebrating" | "alert";
  if (alert) mood = "alert";
  else if (celebrating) mood = "celebrating";
  else if (streaming) mood = "streaming";
  else mood = "idle";

  return (
    <button
      type="button"
      className={`libre-ai-character libre-ai-character--${mood} ${
        open ? "is-open" : ""
      }`}
      onClick={onClick}
      aria-label={open ? t("ai.closeAssistant") : t("ai.openAssistant")}
      aria-expanded={open}
      title={
        streaming
          ? t("ai.thinking")
          : alert
            ? t("ai.needsSetup")
            : open
              ? t("ai.closeAssistant")
              : t("ai.howCanIAssist")
      }
    >
      {/* "How can I assist?" tooltip floating to the LEFT of the orb.
          Hidden by default; revealed on hover via the CSS rule on the
          parent button. Mounted only when none of the state moods
          (open / streaming / alert / celebrating) would be telling a
          different story. aria-hidden because the button's aria-label
          already carries the canonical text for screen readers. */}
      {!open && !streaming && !alert && !celebrating && (
        <span className="libre-ai-character-tip" aria-hidden>
          {t("ai.howCanIAssist")}
        </span>
      )}
      {/* Liquid-metal chromatic ring wrapping the disc — ported
          from the paper-design liquid-metal demo's outline
          treatment. The original uses a WebGL shader for the
          flowing-metal effect inside the disc; we render the
          DEFINING piece — the chromatic ring around the disc —
          in pure CSS via a conic-gradient masked into a ring
          shape (see `__ring::before` in AiCharacter.css), and
          rotate it continuously to give the "liquid flowing
          around the orb" feel without bundling a shader runtime
          for a 40px corner button. Sits behind the disc in DOM
          order; `position: absolute` + negative inset on the
          element puts it slightly OUTSIDE the disc's bounds so
          the ring frames the orb rather than sitting inside it. */}
      <span className="libre-ai-character__ring" aria-hidden />

      {/* Disc inner — owns the circular clip + the hologram foil.
          Lives inside the button (so click + focus + the streaming
          scale pulse still apply to the whole orb) but clips with
          `overflow: hidden` so the foil only paints inside the
          disc shape. The button itself keeps overflow visible so
          the floating tooltip + the liquid-metal ring above can
          escape the disc edge. */}
      <span className="libre-ai-character__disc" aria-hidden>
        {/* Rainbow foil overlay. `surface="light"` uses the
            primitive's multiply blend mode — correct for the
            white disc base, where multiply soaks the rainbow in
            as DARK pigment (the same treatment the parchment
            cert ticket uses). `surface="dark"` would compose
            via plus-lighter, which on a white base saturates
            every channel to 1 and erases the rainbow entirely.
            `excited` flips on while the AI is thinking so the
            foil swings faster — visual echo of the existing
            scale-pulse. Sits below the icon glyph via z-index
            (icon span has `z-index: 1`). */}
        <Hologram
          surface="light"
          intensity="vivid"
          excited={streaming}
          sparkle="snake"
          className="libre-ai-character__holo"
        />
        {/* The greyscale `<img>` overlay used to live here, layered
            on top of the rainbow foil to give the orb a solid snake
            silhouette. Retired in favour of letting the Hologram
            itself BE the snake — see the
            `.libre-ai-character__holo` overrides in AiCharacter.css
            that force the snake mask to render as ONE big centered
            silhouette (mask-size: 100%, mask-repeat: no-repeat)
            instead of the primitive's default tiled sparkle. Net
            effect: the visible snake on the orb IS the rainbow
            (not a solid grey silhouette overlaid on it), which
            reads more "alive" against the white disc base. */}
      </span>
    </button>
  );
}
