/**
 * Instance authentication middleware.
 *
 * Validates that the request comes from a known pool-managed instance.
 * Accepts auth via:
 *   - Authorization: Bearer <instanceId>:<gatewayToken>
 *
 * On success, attaches `req.instanceId` for downstream handlers.
 */

import type { Request, Response, NextFunction } from "express";
import * as db from "../db/pool";

// Extend Express Request to carry the authenticated instance ID
declare global {
  namespace Express {
    interface Request {
      instanceId?: string;
    }
  }
}

// Simple in-memory cache: instanceId → { token, ts }
// Avoids hitting DB on every proxy request. Token is static for instance lifetime.
const tokenCache = new Map<string, { token: string; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function extractCredentials(req: Request): { instanceId: string; token: string } | null {
  // Try Authorization: Bearer <instanceId>:<gatewayToken>
  const authHeader = req.headers.authorization || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    const [instanceId, ...rest] = bearerMatch[1].split(":");
    const token = rest.join(":"); // rejoin in case token contains ':'
    if (instanceId && token) return { instanceId, token };
  }

  return null;
}

export async function requireInstanceAuth(req: Request, res: Response, next: NextFunction) {
  const creds = extractCredentials(req);
  if (!creds) {
    res.status(401).json({ error: "Missing instance credentials" });
    return;
  }

  const { instanceId, token } = creds;

  // Check cache first
  const cached = tokenCache.get(instanceId);
  if (cached && cached.token === token && Date.now() - cached.ts < CACHE_TTL) {
    req.instanceId = instanceId;
    next();
    return;
  }

  // Validate against DB
  const valid = await db.findInstanceByToken(instanceId, token);
  if (!valid) {
    res.status(403).json({ error: "Invalid instance ID or token" });
    return;
  }

  // Cache for future requests
  tokenCache.set(instanceId, { token, ts: Date.now() });
  req.instanceId = instanceId;
  next();
}
