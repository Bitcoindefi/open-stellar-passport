import { NextRequest, NextResponse } from "next/server";
import { globalPassportStore } from "../../../../../src/lib/passport-store";

function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

/**
 * GET /api/protocol/passport/analytics?expiringWithinDays=<n>
 *
 * Aggregates passport statistics across all passports currently stored in
 * the in-memory `globalPassportStore`.
 */
export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const expiringWithinDaysRaw = searchParams.get("expiringWithinDays");

  const expiringWithinDays =
    expiringWithinDaysRaw != null && expiringWithinDaysRaw !== ""
      ? Number(expiringWithinDaysRaw)
      : 7;

  if (!Number.isFinite(expiringWithinDays) || expiringWithinDays < 0) {
    return NextResponse.json(
      { ok: false, reason: "InvalidExpiringWindow" },
      { status: 400 },
    );
  }

  const stats = globalPassportStore.getAnalytics({
    expiringWithinMs: daysToMs(expiringWithinDays),
  });

  return NextResponse.json({ ok: true, ...stats });
}

