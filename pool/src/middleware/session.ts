import crypto from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";

const COOKIE_NAME = "pool_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface Session {
  expiresAt: number;
}

const sessions = new Map<string, Session>();

const _cleanup = setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (sess.expiresAt <= now) sessions.delete(token);
  }
}, 60 * 60 * 1000);
_cleanup.unref();

function parseCookie(req: Request): string | undefined {
  const header = req.headers.cookie || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match?.[1];
}

export function isAuthenticated(req: Request): boolean {
  const token = parseCookie(req);
  if (!token) return false;
  const sess = sessions.get(token);
  if (!sess) return false;
  if (sess.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function handleLogin(req: Request, res: Response): boolean {
  const password = (req.body as any)?.password || "";
  if (!config.poolApiKey || password !== config.poolApiKey) {
    return false;
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });

  const isProduction = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${isProduction ? "; Secure" : ""}`,
  );
  return true;
}

export function handleLogout(req: Request, res: Response): void {
  const token = parseCookie(req);
  if (token) sessions.delete(token);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}
