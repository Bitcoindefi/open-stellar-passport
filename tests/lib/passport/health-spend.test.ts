import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/protocol/passport/[id]/health/route"
import {
  resetPassportStore,
  setPassport,
  type PassportRecord,
} from "@/lib/passport/passport"
import { appendAuditEntry, resetAuditStore } from "@/lib/passport/audit"

vi.mock("next/server", () => ({
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
}))

const NOW = new Date("2026-06-27T12:00:00.000Z")
const AGENT_ID = "GBBB"

function passport(overrides: Partial<PassportRecord> = {}): PassportRecord {
  return {
    id: "passport-h83",
    agentId: AGENT_ID,
    status: "active",
    config: { allowTransfer: true },
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  }
}

async function getHealth(agentId = AGENT_ID) {
  return GET(new Request(`http://localhost/api/protocol/passport/${agentId}/health`), {
    params: Promise.resolve({ id: agentId }),
  })
}

describe("issue #83: health derives live spend data from the audit log", () => {
  beforeEach(() => {
    resetPassportStore()
    resetAuditStore()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function seedSpend(amountXlm: number, timestamp: string) {
    appendAuditEntry({
      passportId: "passport-h83",
      action: "spend" as never,
      actor: AGENT_ID,
      metadata: { amountXlm },
      ...(timestamp ? { timestamp } : {}),
    })
  }

  it("dailySpentXlm reads only the current UTC day; weekly spans seven", async () => {
    setPassport(passport())
    seedSpend(10, "2026-06-27T09:00:00.000Z") // today
    seedSpend(5.5, "2026-06-27T11:59:00.000Z") // today
    seedSpend(100, "2026-06-24T10:00:00.000Z") // this week, not today
    seedSpend(999, "2026-06-01T10:00:00.000Z") // outside the week

    const response = await getHealth()
    const body = await response.json()

    expect(body.dailySpentXlm).toBeCloseTo(15.5, 6)
    expect(body.weeklySpentXlm).toBeCloseTo(115.5, 6)
  })

  it("non-spend audit entries do not count toward daily spend", async () => {
    setPassport(passport())
    appendAuditEntry({
      passportId: "passport-h83",
      action: "issued",
      actor: AGENT_ID,
    })

    const response = await getHealth()
    const body = await response.json()
    expect(body.dailySpentXlm).toBe(0)
  })

  it("surfaces configured spend limits and circuit breaker state", async () => {
    setPassport(
      passport({
        config: {
          allowTransfer: true,
          spendLimits: { dailyMaxXlm: 50, weeklyMaxXlm: 300 },
          circuitBreaker: { consecutiveFailures: 2, maxConsecutiveFailures: 3, tripped: false },
        },
      } as Partial<PassportRecord>),
    )

    const response = await getHealth()
    const body = await response.json()

    expect(body.spendingLimits).toEqual({ dailyMaxXlm: 50, weeklyMaxXlm: 300 })
    expect(body.circuitBreakerStatus).toEqual({
      consecutiveFailures: 2,
      maxConsecutiveFailures: 3,
      tripped: false,
    })
  })
})
