import { NextRequest, NextResponse } from "next/server";
import { revokePassport } from "../../../../../src/lib/passport/revocation-store";
import {
  DEFAULT_SERVICE_CONTEXT,
  isValidServiceContext,
} from "../../../../../src/lib/passport-store";
import { checkRateLimit } from "../../../../../src/lib/rate-limit";

/** 10 revocations per IP per minute — generous to handle emergency use cases. */
const REVOKE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

/**
 * POST /api/protocol/passport/revoke
 *
 * Body: { agentId: string }
 *
 * Immediately marks the passport for the given agent as revoked.
 * Subsequent calls to authorizePassportSpend for the same agentId will
 * return { ok: false, reason: "PassportRevoked" }.
 *
 * Revocation is permanent for the lifetime of the server process.
 * agentId matching is case-insensitive and trims surrounding whitespace.
 *
 * Returns:
 *   200 { ok: true, revokedAt: string }
 *   400 { ok: false, reason: "MissingFields" }
 *   429 { ok: false } + Retry-After header
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { allowed, retryAfterSeconds } = checkRateLimit(
    `passport:revoke:${ip}`,
    REVOKE_LIMIT,
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
    return NextResponse.json(
      { ok: false, reason: "MissingFields" },
      { status: 400 },
    );
  }

  const { agentId, serviceContext } = body ?? {};
  if (typeof agentId !== "string" || agentId.trim() === "") {
    return NextResponse.json(
      { ok: false, reason: "MissingFields" },
      { status: 400 },
    );
  }

  const normalizedServiceContext =
    serviceContext == null
      ? DEFAULT_SERVICE_CONTEXT
      : typeof serviceContext === "string"
        ? serviceContext.trim()
        : null;
  if (
    !normalizedServiceContext ||
    !isValidServiceContext(normalizedServiceContext)
  ) {
    return NextResponse.json(
      { ok: false, reason: "InvalidServiceContext" },
      { status: 400 },
    );
  }

  revokePassport(agentId, normalizedServiceContext);
  return NextResponse.json({ ok: true, revokedAt: new Date().toISOString() });
}
