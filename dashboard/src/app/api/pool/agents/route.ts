import { NextResponse } from "next/server";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";
// Fail closed: default to "production" so routes are disabled unless explicitly configured
const POOL_ENVIRONMENT = process.env.POOL_ENVIRONMENT || "production";

export async function GET() {
  if (POOL_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
