import { NextResponse } from "next/server"
import { getPassportByAgentId } from "@/lib/passport/passport"
import { listAuditEntries, type AuditEntry } from "@/lib/passport/audit"

interface RouteContext {
  params: Promise<{ id: string }>
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Current UTC day boundaries for the daily spend read-out. */
function utcDayRange(now = new Date()): { startMs: number; endMs: number } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return { startMs: start, endMs: start + DAY_MS }
}

function spendAmount(entry: AuditEntry): number | null {
  const action = entry.action as unknown as string
  if (action !== "spend" && action !== "verified_spend") return null
  const amount = (entry.metadata as { amountXlm?: unknown } | undefined)?.amountXlm
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null
}

/**
 * GET /api/protocol/passport/[id]/health (issue #83)
 *
 * Single human/agent-friendly health summary. Returns 200 even for
 * revoked/expired passports; 404 only when no passport exists at all.
 */
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
  const daysRemaining =
    remainingMs === null ? null : Math.floor(remainingMs / DAY_MS)
  const hoursRemaining =
    remainingMs === null || remainingMs >= DAY_MS
      ? null
      : Math.ceil(remainingMs / HOUR_MS)
  const fullLifeExpiryHoursRemaining =
    remainingMs === null ? null : Math.ceil(remainingMs / HOUR_MS)

  const status =
    passport.status === "revoked"
      ? "revoked"
      : passport.status === "suspended"
        ? "suspended"
        : passport.status === "expired" ||
            (expiresAt && new Date(expiresAt).getTime() < Date.now())
          ? "expired"
          : "active"

  // Daily/weekly spend derives from audit entries carrying metadata.amountXlm.
  const now = new Date()
  const { startMs, endMs } = utcDayRange(now)
  const weekStartMs = endMs - 7 * DAY_MS
  let dailySpentXlm = 0
  let weeklySpentXlm = 0
  for (const entry of listAuditEntries(passport.id)) {
    const ts = new Date(entry.timestamp).getTime()
    if (!Number.isFinite(ts)) continue
    const amount = spendAmount(entry)
    if (amount === null) continue
    if (ts >= startMs && ts < endMs) dailySpentXlm += amount
    if (ts >= weekStartMs && ts < endMs) weeklySpentXlm += amount
  }

  // Optional protocol features: surfaced from config when present.
  const config = passport.config as {
    spendLimits?: { dailyMaxXlm?: number; weeklyMaxXlm?: number | null } | null
    circuitBreaker?: {
      consecutiveFailures?: number
      maxConsecutiveFailures?: number
      tripped?: boolean
    } | null
  }
  const spendLimits =
    config.spendLimits && typeof config.spendLimits.dailyMaxXlm === "number"
      ? {
          dailyMaxXlm: config.spendLimits.dailyMaxXlm,
          weeklyMaxXlm: config.spendLimits.weeklyMaxXlm ?? null,
        }
      : null
  const cb = config.circuitBreaker
  const circuitBreakerStatus = cb
    ? {
        consecutiveFailures: cb.consecutiveFailures ?? 0,
        maxConsecutiveFailures: cb.maxConsecutiveFailures ?? null,
        tripped: Boolean(cb.tripped),
      }
    : null

  return NextResponse.json(
    {
      ok: true,
      agentId: passport.agentId,
      status,
      expiresAt,
      daysRemaining,
      hoursRemaining,
      fullLifeExpiryHoursRemaining,
      spendingLimits: spendLimits,
      dailySpentXlm,
      weeklySpentXlm,
      circuitBreakerStatus,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  )
}
