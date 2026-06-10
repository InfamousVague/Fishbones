/// Interlocking-gears spinner — the "code is running" animation.
///
/// Two meshed gears built from the same tooth module so their teeth
/// genuinely interleave at the contact point: gear A (10 teeth) and
/// gear B (7 teeth) share a tooth pitch, sit exactly pitch-radius +
/// pitch-radius apart, and counter-rotate with periods in the 10:7
/// gear ratio — so the mesh stays believable over a full cycle
/// instead of clipping through.
///
/// Geometry is generated once at module load (deterministic math,
/// no per-render cost). Colours ride `currentColor` so the spinner
/// inherits whatever text tone its host sets; rotation pauses under
/// `prefers-reduced-motion` (CSS).

import "./GearSpinner.css";

/// Build a stylized involute-ish gear outline: `teeth` trapezoidal
/// teeth around a root circle, with a punched centre hole (rendered
/// via fill-rule evenodd). Returns an SVG path string centred on
/// (0,0) so callers position it with a transform.
function gearPath(
  teeth: number,
  rootR: number,
  tipR: number,
  holeR: number,
): string {
  const step = (Math.PI * 2) / teeth;
  // Tooth tip ~32% of the pitch, flanks 10% each side → valley
  // ~48% at the root. Tips strictly narrower than valleys is what
  // lets the two gears' teeth physically interleave at the contact
  // point instead of clipping through each other.
  const tipHalf = step * 0.16;
  const flank = step * 0.1;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const v0 = a - step / 2 + flank; // valley end before this tooth
    const t0 = a - tipHalf; // tooth tip start
    const t1 = a + tipHalf; // tooth tip end
    const v1 = a + step / 2 - flank; // valley start after this tooth
    const cmd = i === 0 ? "M" : "L";
    pts.push(
      `${cmd}${(Math.cos(v0) * rootR).toFixed(2)},${(Math.sin(v0) * rootR).toFixed(2)}`,
      `L${(Math.cos(t0) * tipR).toFixed(2)},${(Math.sin(t0) * tipR).toFixed(2)}`,
      `L${(Math.cos(t1) * tipR).toFixed(2)},${(Math.sin(t1) * tipR).toFixed(2)}`,
      `L${(Math.cos(v1) * rootR).toFixed(2)},${(Math.sin(v1) * rootR).toFixed(2)}`,
    );
  }
  pts.push("Z");
  // Centre hole (counter-clockwise so evenodd punches it out).
  pts.push(
    `M${holeR},0`,
    `A${holeR},${holeR} 0 1 0 ${-holeR},0`,
    `A${holeR},${holeR} 0 1 0 ${holeR},0`,
    "Z",
  );
  return pts.join(" ");
}

/// Shared tooth module m: pitch radius = m * teeth / 2. m = 3.4
/// keeps the pair compact inside an ~88px square.
const M = 3.4;
const TEETH_A = 10;
const TEETH_B = 7;
const PITCH_A = (M * TEETH_A) / 2; // 17
const PITCH_B = (M * TEETH_B) / 2; // 11.9
/// Tooth extends ±2.6 around the pitch circle — tips of one gear
/// reach into the valleys of the other across the contact point.
const PATH_A = gearPath(TEETH_A, PITCH_A - 2.6, PITCH_A + 2.6, 5.4);
const PATH_B = gearPath(TEETH_B, PITCH_B - 2.6, PITCH_B + 2.6, 3.8);

/// Centres sit exactly the sum of pitch radii apart, along a -32°
/// diagonal so the pair reads dynamic rather than side-by-side.
const DIST = PITCH_A + PITCH_B; // 28.9
const ANGLE_DEG = -32;
const ANGLE = (ANGLE_DEG * Math.PI) / 180;
const AX = 33;
const AY = 41;
const BX = AX + Math.cos(ANGLE) * DIST; // ≈ 57.5
const BY = AY + Math.sin(ANGLE) * DIST; // ≈ 25.7

/// Static phase alignment so the mesh is exact at t=0 (and stays
/// exact — the animation periods are locked to the 10:7 gear
/// ratio): rotate A so a TOOTH centre lies on the line of centres,
/// and B so a VALLEY centre faces it from the other side.
const STEP_A_DEG = 360 / TEETH_A; // 36
const STEP_B_DEG = 360 / TEETH_B; // ≈ 51.43
/// A: nearest tooth multiple to -32° is -36° → rotate +4°.
const PHASE_A =
  ANGLE_DEG - STEP_A_DEG * Math.round(ANGLE_DEG / STEP_A_DEG);
/// B: the contact direction seen from B is ANGLE+180 = 148°; valley
/// centres live at phase + step/2 + k·step → phase ≈ 19.43°.
const B_CONTACT = ANGLE_DEG + 180;
const PHASE_B = (() => {
  const raw = B_CONTACT - STEP_B_DEG / 2;
  return raw - STEP_B_DEG * Math.round(raw / STEP_B_DEG);
})();

export default function GearSpinner({ size = 88 }: { size?: number }) {
  // Structure note: the POSITIONING translate lives on an outer <g>
  // (SVG attribute) and the ROTATION animation on an inner <g> (CSS
  // transform) — putting both on one element doesn't work because
  // the CSS animation's `transform` overrides the attribute. The
  // inner group rotates around `transform-box: fill-box; center`
  // (see CSS); the invisible bounding circle makes each group's
  // bbox perfectly symmetric so that centre IS the gear's axle —
  // without it the tooth layout skews the bbox and the gear wobbles.
  return (
    <svg
      className="libre-gear-spinner"
      viewBox="0 0 88 66"
      width={size}
      height={(size * 66) / 88}
      aria-hidden
    >
      <g transform={`translate(${AX} ${AY}) rotate(${PHASE_A.toFixed(2)})`}>
        <g className="libre-gear-spinner__a">
          <circle r={PITCH_A + 2.6} fill="none" stroke="none" />
          <path d={PATH_A} fillRule="evenodd" />
        </g>
      </g>
      <g
        transform={`translate(${BX.toFixed(2)} ${BY.toFixed(2)}) rotate(${PHASE_B.toFixed(2)})`}
      >
        <g className="libre-gear-spinner__b">
          <circle r={PITCH_B + 2.6} fill="none" stroke="none" />
          <path d={PATH_B} fillRule="evenodd" />
        </g>
      </g>
    </svg>
  );
}
