import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/protocol/passport/[id]/health/route"
import {
  resetPassportStore,
  setPassport,
  type PassportRecord,
} from "@/lib/passport/passport"

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
const AGENT_ID = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

function passport(overrides: Partial<PassportRecord> = {}): PassportRecord {
  return {
    id: "passport-health-123",
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

describe("GET /api/protocol/passport/:agentId/health", () => {
  beforeEach(() => {
    resetPassportStore()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns 404 when the agent has no passport", async () => {
    const response = await getHealth("missing-agent")

    expect(response.status).toBe(404)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      ok: false,
      error: "passport_not_found",
    })
  })

  it("returns active health with null optional data when no expiry is stored", async () => {
    setPassport(passport())

    const response = await getHealth()

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      ok: true,
      agentId: AGENT_ID,
      status: "active",
      expiresAt: null,
      daysRemaining: null,
      hoursRemaining: null,
      fullLifeExpiryHoursRemaining: null,
      spendingLimits: null,
      dailySpentXlm: 0,
      weeklySpentXlm: 0,
      circuitBreakerStatus: null,
    })
  })

  it("returns days remaining and full-life hours when at least 24 hours remain", async () => {
    setPassport(passport({ expiresAt: "2026-06-29T18:00:00.000Z" }))

    const response = await getHealth()
    const body = await response.json()

    expect(body).toMatchObject({
      status: "active",
      expiresAt: "2026-06-29T18:00:00.000Z",
      daysRemaining: 2,
      hoursRemaining: null,
      fullLifeExpiryHoursRemaining: 54,
    })
  })

  it("returns zero days and populated hours when less than 24 hours remain", async () => {
    setPassport(passport({ expiresAt: "2026-06-28T05:30:00.000Z" }))

    const response = await getHealth()
    const body = await response.json()

    expect(body).toMatchObject({
      status: "active",
      daysRemaining: 0,
      hoursRemaining: 18,
      fullLifeExpiryHoursRemaining: 18,
    })
  })

  it("returns expired with zero remaining time for a past expiry", async () => {
    setPassport(passport({ expiresAt: "2026-06-27T11:59:59.000Z" }))

    const response = await getHealth()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: "expired",
      daysRemaining: 0,
      hoursRemaining: 0,
      fullLifeExpiryHoursRemaining: 0,
    })
  })

  it("preserves a stored expired status when no expiry timestamp exists", async () => {
    setPassport(passport({ status: "expired" }))

    const response = await getHealth()
    const body = await response.json() as { status: string }

    expect(response.status).toBe(200)
    expect(body.status).toBe("expired")
  })

  it("returns suspended for a suspended passport", async () => {
    setPassport(passport({ status: "suspended" }))

    const response = await getHealth()
    const body = await response.json() as { status: string }

    expect(response.status).toBe(200)
    expect(body.status).toBe("suspended")
  })

  it("returns revoked even when the stored expiry is in the past", async () => {
    setPassport(passport({
      status: "revoked",
      expiresAt: "2026-06-27T11:59:59.000Z",
    }))

    const response = await getHealth()
    const body = await response.json() as { status: string }

    expect(response.status).toBe(200)
    expect(body.status).toBe("revoked")
  })
})
