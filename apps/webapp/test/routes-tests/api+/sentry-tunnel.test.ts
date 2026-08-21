/**
 * The Sentry tunnel's destination must come from our configuration, never from
 * the request.
 *
 * This route performs a server-side `fetch`, so the question "who chooses the
 * host?" is the whole security property. It used to be the caller, which made
 * the endpoint an SSRF primitive: post an envelope naming any host and the
 * server would POST to it and return the response. The `protect` middleware
 * gated it behind a session, so it was never open to the world — but a session
 * is what a phished team member's attacker has, and there is no MFA here yet.
 *
 * Lives in `test/routes-tests/` rather than beside the route — see
 * `.claude/rules/no-test-files-in-app-routes.md`.
 *
 * @see {@link file://./../../../app/routes/api+/sentry-tunnel.ts}
 */

import { describe, expect, it } from "vitest";

import { resolveTunnelTarget } from "~/routes/api+/sentry-tunnel";

const OURS = "https://abc123@o456.ingest.sentry.io/789";
const OUR_ENVELOPE_URL = "https://o456.ingest.sentry.io/api/789/envelope/";

describe("resolveTunnelTarget", () => {
  it("forwards an envelope that matches our own DSN", () => {
    expect(resolveTunnelTarget(OURS, OURS)).toEqual({
      ok: true,
      url: OUR_ENVELOPE_URL,
    });
  });

  it("ignores the caller's DSN when building the URL", () => {
    // The comparison is a fast rejection, not the control. Even a DSN that
    // passes it must not be able to influence the destination — so a matching
    // host/project with different credentials still yields OUR url.
    const sameProjectDifferentKey = "https://zzz999@o456.ingest.sentry.io/789";
    expect(resolveTunnelTarget(sameProjectDifferentKey, OURS)).toEqual({
      ok: true,
      url: OUR_ENVELOPE_URL,
    });
  });

  describe("refuses to be an SSRF primitive", () => {
    it("rejects a DSN pointing at another host", () => {
      const result = resolveTunnelTarget(
        "https://key@evil.example.com/1",
        OURS
      );
      expect(result).toEqual({
        ok: false,
        status: 403,
        reason: "DSN does not match this app",
      });
    });

    it("rejects hosts only the server could reach", () => {
      // The payoff of an SSRF: cloud metadata and internal services.
      for (const host of [
        "169.254.169.254",
        "localhost",
        "127.0.0.1",
        "10.0.0.5",
        "postgres.internal",
      ]) {
        const result = resolveTunnelTarget(`https://key@${host}/789`, OURS);
        expect(result.ok, host).toBe(false);
      }
    });

    it("rejects a matching host with a different project", () => {
      const result = resolveTunnelTarget(
        "https://key@o456.ingest.sentry.io/999",
        OURS
      );
      expect(result.ok).toBe(false);
    });

    it("rejects a project id that is not purely numeric", () => {
      // Keeps path segments out of a string interpolated into a URL.
      for (const path of ["789/../../admin", "789%2f..", "abc", ""]) {
        const result = resolveTunnelTarget(
          `https://key@o456.ingest.sentry.io/${path}`,
          OURS
        );
        expect(result.ok, path).toBe(false);
      }
    });

    it("forwards nothing at all when Sentry is not configured", () => {
      // With no DSN set there is nothing legitimate to tunnel, so an
      // unconfigured deployment must not proxy at all. This is the live state
      // of production as of 2026-08-21.
      for (const configured of [undefined, "", "not-a-dsn"]) {
        expect(
          resolveTunnelTarget(OURS, configured),
          String(configured)
        ).toEqual({
          ok: false,
          status: 204,
          reason: "Sentry is not configured",
        });
      }
    });

    it("rejects a missing or unparseable claimed DSN", () => {
      for (const claimed of [undefined, "", "not-a-url"]) {
        const result = resolveTunnelTarget(claimed, OURS);
        expect(result).toEqual({
          ok: false,
          status: 400,
          reason: "Missing or malformed DSN",
        });
      }
    });
  });
});
