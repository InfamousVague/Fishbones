/// Regression test for the "Verify this course" crash (2026-07):
/// VerifyCourseOverlay called useTimeout AFTER the `!session` early
/// return, so the null → session transition rendered more hooks than
/// the previous render and React threw, taking down the whole app via
/// the root ErrorBoundary. The overlay must survive mounting with
/// session = null and then receiving a live session (and back).

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import VerifyCourseOverlay, {
  type VerifySessionView,
} from "../VerifyCourseOverlay";

const SESSION: VerifySessionView = {
  label: "Rust by Example",
  index: 1,
  total: 3,
  current: null,
  results: [],
  done: false,
};

describe("VerifyCourseOverlay", () => {
  it("survives the session null → non-null transition (hook order)", () => {
    const noop = () => {};
    const { rerender, container } = render(
      <VerifyCourseOverlay session={null} onCancel={noop} onClose={noop} />,
    );
    // Mounted with no session: renders nothing, but hooks still ran.
    expect(container.firstChild).toBeNull();

    // The transition that used to throw "Rendered more hooks than
    // during the previous render".
    expect(() =>
      rerender(
        <VerifyCourseOverlay session={SESSION} onCancel={noop} onClose={noop} />,
      ),
    ).not.toThrow();
    expect(container.firstChild).not.toBeNull();

    // And back to null (verify run closed) — still stable.
    expect(() =>
      rerender(
        <VerifyCourseOverlay session={null} onCancel={noop} onClose={noop} />,
      ),
    ).not.toThrow();
  });
});
