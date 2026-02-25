import { NextResponse } from "next/server";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

export async function GET() {
  const res = await fetch(`${POOL_API_URL}/api/pool/agents`);

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    return NextResponse.json(
      { error: text || "Upstream returned non-JSON response" },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
