import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

const COOKIE_NAME = "dev_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function makeToken(expiry: number): string {
  const secret = process.env.POOL_API_KEY || "";
  return crypto.createHmac("sha256", secret).update(String(expiry)).digest("hex") + "." + expiry;
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const apiKey = process.env.POOL_API_KEY;

  if (!apiKey || typeof password !== "string") {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  const passwordHash = crypto.createHash("sha256").update(password).digest();
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest();
  if (!crypto.timingSafeEqual(passwordHash, apiKeyHash)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const expiry = Date.now() + SESSION_TTL_MS;
  const token = makeToken(expiry);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}
