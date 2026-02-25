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
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get("host");
  if (host) {
    // Local dev typically runs on http; deployed environments on https.
    const proto = host.startsWith("localhost") ? "http" : "https";
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
