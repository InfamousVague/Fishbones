/// Cross-device sync applier plumbing — pins the two receive-side
/// contracts that regressed silently before:
///
///   1. `applySyncedWorkbench` must write to the SAME localStorage
///      slot `useWorkbenchFiles` reads (an earlier applier wrote a
///      dead `kata:workbench:v1:` prefix nothing read), with a
///      signature the reader accepts and last-write-wins against the
///      local save timestamp.
///
///   2. `applySettingRowsLocally` must round-trip settings rows into
///      localStorage, fold the locale into the live store, and raise
///      the suppression flag so the outbound bridge can't echo a
///      just-received row back to the relay.

import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { applySyncedWorkbench } from "@/hooks/useWorkbenchFiles";
import { useLocale } from "@/hooks/useLocale";
import {
  applySettingRowsLocally,
  isApplyingRemoteSettings,
} from "@/lib/settingsSync";
import { LOCALE_STORAGE_KEY } from "@/data/locales";

/// Must match useWorkbenchFiles' STORAGE_PREFIX for the default
/// profile (profileKey passes the key through unchanged).
const WORKBENCH_KEY = "libre:workbench:v1:course-1:lesson-1";

const FILES = [
  { name: "main.js", language: "javascript", content: "console.log(1);" },
  { name: "util.js", language: "javascript", content: "export const x = 1;" },
];

function readPayload(): {
  signature: string;
  files: Array<{ name: string; content: string }>;
  savedAt: number;
} | null {
  const raw = localStorage.getItem(WORKBENCH_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  localStorage.clear();
});

describe("applySyncedWorkbench", () => {
  it("writes the profile-scoped libre:workbench key with a filename-shape signature", () => {
    applySyncedWorkbench(
      "course-1",
      "lesson-1",
      JSON.stringify(FILES),
      "2026-07-01T10:00:00.000Z",
    );
    const payload = readPayload();
    expect(payload).not.toBeNull();
    // Signature = sorted filenames joined — what signatureOf(starter)
    // yields when the lesson shape matches, so the reader accepts it.
    expect(payload!.signature).toBe("main.js|util.js");
    expect(payload!.files).toEqual(FILES);
    expect(payload!.savedAt).toBe(Date.parse("2026-07-01T10:00:00.000Z"));
    // Nothing lands under the dead legacy prefix.
    expect(
      localStorage.getItem("kata:workbench:v1:course-1:lesson-1"),
    ).toBeNull();
  });

  it("applies last-write-wins: older or equal remote rows never clobber newer local saves", () => {
    const localSave = {
      signature: "main.js|util.js",
      files: [{ ...FILES[0], content: "console.log('newer local');" }, FILES[1]],
      savedAt: Date.parse("2026-07-01T12:00:00.000Z"),
    };
    localStorage.setItem(WORKBENCH_KEY, JSON.stringify(localSave));

    // Older remote row → dropped.
    applySyncedWorkbench(
      "course-1",
      "lesson-1",
      JSON.stringify(FILES),
      "2026-07-01T11:00:00.000Z",
    );
    expect(readPayload()!.files[0].content).toBe("console.log('newer local');");

    // Equal timestamp (our own echo) → local kept.
    applySyncedWorkbench(
      "course-1",
      "lesson-1",
      JSON.stringify(FILES),
      "2026-07-01T12:00:00.000Z",
    );
    expect(readPayload()!.files[0].content).toBe("console.log('newer local');");

    // Newer remote row → wins.
    applySyncedWorkbench(
      "course-1",
      "lesson-1",
      JSON.stringify(FILES),
      "2026-07-01T13:00:00.000Z",
    );
    expect(readPayload()!.files[0].content).toBe(FILES[0].content);
    expect(readPayload()!.savedAt).toBe(
      Date.parse("2026-07-01T13:00:00.000Z"),
    );
  });

  it("rejects malformed payloads instead of persisting garbage", () => {
    applySyncedWorkbench("course-1", "lesson-1", "not json", "2026-07-01T10:00:00.000Z");
    applySyncedWorkbench("course-1", "lesson-1", "[]", "2026-07-01T10:00:00.000Z");
    applySyncedWorkbench(
      "course-1",
      "lesson-1",
      JSON.stringify([{ name: "a.js" }]), // missing content/language
      "2026-07-01T10:00:00.000Z",
    );
    expect(readPayload()).toBeNull();
  });
});

describe("applySettingRowsLocally", () => {
  it("round-trips rows into localStorage and folds the locale into the live store", () => {
    const { result } = renderHook(() => useLocale());
    act(() => {
      applySettingRowsLocally([
        { key: "libre:some-pref", value: JSON.stringify({ a: 1 }) },
        { key: LOCALE_STORAGE_KEY, value: JSON.stringify("es") },
      ]);
    });
    expect(localStorage.getItem("libre:some-pref")).toBe(
      JSON.stringify({ a: 1 }),
    );
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(
      JSON.stringify("es"),
    );
    // The mounted consumer repainted without a reload — this is the
    // half the old bare `localStorage.setItem` applier was missing.
    expect(result.current[0]).toBe("es");
  });

  it("ignores unrecognised locale codes rather than applying garbage", () => {
    const { result } = renderHook(() => useLocale());
    act(() => {
      applySettingRowsLocally([
        { key: LOCALE_STORAGE_KEY, value: JSON.stringify("es") },
      ]);
    });
    expect(result.current[0]).toBe("es");
    act(() => {
      applySettingRowsLocally([
        { key: LOCALE_STORAGE_KEY, value: JSON.stringify("zz-not-a-locale") },
      ]);
    });
    // The raw value still lands in storage (generic round-trip — the
    // reader falls back defensively on next boot), but the live store
    // must not have accepted it.
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(
      JSON.stringify("zz-not-a-locale"),
    );
    expect(result.current[0]).toBe("es");
  });

  it("raises the suppression flag for the duration of the (synchronous) apply", () => {
    expect(isApplyingRemoteSettings()).toBe(false);
    let flagDuringDispatch: boolean | null = null;
    // A listener that fires synchronously mid-apply — stands in for
    // any store-notification chain that re-dispatches
    // libre:setting-changed while remote rows are being folded in.
    const probeKey = "libre:suppression-probe";
    const original = localStorage.setItem.bind(localStorage);
    const spy = (key: string, value: string) => {
      if (key === probeKey) flagDuringDispatch = isApplyingRemoteSettings();
      original(key, value);
    };
    localStorage.setItem = spy as typeof localStorage.setItem;
    try {
      applySettingRowsLocally([{ key: probeKey, value: "1" }]);
    } finally {
      localStorage.setItem = original;
    }
    expect(flagDuringDispatch).toBe(true);
    expect(isApplyingRemoteSettings()).toBe(false);
  });
});
