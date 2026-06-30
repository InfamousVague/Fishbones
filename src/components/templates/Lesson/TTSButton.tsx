/// Combined "lesson reading meta" pill.
///
/// One control surface that absorbs three previously-separate pieces:
///   - the "X min read" / "X min left" reading-time text
///   - the play / pause toggle
///   - a circular progress ring around the play/pause icon that
///     visualizes audio playback position
///
/// Three rendering states:
///   1. **No audio for this lesson (manifest miss).** Pill shows just
///      the reading-time estimate ("4 min read") next to a static
///      clock icon. No click behaviour — the lesson hasn't been
///      narrated. Mounts in lieu of the old meta-time `<div>`.
///   2. **Audio available, idle.** Play icon inside an empty progress
///      ring; reading-time estimate as the label. Tap → starts
///      playback. The instant `loadedmetadata` fires the label
///      switches from "4 min read" to "M:SS" (full duration).
///   3. **Audio playing or paused mid-track.** Pause / play icon
///      inside a progress ring filled to `progress`; label reads
///      "M:SS left". Tap toggles.
///
/// Keeps the meta row from becoming a row of three small chips —
/// learner has one obvious target.

import { Icon } from "@base/primitives/icon";
import { volume2 } from "@base/primitives/icon/icons/volume-2";
import { play as playIcon } from "@base/primitives/icon/icons/play";
import { pause as pauseIcon } from "@base/primitives/icon/icons/pause";
import { loader } from "@base/primitives/icon/icons/loader";
import { clock as clockIcon } from "@base/primitives/icon/icons/clock";
import { useLessonAudio } from "@/hooks/useLessonAudio";
import "./TTSButton.css";

interface Props {
  /// Course this lesson belongs to. Required: the audio manifest is
  /// keyed by `courseId/lessonId` so two courses sharing a bare
  /// lesson id (every Exercism track reuses canonical slugs) resolve
  /// to the right narration.
  courseId: string;
  lessonId: string;
  /// Pre-audio fallback label, e.g. the lesson's word-count-derived
  /// "X min read" estimate. Shown when no audio is available, and
  /// before audio metadata has loaded so the user has a sense of
  /// duration immediately.
  estimatedReadMinutes?: number;
  /// Optional className passthrough for parent-scoped styling.
  className?: string;
}

/// Format a number of seconds as "M:SS" — clamps NaN / negatives
/// to "0:00" so the label never flashes garbage during the
/// metadata-loading window.
function fmtTime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TTSButton({
  courseId,
  lessonId,
  estimatedReadMinutes,
  className,
}: Props) {
  // Single narration source: the ElevenLabs MP3s served from the
  // CDN, looked up via `${TTS_CDN_BASE}/manifest.json`. Lessons not
  // in the manifest render the static "X min read" chip below — we
  // intentionally don't fall back to the Web Speech API, because the
  // platform voices (Siri on Apple, system voices elsewhere) read as
  // a regression next to the uploaded ElevenLabs voice.
  const audio = useLessonAudio(courseId, lessonId);

  // No narration source available AND no reading-time hint — render
  // nothing. With reading-time, a static chip stands in so the meta
  // strip isn't an awkward empty pocket.
  if (!audio.available) {
    if (typeof estimatedReadMinutes === "number" && estimatedReadMinutes > 0) {
      return (
        <span
          className={`libre-tts-pill libre-tts-pill--static${
            className ? ` ${className}` : ""
          }`}
          aria-label={`${estimatedReadMinutes} minute read`}
        >
          <Icon icon={clockIcon} size="xs" color="currentColor" />
          <span className="libre-tts-pill__text">
            {estimatedReadMinutes} min read
          </span>
        </span>
      );
    }
    return null;
  }

  // Audio path. Pick the icon + spoken label based on state.
  const idle = !audio.isActive || (!audio.isPlaying && audio.currentSec === 0);
  const icon = audio.isLoading
    ? loader
    : audio.isPlaying
      ? pauseIcon
      : idle
        ? volume2
        : playIcon;

  // Label preference order:
  //   - playing or scrubbed mid-track → "M:SS left"
  //   - idle, audio metadata loaded   → "M:SS" (full duration)
  //   - idle, no metadata yet         → "X min read" fallback
  let label: string;
  if (audio.isLoading) {
    label = "Loading";
  } else if (!idle && audio.remainingSec != null) {
    label = `${fmtTime(audio.remainingSec)} left`;
  } else if (idle && audio.durationSec != null) {
    label = fmtTime(audio.durationSec);
  } else if (typeof estimatedReadMinutes === "number" && estimatedReadMinutes > 0) {
    label = `${estimatedReadMinutes} min read`;
  } else {
    label = "Listen";
  }

  // Progress-ring SVG geometry. r = 13 with stroke-width 2 fits
  // inside a 32px square with breathing room. circumference = 2πr ≈
  // 81.68; stroke-dashoffset goes from `circumference` (empty) →
  // `0` (full) as `progress` rises.
  const RADIUS = 13;
  const CIRC = 2 * Math.PI * RADIUS;
  const offset = CIRC * (1 - audio.progress);

  const ariaLabel = audio.isPlaying
    ? `Pause narration, ${fmtTime(audio.remainingSec)} left`
    : audio.isLoading
      ? "Loading narration"
      : idle
        ? "Play narration"
        : `Resume narration, ${fmtTime(audio.remainingSec)} left`;

  return (
    <button
      type="button"
      className={`libre-tts-pill${audio.isPlaying ? " libre-tts-pill--playing" : ""}${
        audio.isLoading ? " libre-tts-pill--loading" : ""
      }${idle ? "" : " libre-tts-pill--mid"}${className ? ` ${className}` : ""}`}
      onClick={audio.toggle}
      aria-label={ariaLabel}
      aria-pressed={audio.isPlaying}
      title={ariaLabel}
    >
      {/* Progress ring — wraps the play/pause icon. Two stacked
          circles: a faint track + a foreground arc proportional to
          progress. Rotated -90° via CSS so the arc grows from 12
          o'clock clockwise. */}
      <span className="libre-tts-pill__ring" aria-hidden>
        <svg viewBox="0 0 32 32" width="32" height="32" className="libre-tts-pill__ring-svg">
          <circle
            cx="16"
            cy="16"
            r={RADIUS}
            className="libre-tts-pill__ring-track"
            fill="none"
            strokeWidth={2}
          />
          <circle
            cx="16"
            cy="16"
            r={RADIUS}
            className="libre-tts-pill__ring-fill"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
          />
        </svg>
        {/* Center icon. The play / pause / loader / volume glyph
            sits absolutely centered over the SVG ring. `xs` matches
            the static variant + the Glossary chip's icon size — the
            playable pill is now chip-sized rather than its prior
            32×32-ring affordance, so the icon scales accordingly. */}
        <span className="libre-tts-pill__icon">
          <Icon icon={icon} size="xs" color="currentColor" />
        </span>
      </span>
      <span className="libre-tts-pill__text">{label}</span>
    </button>
  );
}
