import type { Request, Response, NextFunction } from "express";
import { config } from "../config";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const key = match?.[1] || (req.query.key as string) || "";
  if (!key || key !== config.poolApiKey) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }
  next();
}
