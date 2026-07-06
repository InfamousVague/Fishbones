/// The "welcome back" nudge round-trip, PracticeView side: `autoStart`
/// must kick a session as soon as the harvested deck passes the gate,
/// and exiting that auto-started session must fire `onAutoSessionExit`
/// (the host uses it to return the learner where they were).

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import PracticeView from "../PracticeView";
import type { Course } from "@/data/types";

/// Minimal course: one quiz lesson with 6 MCQs → 6 harvestable atoms
/// (past the GATE_MIN_ITEMS=5 gate) once the lesson is completed.
const QUIZ_COURSE = {
  id: "c1",
  title: "Fixture Course",
  language: "javascript",
  chapters: [
    {
      id: "ch1",
      title: "Chapter 1",
      lessons: [
        {
          id: "l1",
          kind: "quiz",
          title: "Quiz 1",
          body: "A real body so the summary-stub gate does not skip it.",
          questions: Array.from({ length: 6 }, (_, i) => ({
            kind: "mcq",
            prompt: `Q${i}: pick the answer`,
            options: ["right", "wrong-a", "wrong-b"],
            answer: 0,
            explanation: "because",
          })),
        },
      ],
    },
  ],
} as unknown as Course;

describe("PracticeView autoStart round-trip", () => {
  it("auto-starts a session and fires onAutoSessionExit on leave", async () => {
    const onAutoSessionExit = vi.fn();
    await act(async () => {
      render(
        <PracticeView
          courses={[QUIZ_COURSE]}
          completed={new Set(["c1:l1"])}
          autoStart
          onAutoSessionExit={onAutoSessionExit}
        />,
      );
    });
    // The session runner mounted instead of the dashboard.
    const exit = await screen.findByRole("button", { name: /exit|leave|close|back/i });
    expect(exit).toBeTruthy();
    await act(async () => {
      fireEvent.click(exit);
    });
    expect(onAutoSessionExit).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onAutoSessionExit for a manually started session", async () => {
    const onAutoSessionExit = vi.fn();
    await act(async () => {
      render(
        <PracticeView
          courses={[QUIZ_COURSE]}
          completed={new Set(["c1:l1"])}
          onAutoSessionExit={onAutoSessionExit}
        />,
      );
    });
    // Dashboard shows; start manually.
    const start = await screen.findByRole("button", { name: /^start$/i });
    await act(async () => {
      fireEvent.click(start);
    });
    const exit = await screen.findByRole("button", { name: /exit|leave|close|back/i });
    await act(async () => {
      fireEvent.click(exit);
    });
    expect(onAutoSessionExit).not.toHaveBeenCalled();
  });
});
