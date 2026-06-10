/// Inline Ask AI selection popover — DOM behaviour. Verifies the
/// chip appears only for meaningful selections inside the lesson
/// body, and that clicking it dispatches `libre:ask-ai` with the
/// selection + lesson coordinates.

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AskAiSelectionPopover from "../AskAiSelectionPopover";

// jsdom's Range doesn't implement getBoundingClientRect at all
// (it's a layout API). Install one that returns a plausible box
// so the popover's "is the selection visible" check passes.
beforeEach(() => {
  Range.prototype.getBoundingClientRect = vi.fn(
    () =>
      ({
        x: 100,
        y: 200,
        left: 100,
        top: 200,
        right: 300,
        bottom: 220,
        width: 200,
        height: 20,
        toJSON: () => ({}),
      }) as DOMRect,
  );
});

/// Select the full text content of `el` and fire selectionchange.
async function selectInside(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  await act(async () => {
    document.dispatchEvent(new Event("selectionchange"));
    // The popover defers evaluation to rAF (setTimeout(16) in the
    // test polyfill) — flush it.
    await new Promise((r) => setTimeout(r, 40));
  });
}

function Harness({ bodyText }: { bodyText: string }) {
  return (
    <div>
      <div className="libre-reader-body">
        <p>{bodyText}</p>
      </div>
      <p data-testid="outside">outside the reader body entirely</p>
      <AskAiSelectionPopover
        courseId="rust-book"
        lessonId="borrowing"
        lessonTitle="References and Borrowing"
      />
    </div>
  );
}

describe("AskAiSelectionPopover", () => {
  it("shows the chip for a selection inside the body and dispatches the event on click", async () => {
    const { container } = render(
      <Harness bodyText="The borrow checker enforces ownership rules at compile time." />,
    );
    const body = container.querySelector(".libre-reader-body p")!;
    await selectInside(body as HTMLElement);

    const chip = document.querySelector(".libre-ask-selection-chip");
    expect(chip).not.toBeNull();

    const events: CustomEvent[] = [];
    const listener = (ev: Event) => events.push(ev as CustomEvent);
    window.addEventListener("libre:ask-ai", listener);
    await act(async () => {
      chip!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    window.removeEventListener("libre:ask-ai", listener);

    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({
      kind: "selection",
      courseId: "rust-book",
      lessonId: "borrowing",
      lessonTitle: "References and Borrowing",
    });
    expect(events[0].detail.text).toContain("borrow checker");
    // Chip dismissed after dispatch.
    expect(document.querySelector(".libre-ask-selection-chip")).toBeNull();
  });

  it("ignores selections outside the lesson body", async () => {
    const { getByTestId } = render(<Harness bodyText="body prose here" />);
    await selectInside(getByTestId("outside"));
    expect(document.querySelector(".libre-ask-selection-chip")).toBeNull();
  });

  it("ignores tiny selections (single double-clicked word)", async () => {
    const { container } = render(<Harness bodyText="short" />);
    const body = container.querySelector(".libre-reader-body p")!;
    await selectInside(body as HTMLElement);
    expect(document.querySelector(".libre-ask-selection-chip")).toBeNull();
  });
});
