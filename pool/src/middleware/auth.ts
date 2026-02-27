import type { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { isAuthenticated } from "../admin";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // 1. Bearer token (API callers)
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match?.[1] && match[1] === config.poolApiKey) {
    next();
    return;
  }

  // 2. Session cookie (admin dashboard browser requests)
  if (isAuthenticated(req)) {
    next();
    return;
  }

  res.status(401).json({ error: "Invalid or missing API key" });
}
