import { config } from "../config";

/**
 * Notify the dashboard (Next.js) to invalidate its cached fetches for the
 * given tags. Fire-and-forget: errors are logged but never thrown. No-op
 * if TEMPLATE_SITE_URL or POOL_API_KEY aren't configured.
 *
 * Target URL is derived from TEMPLATE_SITE_URL — the same env var the pool
 * already uses for its root redirect — so no new config is required. If
 * the dashboard is served with a basePath (e.g. convos.org/assistants),
 * TEMPLATE_SITE_URL must include that path, and /api/revalidate resolves
 * correctly since Next.js prefixes API routes with the basePath.
 *
 * Auth reuses POOL_API_KEY — the same shared secret the dashboard already
 * uses to authenticate dashboard→pool calls from /api/claim. One secret,
 * symmetric in both directions.
 *
 * Called from skill mutation handlers so unpublish/delete take effect
 * immediately instead of waiting for the 60s fetch revalidate TTL.
 */
export async function revalidateDashboard(tags: string[]): Promise<void> {
  const siteUrl = config.templateSiteUrl;
  const apiKey = config.poolApiKey;
  if (!siteUrl || !apiKey || tags.length === 0) return;
  const url = `${siteUrl.replace(/\/$/, "")}/api/revalidate`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ tags }),
      // Don't block mutations on a slow dashboard.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn(
        `[revalidateDashboard] ${url} responded ${res.status} for tags ${JSON.stringify(tags)}`,
      );
    }
  } catch (err) {
    console.warn(
      `[revalidateDashboard] failed to notify ${url} for tags ${JSON.stringify(tags)}:`,
      err,
    );
  }
}
