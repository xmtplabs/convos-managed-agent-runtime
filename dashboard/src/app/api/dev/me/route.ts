import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
