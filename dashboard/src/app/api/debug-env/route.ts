import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? null,
    NEXT_PUBLIC_POOL_ENVIRONMENT: process.env.NEXT_PUBLIC_POOL_ENVIRONMENT ?? null,
    NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH ?? null,
  });
}
