/**
 * Derive the public-facing site origin from an incoming request.
 *
 * Priority:
 * 1. `x-forwarded-host` / `x-forwarded-proto` headers (set by reverse proxies
 *    such as Vercel, Railway, and most load balancers).
 * 2. The `Host` header from the request.
 * 3. The URL object parsed from `request.url` (works in local dev).
 * 4. `NEXT_PUBLIC_SITE_URL` env var as a last resort.
 * 5. Hardcoded production fallback.
 */
export function getSiteUrl(request: Request): string {
  const forwardedHostRaw = request.headers.get("x-forwarded-host");
  const forwardedProtoRaw = request.headers.get("x-forwarded-proto");

  if (forwardedHostRaw) {
    // x-forwarded-host/proto can be comma-separated when multiple proxies
    // are involved. Use the first (client-facing) value.
    const forwardedHost = forwardedHostRaw.split(",")[0].trim();
    const forwardedProto = forwardedProtoRaw
      ? forwardedProtoRaw.split(",")[0].trim()
      : "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get("host");
  if (host) {
    // Local dev (localhost, 127.0.0.1, 0.0.0.0) runs on http; deployed
    // environments use https.
    const isLocal =
      host.startsWith("localhost") ||
      host.startsWith("127.0.0.1") ||
      host.startsWith("0.0.0.0");
    const proto = isLocal ? "http" : "https";
    return `${proto}://${host}`;
  }

  // Fallback: parse origin from the request URL itself.
  try {
    const url = new URL(request.url);
    return url.origin;
  } catch {
    // Absolute last resort
    return (
      process.env.NEXT_PUBLIC_SITE_URL || "https://assistants.convos.org"
    );
  }
}
