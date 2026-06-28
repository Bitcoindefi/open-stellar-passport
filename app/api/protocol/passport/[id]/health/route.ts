import { NextResponse } from "next/server"
import { getPassportByAgentId } from "@/lib/passport/passport"

interface RouteContext {
  params: Promise<{ id: string }>
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params
  const agentId = decodeURIComponent(id)
  const passport = getPassportByAgentId(agentId)

  if (!passport) {
    return NextResponse.json(
      { ok: false, error: "passport_not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    )
  }

  const expiresAt = passport.expiresAt ?? null
  const remainingMs = expiresAt
    ? Math.max(0, new Date(expiresAt).getTime() - Date.now())
    : null
  const fullLifeExpiryHoursRemaining = remainingMs === null
    ? null
    : Math.ceil(remainingMs / HOUR_MS)
  const daysRemaining = remainingMs === null
    ? null
    : Math.floor(remainingMs / DAY_MS)
  const hoursRemaining = remainingMs === null || remainingMs >= DAY_MS
    ? null
    : fullLifeExpiryHoursRemaining

  const status = passport.status === "revoked"
    ? "revoked"
    : passport.status === "suspended"
      ? "suspended"
      : passport.status === "expired" || expiresAt && new Date(expiresAt).getTime() < Date.now()
        ? "expired"
        : "active"

  return NextResponse.json(
    {
      ok: true,
      agentId: passport.agentId,
      status,
      expiresAt,
      daysRemaining,
      hoursRemaining,
      fullLifeExpiryHoursRemaining,
      spendingLimits: null,
      dailySpentXlm: 0,
      weeklySpentXlm: 0,
      circuitBreakerStatus: null,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  )
}
