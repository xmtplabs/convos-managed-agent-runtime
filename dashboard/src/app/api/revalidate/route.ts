import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

// POST /api/revalidate
//
// Called by the pool when a skill is created, updated, deleted, or its
// published/featured state changes. Drops the tagged Next.js Data Cache
// entries so the next render fetches fresh data from the pool.
//
// Auth: Bearer token matching POOL_API_KEY — the same shared secret the
// dashboard already uses to authenticate dashboard→pool calls from
// /api/claim. Reused here so there's one secret, not two.
//
// Body: { "tags": string[] }  e.g. ["skills", "skill:the-pickup-game-finder"]
export async function POST(req: NextRequest) {
  const expected = process.env.POOL_API_KEY;
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!expected || !match || match[1] !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const tags = (body as { tags?: unknown })?.tags;
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string" && t.length > 0)) {
    return NextResponse.json({ error: "tags must be a non-empty string array" }, { status: 400 });
  }

  for (const tag of tags) {
    // Marks the tag's cached fetches stale. The next request that uses one of
    // these tags will re-fetch fresh data from the pool, so unpublish/delete
    // take effect on the next page load instead of waiting for the 60s TTL.
    revalidateTag(tag);
  }

  return NextResponse.json({ revalidated: true, tags });
}
