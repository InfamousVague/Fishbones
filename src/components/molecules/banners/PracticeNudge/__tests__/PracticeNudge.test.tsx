import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PracticeNudge from "../PracticeNudge";

describe("PracticeNudge banner", () => {
  it("shows the due count and fires the practice callback", () => {
    const onPractice = vi.fn();
    const onDismiss = vi.fn();
    render(<PracticeNudge due={4} onPractice={onPractice} onDismiss={onDismiss} />);
    expect(screen.getByText("Welcome back!")).toBeTruthy();
    expect(screen.getByText(/4 lessons are ready/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Practice now" }));
    expect(onPractice).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("singular copy at due=1 and dismisses", () => {
    const onPractice = vi.fn();
    const onDismiss = vi.fn();
    render(<PracticeNudge due={1} onPractice={onPractice} onDismiss={onDismiss} />);
    expect(screen.getByText(/1 lesson is ready/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onPractice).not.toHaveBeenCalled();
  });
});
