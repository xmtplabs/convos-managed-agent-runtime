import crypto from "node:crypto";

const COOKIE_NAME = "dev_session";

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
