import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config";

const JWKS = config.auth0Domain
  ? createRemoteJWKSet(new URL(`https://${config.auth0Domain}/.well-known/jwks.json`))
  : null;

/**
 * Auth0 JWT verification middleware.
 * Extracts the Auth0 `sub` claim and sets `req.userId`.
 *
 * IMPORTANT: This is completely separate from `requireAuth` (API key / admin session).
 * Never merge them.
 */
export async function requireUserAuth(req: Request, res: Response, next: NextFunction) {
  if (!JWKS || !config.auth0Domain || !config.auth0Audience) {
    res.status(503).json({ error: "Auth0 not configured" });
    return;
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing token" });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${config.auth0Domain}/`,
      audience: config.auth0Audience,
      clockTolerance: 30,
    });
    if (!payload.sub) {
      res.status(401).json({ error: "Missing sub claim" });
      return;
    }
    (req as any).userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/**
 * Optional auth: extracts userId from JWT if present, but doesn't reject
 * unauthenticated requests. Use for routes that serve public content but
 * need to identify the user for private resource access.
 */
export async function optionalUserAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !JWKS || !config.auth0Domain || !config.auth0Audience) {
    next();
    return;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${config.auth0Domain}/`,
      audience: config.auth0Audience,
      clockTolerance: 30,
    });
    if (payload.sub) {
      (req as any).userId = payload.sub;
    }
  } catch {
    // Token invalid — treat as unauthenticated, don't block
  }
  next();
}
