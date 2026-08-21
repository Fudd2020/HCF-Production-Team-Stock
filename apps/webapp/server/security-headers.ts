/**
 * Security response headers
 *
 * Defines the baseline set of HTTP security headers applied to *every* response
 * the webapp emits — HTML documents, single-fetch `.data` requests, static
 * assets, redirects and error responses alike.
 *
 * The middleware is registered through react-router-hono-server's `beforeAll`
 * hook (see {@link file://./index.ts}). `beforeAll` runs *before* the
 * framework's `serveStatic` handlers and before the app's `configure`
 * middleware (incl. `protect`), so its `await next()` wraps the entire request
 * pipeline. That makes it the single choke point that can decorate
 * static-asset responses — which short-circuit at `serveStatic` and never reach
 * `configure` — as well as dynamic ones. (A per-route `headers` export or
 * `entry.server.tsx` only sees document/loader responses, not static or error
 * responses, which is why neither is used here.)
 *
 * Header choices:
 * - `Strict-Transport-Security` is sent ONLY for the canonical app host
 *   (the host of `SERVER_URL`) and ONLY over HTTPS (detected via the
 *   `x-forwarded-proto` header set by the Cloudflare/Fly proxy layer). This is
 *   deliberately narrow: the same Hono server also answers for the
 *   URL-shortener host (`process.env.URL_SHORTENER`, handled in
 *   {@link file://./index.ts}), and for raw platform hosts (e.g. `*.fly.dev`)
 *   and http health checks. Emitting `includeSubDomains` on any of those would
 *   pin a domain we don't intend to. `preload` is intentionally deferred — it's
 *   a hard-to-reverse commitment.
 * - `Content-Security-Policy` ships in **two headers, on purpose**. The
 *   enforcing header carries only directives that cannot break this app (see
 *   {@link CONTENT_SECURITY_POLICY}); the Report-Only header carries the
 *   directives still under observation, above all `script-src`, which needs
 *   per-request nonces in `entry.server.tsx` before it can be enforced without
 *   killing React Router's inline hydration scripts (see
 *   {@link CSP_OBSERVATION_DIRECTIVES}). Splitting them means the app gets real
 *   CSP protection today instead of waiting on the nonce work.
 *   `X-Frame-Options: DENY` is kept alongside `frame-ancestors` for older
 *   browsers that do not implement the latter.
 * - `Reporting-Endpoints` names the collector the Report-Only policy sends to.
 *   Both it and the Report-Only header are emitted **only** when a Sentry DSN
 *   is configured — see {@link buildReportOnlyPolicy} for why shipping an
 *   unreportable Report-Only policy is worse than shipping none.
 * - `Permissions-Policy` denies sensitive features the app doesn't use but
 *   explicitly allows `camera=(self)` (the QR/barcode scanner —
 *   `~/components/scanner/code-scanner`) and `geolocation=(self)` (GPS
 *   coordinates form + the public QR scan-location flow). `autoplay=(self)` is
 *   kept allowed because the subscription-success modal autoplays a
 *   same-origin video (`~/components/subscription/successful-subscription-modal`).
 *
 * @see {@link file://./index.ts} — registration via `beforeAll`
 * @see {@link file://./middleware.ts} — the `cache()` middleware whose
 *   set-headers-after-`next()` idiom this follows
 */
import { createMiddleware } from "hono/factory";

/**
 * Restrictive Permissions-Policy (alphabetised for readability).
 *
 * `=()` fully denies a feature; `=(self)` allows it for same-origin only.
 * Only `autoplay`, `camera` and `geolocation` are allowed (each is in active
 * use in the webapp); everything else listed is denied. Features not listed
 * keep the browser default — that's acceptable for low-risk ones, and we
 * explicitly deny the sensitive sensors/payment/usb surfaces.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=(self)",
  "browsing-topics=()",
  "camera=(self)",
  "geolocation=(self)",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

/**
 * The **enforced** Content-Security-Policy.
 *
 * Every directive here was chosen because it cannot break this application,
 * which is what makes enforcing them safe without the nonce work first. A CSP
 * only restricts what it names — nothing sets `default-src`, so anything not
 * listed below is left entirely alone.
 *
 * - `frame-ancestors 'none'` — nobody may frame us. The modern equivalent of
 *   the `X-Frame-Options: DENY` we already send, and it was previously
 *   Report-Only, meaning it enforced **nothing**.
 * - `base-uri 'none'` — an injected `<base href>` silently repoints every
 *   relative URL on the page, including script `src`s. The app has no `<base>`
 *   tag, so denying it outright costs nothing.
 * - `object-src 'none'` — no `<object>`/`<embed>`/plugin content. Unused here,
 *   and a classic bypass when only `script-src` is locked down.
 * - `form-action 'self'` — forms may only post back to us, which stops an
 *   injected form exfiltrating to an attacker's host. Verified safe: SSO is
 *   disabled (`DISABLE_SSO=true`, so no SAML cross-origin POST binding) and
 *   Stripe is reached by a server-side redirect to its session `url`, never a
 *   cross-origin form POST.
 *
 * ⚠️ Before adding a directive here, ask what breaks if a legitimate request is
 * blocked. If the answer is not "nothing", it belongs in the Report-Only policy
 * below until the evidence says otherwise.
 */
export const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

/**
 * The **observation** directives, shipped Report-Only.
 *
 * These are the ones that would break the app today, sent Report-Only so a
 * browser reports what it *would* have blocked without blocking any of it.
 *
 * `script-src` is the one that matters and the one that is hardest: React
 * Router emits inline hydration scripts, and the app injects `window.env`
 * through an inline `<script>`. Both need a per-request nonce threaded through
 * `entry.server.tsx` and onto every inline script tag. Until that exists,
 * enforcing `script-src` would white-screen the app.
 *
 * **This list is a starting hypothesis, not a verified policy.** Refine it from
 * real reports before promoting anything to {@link CONTENT_SECURITY_POLICY}.
 */
export const CSP_OBSERVATION_DIRECTIVES = [
  "default-src 'self'",
  // 'unsafe-inline' is a placeholder for the nonce that does not exist yet —
  // it is why this policy cannot simply be promoted to enforcing.
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://js.stripe.com",
  // Tailwind and Radix both emit inline styles; a nonce does not help here.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https://js.stripe.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
];

/** The name tying the policy's `report-to` to the `Reporting-Endpoints` header. */
export const CSP_REPORT_ENDPOINT_NAME = "csp-endpoint";

/**
 * Derives Sentry's CSP report collector from the Sentry DSN.
 *
 * A DSN looks like `https://<key>@o123.ingest.sentry.io/456`, and the matching
 * security endpoint is
 * `https://o123.ingest.sentry.io/api/456/security/?sentry_key=<key>`. The key is
 * **public** — it already ships inside the browser bundle for client-side error
 * reporting — so naming it in a response header exposes nothing new.
 *
 * @param dsn - the raw `SENTRY_DSN`, if one is configured
 * @returns the collector URL, or `null` when the DSN is absent or unparseable
 */
export function sentryReportUrlFromDsn(dsn: string | undefined): string | null {
  if (!dsn) {
    return null;
  }

  try {
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.replace(/^\//, "");

    if (!key || !projectId) {
      return null;
    }

    return `${url.protocol}//${url.host}/api/${projectId}/security/?sentry_key=${key}`;
  } catch {
    return null;
  }
}

/**
 * Builds the Report-Only policy, or `null` when there is nowhere to report to.
 *
 * ⚠️ **A Report-Only policy without a reporting destination does nothing at
 * all.** It does not block (by definition) and browsers do not even log the
 * violations — Chrome says so outright: _"was delivered in report-only mode,
 * but does not specify a 'report-to'; the policy will have no effect"_. Shipping
 * one is strictly worse than shipping none: zero protection, zero information,
 * and a warning in the console of everyone who opens devtools. This function
 * returns `null` rather than let that happen.
 *
 * Both `report-uri` and `report-to` are emitted. `report-uri` is deprecated but
 * is the form Sentry has long accepted; `report-to` is what current Chrome
 * wants and is paired with the `Reporting-Endpoints` header. Whether Sentry
 * ingests the newer `application/reports+json` payload as well as the classic
 * `application/csp-report` one is **not verified here** — check Sentry for
 * arriving reports before trusting the modern path alone.
 *
 * @param reportUrl - the collector from {@link sentryReportUrlFromDsn}
 * @returns the policy string, or `null` when no collector is configured
 */
export function buildReportOnlyPolicy(reportUrl: string | null): string | null {
  if (!reportUrl) {
    return null;
  }

  return [
    ...CSP_OBSERVATION_DIRECTIVES,
    `report-uri ${reportUrl}`,
    `report-to ${CSP_REPORT_ENDPOINT_NAME}`,
  ].join("; ");
}

/** HSTS: 2 years, include subdomains. `preload` intentionally deferred. */
export const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains";

/**
 * Builds the security-header name→value map for a single response.
 *
 * @param opts.isHttps - whether the original client connection used HTTPS
 *   (derived from `x-forwarded-proto`).
 * @param opts.isCanonicalHost - whether the request targeted the canonical app
 *   host (the host of `SERVER_URL`).
 * @returns header name → value pairs to set on the response. HSTS is included
 *   only when the request is BOTH HTTPS and for the canonical app host.
 */
export function buildSecurityHeaders({
  isHttps,
  isCanonicalHost,
  reportUrl = null,
}: {
  isHttps: boolean;
  isCanonicalHost: boolean;
  reportUrl?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  };

  // Both headers, or neither. A Report-Only policy with nowhere to report is
  // inert — see buildReportOnlyPolicy.
  const reportOnly = buildReportOnlyPolicy(reportUrl);
  if (reportOnly) {
    headers[
      "Reporting-Endpoints"
    ] = `${CSP_REPORT_ENDPOINT_NAME}="${reportUrl}"`;
    headers["Content-Security-Policy-Report-Only"] = reportOnly;
  }

  // Assert HSTS only for the canonical app host over HTTPS. The same server
  // also answers for the URL-shortener host (and raw platform hosts / http
  // health checks); emitting `includeSubDomains` there would pin domains we
  // don't intend to. Browsers ignore HSTS over http anyway.
  if (isHttps && isCanonicalHost) {
    headers["Strict-Transport-Security"] = STRICT_TRANSPORT_SECURITY;
  }

  return headers;
}

/**
 * Whether the original client request used HTTPS, based on the
 * `x-forwarded-proto` header set by the Cloudflare/Fly proxy layer. Handles the
 * comma-separated multi-proxy form (e.g. `"https,http"`) by reading the first
 * value.
 *
 * @param forwardedProto - raw `x-forwarded-proto` header value, if any
 * @returns `true` when the client-facing connection was HTTPS
 */
function isHttpsRequest(forwardedProto: string | undefined): boolean {
  return (forwardedProto ?? "").split(",")[0].trim().toLowerCase() === "https";
}

/**
 * Extracts the lowercased host (`host:port`) from a URL string.
 *
 * @param url - a URL string (e.g. `SERVER_URL`)
 * @returns the lowercased host, or `null` when absent/unparseable
 */
export function hostFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hono middleware that sets the baseline security headers on every response.
 *
 * Headers are set *after* `await next()` (matching the existing `cache()` idiom
 * in {@link file://./middleware.ts}) so they apply to whatever response
 * downstream produced — including `serveStatic` short-circuits, redirects from
 * the `protect`/`urlShortener` middleware, and rendered error pages. `.set()`
 * (rather than append/default) ensures our baseline always wins.
 *
 * The canonical app host is resolved once from `SERVER_URL` (fixed at boot) and
 * used to scope HSTS — see {@link buildSecurityHeaders}.
 *
 * @returns a Hono middleware handler
 */
export function securityHeaders() {
  const canonicalHost = hostFromUrl(process.env.SERVER_URL);
  // Resolved once at boot, like canonicalHost. Absent DSN → no Report-Only
  // headers at all, rather than an inert policy.
  const reportUrl = sentryReportUrlFromDsn(process.env.SENTRY_DSN);

  return createMiddleware(async (c, next) => {
    await next();

    // Prefer the Host header — authoritative behind the Cloudflare/Fly proxy,
    // and what the urlShortener middleware keys on — falling back to the
    // request URL's host if the header is somehow absent.
    const requestHost =
      c.req.header("host")?.toLowerCase() ?? hostFromUrl(c.req.url);

    const headers = buildSecurityHeaders({
      isHttps: isHttpsRequest(c.req.header("x-forwarded-proto")),
      isCanonicalHost: canonicalHost !== null && requestHost === canonicalHost,
      reportUrl,
    });

    for (const [name, value] of Object.entries(headers)) {
      c.res.headers.set(name, value);
    }
  });
}
