import type { Request, Response, NextFunction } from "express";
import { config } from "../config";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== config.poolApiKey) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }
  next();
}
