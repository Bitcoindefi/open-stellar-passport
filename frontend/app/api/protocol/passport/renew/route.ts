import { NextRequest, NextResponse } from "next/server";
import { globalPassportStore } from "../../../../../src/lib/passport-store";
import { checkRateLimit } from "../../../../../src/lib/rate-limit";

/** 5 renewals per IP per minute — same cap as issuance. */
const RENEWAL_LIMIT = { maxRequests: 5, windowMs: 60_000 };

/**
 * POST /api/protocol/passport/renew
 *
 * Body: { agentId: string; zkProofHash: string }
 *
 * Re-issues a new expiresAt (= now + TTL_DAYS) for the given agent without
 * changing its spendCapXlm. The caller must supply the original zkProofHash
 * so that only the legitimate passport holder can extend validity.
 *
 * Returns:
 *   200 { ok: true,  expiresAt: string }
 *   400 { ok: false, reason: "MissingFields" }
 *   404 { ok: false, reason: "PassportNotFound" | "InvalidProofHash" }
 *   429 { ok: false } + Retry-After header
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { allowed, retryAfterSeconds } = checkRateLimit(
    `passport:renew:${ip}`,
    RENEWAL_LIMIT,
  );

  if (!allowed) {
    return NextResponse.json(
      { ok: false },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "MissingFields" }, { status: 400 });
  }

  const { agentId, zkProofHash } = body ?? {};
  if (typeof agentId !== "string" || typeof zkProofHash !== "string") {
    return NextResponse.json({ ok: false, reason: "MissingFields" }, { status: 400 });
  }

  const result = globalPassportStore.renewPassport(agentId, zkProofHash);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, expiresAt: result.expiresAt });
}
