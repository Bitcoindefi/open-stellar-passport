import { NextRequest, NextResponse } from "next/server";
import { globalPassportStore } from "../../../../src/lib/passport-store";
import { isRevoked } from "../../../../src/lib/passport/revocation-store";

/**
 * GET /api/protocol/passport/authorize?agentId=<id>&amount=<xlm>
 *
 * Returns the current authorization status for a passport spend request,
 * incorporating revocation, expiry, and spend-cap checks in order.
 *
 * Query parameters:
 *   agentId  — the agent whose passport to check (required)
 *   amount   — spend amount in stroops / XLM units (required, positive integer)
 *
 * Returns:
 *   200 { ok: true }
 *   200 { ok: false, reason: "PassportRevoked" | "PassportExpired" | "PassportNotFound" | ... }
 *   400 { ok: false, reason: "MissingFields" }
 */
export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const amountRaw = searchParams.get("amount");

  if (!agentId || !amountRaw) {
    return NextResponse.json({ ok: false, reason: "MissingFields" }, { status: 400 });
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return NextResponse.json({ ok: false, reason: "InvalidAmount" }, { status: 400 });
  }

  // Fast-path: revocation check (mirrors authorizePassportSpend first guard)
  if (isRevoked(agentId)) {
    return NextResponse.json({ ok: false, reason: "PassportRevoked" });
  }

  // Passport existence check
  const passport = globalPassportStore.getPassport(agentId);
  if (!passport) {
    return NextResponse.json({ ok: false, reason: "PassportNotFound" });
  }

  // Delegate full check (expiry + spend cap guard) to the store
  const result = globalPassportStore.authorizePassportSpend(agentId, amount);
  return NextResponse.json(result);
}
