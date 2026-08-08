/**
 * Regression tests for {@link randomClientId}.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts (HTTPS or
 * `localhost`). Over plain HTTP on a LAN address — the normal way a phone
 * reaches a dev server, e.g. `http://192.168.1.234:3000` — it is `undefined`.
 * Calling it during render threw `TypeError: crypto.randomUUID is not a
 * function` inside `useTabId` → `<Toaster>`, which broke hydration for the
 * whole app and left every mobile user staring at the "Activating workspace..."
 * spinner forever.
 *
 * These tests pin the fallback chain by removing the APIs the way an insecure
 * context does, so the regression cannot come back silently.
 *
 * @see {@link file://./index.ts}
 * @see {@link file://./../../hooks/use-tab-id.ts} — the call site that broke
 */
import { randomClientId } from ".";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomClientId", () => {
  const realCrypto = globalThis.crypto;

  afterEach(() => {
    // why: tests replace the global crypto object to simulate an insecure
    // context; restore it so later suites see the real implementation.
    Object.defineProperty(globalThis, "crypto", {
      value: realCrypto,
      configurable: true,
      writable: true,
    });
  });

  /** Swap in a partial crypto implementation for the duration of a test. */
  function stubCrypto(value: unknown) {
    Object.defineProperty(globalThis, "crypto", {
      value,
      configurable: true,
      writable: true,
    });
  }

  it("returns a UUID when randomUUID is available (secure context)", () => {
    expect(randomClientId()).toMatch(UUID_V4);
  });

  it("does not throw when randomUUID is missing (insecure context)", () => {
    stubCrypto({
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });

    expect(() => randomClientId()).not.toThrow();
    expect(randomClientId()).toMatch(UUID_V4);
  });

  it("still returns an id when no crypto API exists at all", () => {
    stubCrypto(undefined);

    expect(() => randomClientId()).not.toThrow();
    expect(randomClientId().length).toBeGreaterThan(0);
  });

  it("returns unique values across calls in an insecure context", () => {
    stubCrypto({
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });

    const ids = new Set(Array.from({ length: 1_000 }, () => randomClientId()));
    expect(ids.size).toBe(1_000);
  });
});
