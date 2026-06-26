import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "../../../../src/lib/rate-limit";
import { ISSUANCE_LIMIT } from "../../../../src/lib/passport/issuance-rate-limit";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { allowed, retryAfterSeconds } = checkRateLimit(
    `passport:issue:${ip}`,
    ISSUANCE_LIMIT
  );

  if (!allowed) {
    return NextResponse.json(
      { ok: false },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      }
    );
  }

  return NextResponse.json({ ok: true });
}
