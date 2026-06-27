/// Co-working spectrum — how tightly the learner builds ALONGSIDE
/// the agent.
///
/// The same agent can deliver a finished project, narrate the build
/// as a tour, or stop and co-think at the load-bearing decisions.
/// This is the "refinement on creating projects and co-working with
/// AI" half of the brief: one dial that shifts the agent from a
/// vending machine into a pair-programmer that teaches.
///
/// Pure module — no React, no I/O. It owns the `PairMode` type, the
/// presentation metadata for the picker, and the system-prompt
/// fragment each mode injects. `settings.ts` re-exports the type +
/// clamp; `buildAgentSystemPrompt` appends `pairModeSection(mode)`.
///
/// Design constraint (the whole reason this is its own module): the
/// teaching modes ADD narration / a guiding question, but must NEVER
/// weaken the build loop itself — still tool calls (never inline
/// JSON), still split files, still run to a green
/// `run_sandbox_project`. A chatty agent that stalls before a green
/// run is worse than a terse one. The prompt fragments say so out
/// loud because a 7B local model will otherwise over-narrate and
/// drift off the build.

export type PairMode = "build-for-me" | "build-with-me" | "socratic";

/// Default leans into the product: this is a learn-to-code app, so
/// the agent teaches WHILE it builds out of the box. Users who just
/// want output flip to "build-for-me".
export const DEFAULT_PAIR_MODE: PairMode = "build-with-me";

/// Presentation metadata for the mode picker. Ordered hands-off →
/// hands-on so the control reads as a single "how involved do you
/// want to be?" dial. `icon` names map to base icon exports the UI
/// resolves.
export const PAIR_MODES: ReadonlyArray<{
  value: PairMode;
  label: string;
  blurb: string;
  icon: string;
}> = [
  {
    value: "build-for-me",
    label: "Build for me",
    blurb: "Hands-off. The agent builds it and hands you a finished, working project.",
    icon: "wand-sparkles",
  },
  {
    value: "build-with-me",
    label: "Build with me",
    blurb: "The agent builds it AND narrates the why of each step, then maps it to lessons.",
    icon: "users",
  },
  {
    value: "socratic",
    label: "Socratic",
    blurb: "The agent pauses at the key decisions and asks you to choose before it codes them.",
    icon: "messages-square",
  },
];

export function clampPairMode(v: unknown): PairMode {
  if (v === "build-for-me" || v === "build-with-me" || v === "socratic") {
    return v;
  }
  return DEFAULT_PAIR_MODE;
}

/// The system-prompt fragment for a mode, or `null` when the mode
/// needs no override (build-for-me === the base prompt's autonomous
/// act-first behaviour). Appended LAST among the behavioural
/// sections so it has final-word authority over the base prompt's
/// "zero preamble" rule.
export function pairModeSection(mode: PairMode): string | null {
  switch (mode) {
    case "build-with-me":
      return [
        "# Co-working mode: BUILD WITH ME",
        "",
        "The learner chose to LEARN as you build — they want to understand the project, not just receive it. This OVERRIDES the 'zero preamble' rule, but ONLY for short teaching notes. Everything else about the build is unchanged.",
        "",
        "What changes:",
        "",
        "- **Narrate the why, one line at a time.** After you write a file (or a load-bearing function within it), add ONE short sentence naming the concept it uses and why it's there — e.g. 'deck.js shuffles with Fisher-Yates so every ordering is equally likely.' Plain language, no lecture, no restating the code.",
        "- **Teach the load-bearing parts, skip the boilerplate.** Imports, scaffolding, and obvious glue need no note. Spend the narration budget on the 2-4 ideas that actually make the project work (the algorithm, the state model, the tricky borrow, the effect dependency).",
        "- **Point to the lessons at the end.** In your final wrap-up, tell the learner the 'How this was built' panel below the chat breaks down every concept and links the lessons that teach the ones that are new to them.",
        "",
        "What does NOT change — these still hold exactly as before:",
        "",
        "- Use the TOOL channel for every create / write / patch / run. NEVER inline JSON or pretend a code fence is a tool call.",
        "- Still split the build into small, single-concern files.",
        "- Still end with `run_sandbox_project` returning `{ ok: true }`. Narration NEVER substitutes for verifying — and never let it delay reaching a green run. A working build the learner understands beats a beautifully-narrated broken one.",
        "- Keep each teaching note to ONE sentence. If you feel a paragraph coming, cut it — the deep dive lives in the linked lessons, not the chat.",
      ].join("\n");

    case "socratic":
      return [
        "# Co-working mode: SOCRATIC",
        "",
        "The learner chose to CO-THINK, not just watch. At the build's most instructive decision, you stop and let THEM make the call before you code it. This OVERRIDES the 'act first, zero preamble' rule at exactly those decision points.",
        "",
        "How to run a Socratic build:",
        "",
        "- **Scaffold first, then ask at the fork.** Create the project and write the boilerplate without ceremony. When you reach the ONE genuinely instructive decision — the algorithm, the data model, the core trade-off — call `request_user_input` with a tight question and 2-3 concrete options. Example: 'How should we shuffle the deck? (a) sort by a random key — simple but subtly biased, (b) Fisher-Yates — the correct, uniform shuffle.'",
        "- **Ask at most once or twice per build.** You are still here to deliver a WORKING project, not to quiz the learner to exhaustion. Reserve the question(s) for the decision a learner would actually learn from. Everything else: just build it.",
        "- **Honour their answer, but be honest.** Build it the way they chose. If their pick has a real flaw, implement it but note the trade-off in one line (or, if it would break the build, explain why and offer the working alternative). Never silently override their choice.",
        "- **Then finish like normal.** After they answer, complete the build, add a one-line teaching note per load-bearing step (as in build-with-me), and run to a green `run_sandbox_project`.",
        "",
        "What does NOT change: tool channel for every mutation (never inline JSON), small single-concern files, and a verified green run before you declare done. The question is a teaching moment, not an excuse to leave the build unfinished.",
      ].join("\n");

    case "build-for-me":
    default:
      return null;
  }
}
