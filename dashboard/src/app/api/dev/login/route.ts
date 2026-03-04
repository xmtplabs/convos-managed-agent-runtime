import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

const COOKIE_NAME = "dev_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function makeToken(expiry: number): string {
  const secret = process.env.POOL_API_KEY || "";
  return crypto.createHmac("sha256", secret).update(String(expiry)).digest("hex") + "." + expiry;
}

export function verifyDevSession(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  const token = match[1];
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const expiry = Number(token.slice(dot + 1));
  if (!expiry || Date.now() > expiry) return false;
  const expected = makeToken(expiry);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const apiKey = process.env.POOL_API_KEY;

  if (!apiKey || password !== apiKey) {
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
