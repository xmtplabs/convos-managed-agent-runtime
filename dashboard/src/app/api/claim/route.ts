import { NextRequest, NextResponse } from "next/server";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";
const POOL_API_KEY = process.env.POOL_API_KEY || "";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${POOL_API_URL}/api/pool/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${POOL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
