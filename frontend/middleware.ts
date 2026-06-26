import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rateLimitExceeded } from "@/lib/rate-limit";

export function middleware(request: NextRequest) {
  const { exceeded, retryAfterSeconds } = rateLimitExceeded(request);

  if (exceeded) {
    return NextResponse.json(
      { ok: false, error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
