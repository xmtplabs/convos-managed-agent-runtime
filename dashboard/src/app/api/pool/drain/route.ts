import { NextRequest, NextResponse } from "next/server";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";
const POOL_API_KEY = process.env.POOL_API_KEY || "";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${POOL_API_URL}/api/pool/drain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${POOL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

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
