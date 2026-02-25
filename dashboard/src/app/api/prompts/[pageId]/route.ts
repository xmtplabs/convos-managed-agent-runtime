import { NextRequest, NextResponse } from "next/server";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;
  if (!/^[a-f0-9]{32}$/.test(pageId)) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }
  const res = await fetch(`${POOL_API_URL}/api/prompts/${pageId}`);
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
