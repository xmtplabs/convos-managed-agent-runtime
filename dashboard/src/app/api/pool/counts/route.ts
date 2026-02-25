import { NextResponse } from "next/server";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

export async function GET() {
  const res = await fetch(`${POOL_API_URL}/api/pool/counts`, {
    next: { revalidate: 0 },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
