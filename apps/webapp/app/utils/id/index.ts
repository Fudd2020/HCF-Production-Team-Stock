import { DEFAULT_CUID_LENGTH, LEGACY_CUID_LENGTH } from "../constants";

/**
 * Checks if a string is a valid QR id.
 *
 * QR id is a 10 character string
 * Legacy QR id is a 25 character string
 */
export function isQrId(id: string): boolean {
  const possibleLengths = [DEFAULT_CUID_LENGTH, LEGACY_CUID_LENGTH];
  const length = id.length;

  /**
   * The following conditions need to be met for the middleware to redirect to a QR code. In the rest of the cases, it just redirects to app root.
   * - The path should NOT include any special characters
   * - The path should start with a small letter
   * - The path should only have small letters and optional number
   * - The path's length should fit within the allowed character lengths(10 for new and 25 for legacy QR codes)
   */
  const regex = /^[a-z][a-z0-9]*$/;

  // Validate the ID against the criteria
  if (
    typeof id !== "string" ||
    !possibleLengths.includes(length) ||
    !regex.test(id)
  ) {
    return false;
  }

  return true;
}

export function hasNumber(str: string) {
  return /\d/.test(str);
}

/**
 * Generates a random client-side identifier that works in **insecure contexts**.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts (HTTPS or
 * `localhost`). Calling it over plain HTTP on a LAN address — e.g. testing on
 * a phone at `http://192.168.1.x:3000` — throws
 * `TypeError: crypto.randomUUID is not a function`. When that happens during
 * render it breaks hydration for the whole app, which surfaces as the
 * "Activating workspace..." spinner never resolving (see `_layout.tsx`, where
 * the app is gated on `useHydrated`).
 *
 * `crypto.getRandomValues()` has no secure-context requirement, so the first
 * fallback is still cryptographically sound; the last resort exists only so
 * this can never be the thing that throws.
 *
 * Use this anywhere the client needs a throwaway unique id (React keys, tab
 * ids, draft row ids). It is NOT for persisted database ids — those come from
 * cuid2 via `~/utils/id/id.server`.
 *
 * @returns A UUID v4 string, or a unique fallback id if no crypto API exists
 */
export function randomClientId(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    // Set the version (4) and variant (RFC 4122) bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `id-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
