import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

export async function middleware(request: NextRequest) {
  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    // Auth0 auth routes
    "/auth/:path*",
    // Skills CRUD proxy routes that need session
    "/api/skills/:path*",
    // Dev testing routes
    "/api/dev/:path*",
  ],
};
