import { NextResponse } from "next/server";
import type { AgentSkill } from "@/lib/types";
import { filterReleaseCandidateTemplates } from "@/lib/release-candidate";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

export async function GET() {
  const res = await fetch(`${POOL_API_URL}/api/pool/templates`, {
    next: { revalidate: 60 },
  });
  const data: AgentSkill[] | unknown = await res.json();
  if (!res.ok || !Array.isArray(data)) {
    return NextResponse.json(data, { status: res.status });
  }

  return NextResponse.json(filterReleaseCandidateTemplates(data), {
    status: res.status,
  });
}
