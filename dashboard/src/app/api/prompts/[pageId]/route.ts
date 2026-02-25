import { NextRequest, NextResponse } from "next/server";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

// In Next.js 15, route handler params is a Promise and must be awaited.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;
  if (!/^[a-f0-9]{32}$/.test(pageId)) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  const res = await fetch(`${POOL_API_URL}/api/prompts/${pageId}`);

  // Guard against non-JSON upstream responses (e.g. 502 HTML from proxy)
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    return NextResponse.json(
      { error: text || "Upstream returned non-JSON response" },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
