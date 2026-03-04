import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { verifyDevSession } from "../login/route";

export async function GET(request: NextRequest) {
  if (!verifyDevSession(request.headers.get("cookie"))) {
    return NextResponse.json({ error: "Dev session required" }, { status: 403 });
  }

  try {
    const session = await auth0.getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ user: session.user });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
