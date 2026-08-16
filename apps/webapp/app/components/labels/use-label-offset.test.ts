/**
 * The printer-calibration store (US-003 AC3).
 *
 * What these cover is the class of failure this hook is most likely to produce:
 * a **silently wrong** calibration. Every bad input below has the same visible
 * symptom — the dialog looks calibrated — and a different printed result, which
 * is only discovered on paper. So each one is pinned to degrade to
 * "uncalibrated", which prints exactly what the geometry says.
 *
 * @see {@link file://./use-label-offset.ts}
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZERO_OFFSET } from "~/utils/label-sheets";

import { useLabelOffset } from "./use-label-offset";

const STORAGE_KEY = "shelf.labelPrinterOffset.v1";

/**
 * why: happy-dom in this config provides NO `localStorage` at all — verified,
 * `window.localStorage` is `undefined`. That is not a gap in the test setup to
 * work around silently: it is the same shape as a locked-down or
 * private-browsing browser, and the hook is written to survive it. So the stub
 * is installed deliberately per test, and one test below removes it again to
 * prove the absent case still works.
 */
function installStorageStub() {
  const store = new Map<string, string>();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

function removeStorage() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

beforeEach(() => {
  installStorageStub();
});

afterEach(() => {
  removeStorage();
});

describe("useLabelOffset", () => {
  it("starts uncalibrated when nothing is stored", () => {
    const { result } = renderHook(() => useLabelOffset());

    expect(result.current.offset).toEqual(ZERO_OFFSET);
  });

  it("restores a previously saved calibration", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ xMm: 1.5, yMm: -2 })
    );

    const { result } = renderHook(() => useLabelOffset());

    // AC3 — a printer's drift is a property of the printer, so it must survive
    // closing the dialog. Retyping it every time is what makes people stop
    // using the calibration at all.
    expect(result.current.offset).toEqual({ xMm: 1.5, yMm: -2 });
  });

  it("persists what it is given", () => {
    const { result } = renderHook(() => useLabelOffset());

    act(() => {
      result.current.setOffset({ xMm: 3, yMm: 1 });
    });

    expect(result.current.offset).toEqual({ xMm: 3, yMm: 1 });
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
    ).toEqual({ xMm: 3, yMm: 1 });
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a bare string", '"3mm"'],
    ["null", "null"],
    ["an array", "[1,2]"],
    ["a missing axis", '{"xMm":2}'],
    ["a string axis", '{"xMm":"2","yMm":0}'],
    ["NaN smuggled through", '{"xMm":null,"yMm":0}'],
  ])("degrades to uncalibrated for %s", (_label, stored) => {
    window.localStorage.setItem(STORAGE_KEY, stored);

    const { result } = renderHook(() => useLabelOffset());

    /**
     * This is user-writable storage: it may have been hand-edited, written by
     * an older build, or corrupted. Anything that is not two finite numbers
     * must read as "no calibration" — the alternative is `NaNmm` reaching the
     * CSS, which the browser drops, printing an uncalibrated sheet while the
     * field still shows a value.
     */
    expect(result.current.offset).toEqual(ZERO_OFFSET);
  });

  it("does not clamp — that belongs where the stationery is known", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ xMm: 500, yMm: 500 })
    );

    const { result } = renderHook(() => useLabelOffset());

    /**
     * Deliberate separation of concerns: the legal range depends on which
     * stationery is selected, which this hook knows nothing about. Clamping
     * here would bake in whichever format happened to be active when the value
     * was saved. `clampOffset` runs at the point of use, and again inside
     * `LabelSheet`.
     */
    expect(result.current.offset).toEqual({ xMm: 500, yMm: 500 });
  });
  it("survives a browser with NO localStorage at all", () => {
    removeStorage();

    /**
     * Private browsing, a locked-down profile, or storage disabled by policy.
     * The hook reads storage inside a `try`, so the whole feature degrades to
     * "uncalibrated" rather than throwing — and, critically, printing still
     * works. Someone unable to save a calibration must not be unable to print
     * a label.
     */
    const { result } = renderHook(() => useLabelOffset());

    expect(result.current.offset).toEqual(ZERO_OFFSET);
    expect(() => {
      act(() => {
        result.current.setOffset({ xMm: 2, yMm: 2 });
      });
    }).not.toThrow();
    // The offset still applies to THIS session even though it cannot persist.
    expect(result.current.offset).toEqual({ xMm: 2, yMm: 2 });
  });
});
