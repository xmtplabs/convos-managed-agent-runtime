import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

/** PUT /api/templates/:id — update a skill. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { token } = await auth0.getAccessToken();
    const { id } = await params;
    const body = await request.json();
    const res = await fetch(`${POOL_API_URL}/api/skills/${encodeURIComponent(id)}`, {
      method: "PUT",
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

/** DELETE /api/templates/:id — delete a skill. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { token } = await auth0.getAccessToken();
    const { id } = await params;
    const res = await fetch(`${POOL_API_URL}/api/skills/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
