import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

/** GET /api/templates — list user's own skills (proxies to pool API /mine). */
export async function GET() {
  try {
    const { token } = await auth0.getAccessToken();
    const res = await fetch(`${POOL_API_URL}/api/skills/mine`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}

/** POST /api/templates — create a skill. */
export async function POST(request: NextRequest) {
  try {
    const { token } = await auth0.getAccessToken();
    const body = await request.json();
    const res = await fetch(`${POOL_API_URL}/api/skills`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
