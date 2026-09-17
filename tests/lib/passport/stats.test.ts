import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("next/server", () => {
  return {
    NextResponse: {
      json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => {
        const headers = new Headers(init?.headers)
        return {
          status: init?.status ?? 200,
          headers,
          json: async () => body,
        } as unknown as Response
      },
    },
  }
})

import {
  issuePassport,
  suspendPassport,
  expirePassport,
  resetPassportStore,
  setPassport,
} from "@/lib/passport/passport"
import {
  revokePassport,
  resetRevocationStore,
} from "@/lib/passport/revocation"
import { getPassportStats } from "@/lib/passport/stats"
import { GET } from "@/app/api/protocol/passport/stats/route"

describe("passport stats analytics endpoint (#122)", () => {
  beforeEach(() => {
    resetPassportStore()
    resetRevocationStore()
  })

  it("returns zero counts on empty store", () => {
    const stats = getPassportStats()
    expect(stats.total).toBe(0)
    expect(stats.byStatus).toEqual({
      active: 0,
      suspended: 0,
      revoked: 0,
      expired: 0,
    })
    expect(stats.expiringSoon).toBe(0)
    expect(stats.recentRevocations).toEqual([])
    expect(stats.snapshotAt).toBeGreaterThan(0)
  })

  it("correctly aggregates counts across a mix of statuses", () => {
    // 3 active
    issuePassport("pass-1", "agent-1", "admin")
    issuePassport("pass-2", "agent-2", "admin")
    issuePassport("pass-3", "agent-3", "admin")

    // 1 suspended
    issuePassport("pass-4", "agent-4", "admin")
    suspendPassport("pass-4", "admin", "investigation")

    // 2 revoked
    issuePassport("pass-5", "agent-5", "admin")
    revokePassport("pass-5", { reason: "policy_violation" }, "admin")
    issuePassport("pass-6", "agent-6", "admin")
    revokePassport("pass-6", { reason: "security_compromise" }, "admin")

    // 1 expired
    issuePassport("pass-7", "agent-7", "admin")
    expirePassport("pass-7", "admin", "term_ended")

    const stats = getPassportStats()
    expect(stats.total).toBe(7)
    expect(stats.byStatus.active).toBe(3)
    expect(stats.byStatus.suspended).toBe(1)
    expect(stats.byStatus.revoked).toBe(2)
    expect(stats.byStatus.expired).toBe(1)
  })

  it("calculates expiringSoon only for active passports expiring within window", () => {
    const now = Date.now()
    const DAY_MS = 24 * 60 * 60 * 1000

    // Active, expiring in 3 days -> within 7 day window
    issuePassport("pass-active-soon", "agent-soon", "admin", undefined, new Date(now + 3 * DAY_MS).toISOString())

    // Active, expiring in 15 days -> outside 7 day window
    issuePassport("pass-active-later", "agent-later", "admin", undefined, new Date(now + 15 * DAY_MS).toISOString())

    // Active, no expiration
    issuePassport("pass-active-forever", "agent-forever", "admin", undefined, null)

    // Already expired (expired yesterday) -> should NOT count in expiringSoon
    const expiredRecord = issuePassport("pass-already-expired", "agent-exp", "admin", undefined, new Date(now - 1 * DAY_MS).toISOString())
    expiredRecord.status = "expired"
    setPassport(expiredRecord)

    // Suspended, expiring in 2 days -> not active, should NOT count in expiringSoon
    issuePassport("pass-suspended-soon", "agent-susp", "admin", undefined, new Date(now + 2 * DAY_MS).toISOString())
    suspendPassport("pass-suspended-soon", "admin")

    const stats = getPassportStats({ nowMs: now, expiringSoonDays: 7 })
    expect(stats.expiringSoon).toBe(1)
  })

  it("returns up to 10 recent revocations sorted by revokedAt desc", () => {
    for (let i = 1; i <= 15; i++) {
      const id = `pass-rev-${i}`
      issuePassport(id, `agent-${i}`, "admin")
      revokePassport(id, { reason: "policy_violation" }, "admin")
    }

    const stats = getPassportStats()
    expect(stats.recentRevocations).toHaveLength(10)
    expect(stats.recentRevocations[0].reason).toBe("policy_violation")
    expect(typeof stats.recentRevocations[0].revokedAt).toBe("number")
  })

  it("GET /api/protocol/passport/stats route returns 200 with correct payload", async () => {
    issuePassport("pass-live-1", "agent-live-1", "admin")
    issuePassport("pass-live-2", "agent-live-2", "admin")
    revokePassport("pass-live-2", { reason: "key_compromise" }, "admin")

    const req = new Request("http://localhost:3000/api/protocol/passport/stats")
    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = (await res.json()) as any
    expect(data.total).toBe(2)
    expect(data.byStatus.active).toBe(1)
    expect(data.byStatus.revoked).toBe(1)
    expect(data.recentRevocations).toHaveLength(1)
    expect(data.recentRevocations[0].passportId).toBe("pass-live-2")
    expect(data.recentRevocations[0].reason).toBe("key_compromise")
    expect(data.snapshotAt).toBeGreaterThan(0)
  })
})
