import { config } from "../config";

/**
 * Notify the dashboard (Next.js) to invalidate its cached fetches for the
 * given tags. Fire-and-forget: errors are logged but never thrown. If the
 * dashboard env vars aren't configured (e.g. local dev), this is a no-op.
 *
 * Called from skill mutation handlers so unpublish/delete take effect
 * immediately instead of waiting for the 60s fetch revalidate TTL.
 */
export async function revalidateDashboard(tags: string[]): Promise<void> {
  const url = config.dashboardRevalidateUrl;
  const secret = config.dashboardRevalidateSecret;
  if (!url || !secret || tags.length === 0) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revalidate-secret": secret,
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
