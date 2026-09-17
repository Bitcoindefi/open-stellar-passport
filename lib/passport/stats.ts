import { getAllPassports, type PassportStatus } from "./passport"
import { listRevocations } from "./revocation"

export interface RecentRevocationItem {
  passportId: string
  reason: string
  revokedAt: number
}

export interface PassportStatsResponse {
  total: number
  byStatus: {
    active: number
    suspended: number
    revoked: number
    expired: number
  }
  expiringSoon: number
  recentRevocations: RecentRevocationItem[]
  snapshotAt: number
}

export interface GetPassportStatsOptions {
  expiringSoonDays?: number
  nowMs?: number
}

const DEFAULT_EXPIRING_SOON_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export function getPassportStats(options: GetPassportStatsOptions = {}): PassportStatsResponse {
  const nowMs = options.nowMs ?? Date.now()
  const days =
    options.expiringSoonDays ??
    (process.env.PASSPORT_EXPIRING_SOON_DAYS
      ? Number(process.env.PASSPORT_EXPIRING_SOON_DAYS)
      : DEFAULT_EXPIRING_SOON_DAYS)
  const expiringWindowMs = days * DAY_MS
  const nowSeconds = Math.floor(nowMs / 1000)

  const passports = getAllPassports()
  const total = passports.length

  const byStatus: Record<PassportStatus, number> = {
    active: 0,
    suspended: 0,
    revoked: 0,
    expired: 0,
  }

  let expiringSoon = 0

  for (const passport of passports) {
    if (byStatus[passport.status] !== undefined) {
      byStatus[passport.status]++
    }

    // expiringSoon only includes active passports (not already expired)
    if (passport.status === "active" && passport.expiresAt) {
      const expiresAtMs = Date.parse(passport.expiresAt)
      if (Number.isFinite(expiresAtMs)) {
        if (expiresAtMs > nowMs && expiresAtMs <= nowMs + expiringWindowMs) {
          expiringSoon++
        }
      }
    }
  }

  const revocations = listRevocations()
  const recentRevocations: RecentRevocationItem[] = revocations.slice(0, 10).map((r) => {
    const timeMs = Date.parse(r.revokedAt)
    const timeSec = Number.isFinite(timeMs) ? Math.floor(timeMs / 1000) : nowSeconds
    return {
      passportId: r.passportId,
      reason: r.reason,
      revokedAt: timeSec,
    }
  })

  return {
    total,
    byStatus,
    expiringSoon,
    recentRevocations,
    snapshotAt: nowSeconds,
  }
}
