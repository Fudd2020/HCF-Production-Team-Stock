import { SENTRY_DSN } from "~/utils/env";
import type { Route } from "./+types/sentry-tunnel";

/**
 * Sentry tunnel endpoint.
 *
 * Proxies Sentry event envelopes through our own domain so they aren't blocked
 * by ad-blockers or browser tracking protection (e.g. Firefox Enhanced Tracking
 * Protection).
 *
 * ## Why this validates the DSN
 *
 * A tunnel is a server-side fetch whose target used to be read straight out of
 * the request body: the envelope's header line carries a `dsn`, and the previous
 * version parsed the hostname and project id out of it and `fetch`ed them. That
 * is a **server-side request forgery** primitive — post an envelope naming any
 * host and the server issues a POST to it and hands back the response, reaching
 * things only the server can reach (cloud metadata, the database host, anything
 * on the private network).
 *
 * The `protect` middleware does gate this route, so it took a valid session
 * rather than being open to the world — defence in depth, not an open door. It
 * is still worth closing: a session is exactly what an attacker who has phished
 * one team member has, and there is no MFA on this deployment yet.
 *
 * The destination is now derived **entirely from our own `SENTRY_DSN`**. The
 * claimed DSN is compared against it and then discarded; the URL is rebuilt from
 * the configured values, so even a hole in the comparison cannot redirect the
 * request. With no DSN configured there is nothing legitimate to forward, and
 * the route accepts and drops instead of proxying.
 *
 * @see https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 * @see {@link file://./../../entry.client.tsx} — sets `tunnel: "/api/sentry-tunnel"`
 */

/**
 * Envelopes are error reports, not uploads. A generous ceiling that still stops
 * the endpoint being used as a bulk proxy for someone else's traffic.
 */
export const MAX_ENVELOPE_BYTES = 1_000_000;

/** Where an envelope is allowed to go, taken from our own configuration. */
type SentryDestination = { host: string; projectId: string };

/**
 * Parses a Sentry DSN into the only two parts a tunnel needs.
 *
 * @param dsn - a DSN string, from config or from an envelope header
 * @returns the host and project id, or `null` when it isn't a usable DSN
 */
function parseDsn(dsn: string | undefined): SentryDestination | null {
  if (!dsn) {
    return null;
  }

  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");

    // Project ids are numeric. Rejecting anything else keeps path segments
    // (`123/../../admin`) out of a string that gets interpolated into a URL.
    if (!url.hostname || !/^\d+$/.test(projectId)) {
      return null;
    }

    return { host: url.hostname, projectId };
  } catch {
    return null;
  }
}

/** What the tunnel should do with an envelope. */
export type TunnelDecision =
  | { ok: true; url: string }
  | { ok: false; status: number; reason: string };

/**
 * Decides where — if anywhere — an envelope may be forwarded.
 *
 * Pure and exported so the security property can be tested directly rather than
 * inferred from the handler.
 *
 * @param claimedDsn - the `dsn` from the envelope header (untrusted)
 * @param configuredDsn - our own `SENTRY_DSN` (trusted)
 * @returns the URL to POST to, or the status and reason to refuse with
 */
export function resolveTunnelTarget(
  claimedDsn: string | undefined,
  configuredDsn: string | undefined
): TunnelDecision {
  const destination = parseDsn(configuredDsn);

  if (!destination) {
    // Sentry isn't set up, so nothing legitimate is being tunnelled. Refusing
    // here is what stops an unconfigured deployment being an open proxy.
    return { ok: false, status: 204, reason: "Sentry is not configured" };
  }

  const claimed = parseDsn(claimedDsn);

  if (!claimed) {
    return { ok: false, status: 400, reason: "Missing or malformed DSN" };
  }

  if (
    claimed.host !== destination.host ||
    claimed.projectId !== destination.projectId
  ) {
    return { ok: false, status: 403, reason: "DSN does not match this app" };
  }

  // Built from OUR values, never the caller's — the comparison above is a
  // fast rejection, not the control.
  return {
    ok: true,
    url: `https://${destination.host}/api/${destination.projectId}/envelope/`,
  };
}

export async function action({ request }: Route.ActionArgs) {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_ENVELOPE_BYTES) {
      return new Response("Envelope too large", { status: 413 });
    }

    const envelopeBytes = await request.arrayBuffer();
    if (envelopeBytes.byteLength > MAX_ENVELOPE_BYTES) {
      return new Response("Envelope too large", { status: 413 });
    }

    const envelope = new TextDecoder().decode(envelopeBytes);

    // The first line of the envelope is a JSON header containing the DSN.
    const header = envelope.split("\n")[0];
    const claimedDsn = JSON.parse(header).dsn as string | undefined;

    const target = resolveTunnelTarget(claimedDsn, SENTRY_DSN);

    if (!target.ok) {
      // 204 carries no body by spec; the others say why.
      return target.status === 204
        ? new Response(null, { status: 204 })
        : new Response(target.reason, { status: target.status });
    }

    const sentryResponse = await fetch(target.url, {
      method: "POST",
      body: envelopeBytes,
      headers: {
        "Content-Type": "application/x-sentry-envelope",
      },
    });

    return new Response(sentryResponse.body, {
      status: sentryResponse.status,
      headers: {
        "Content-Type":
          sentryResponse.headers.get("Content-Type") ||
          "application/x-sentry-envelope",
      },
    });
  } catch {
    return new Response("Invalid envelope", { status: 400 });
  }
}
