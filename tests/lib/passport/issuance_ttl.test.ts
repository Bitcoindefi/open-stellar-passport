import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST as issuePassportApi } from "@/app/api/protocol/passport/route"
import { getPassport, resetPassportStore } from "@/lib/passport/passport"
import { resetAuditStore } from "@/lib/passport/audit"

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

const DAY_MS = 24 * 60 * 60 * 1000
const originalTtlDays = process.env.PASSPORT_DEFAULT_TTL_DAYS

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/protocol/passport", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stellar-address": "issuer-1",
    },
    body: JSON.stringify(body),
  })
}

describe("passport issuance TTL", () => {
  beforeEach(() => {
    resetPassportStore()
    resetAuditStore()
    delete process.env.PASSPORT_DEFAULT_TTL_DAYS
  })

  afterEach(() => {
    if (originalTtlDays === undefined) {
      delete process.env.PASSPORT_DEFAULT_TTL_DAYS
    } else {
      process.env.PASSPORT_DEFAULT_TTL_DAYS = originalTtlDays
    }
  })

  it("defaults expiresAt to 30 days from now when omitted", async () => {
    const before = Date.now()
    const response = await issuePassportApi(request({
      id: "passport-default-ttl",
      agentId: "agent-default-ttl",
    }))
    const after = Date.now()
    const body = await response.json() as { expiresAt: string }

    expect(response.status).toBe(201)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS)
    expect(new Date(body.expiresAt).getTime()).toBeLessThanOrEqual(after + 30 * DAY_MS + 1000)
    expect(getPassport("passport-default-ttl")?.expiresAt).toBe(body.expiresAt)
  })

  it("uses PASSPORT_DEFAULT_TTL_DAYS when expiresAt is omitted", async () => {
    process.env.PASSPORT_DEFAULT_TTL_DAYS = "7"
    const before = Date.now()

    const response = await issuePassportApi(request({
      id: "passport-custom-ttl",
      agentId: "agent-custom-ttl",
    }))
    const body = await response.json() as { expiresAt: string }

    expect(new Date(body.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 7 * DAY_MS)
    expect(new Date(body.expiresAt).getTime()).toBeLessThanOrEqual(before + 7 * DAY_MS + 1000)
  })

  it.each(["invalid", "0", "-1", "1.5"])(
    "falls back to 30 days for an unsafe TTL value of %s",
    async (ttlDays) => {
      process.env.PASSPORT_DEFAULT_TTL_DAYS = ttlDays
      const before = Date.now()

      const response = await issuePassportApi(request({
        id: `passport-unsafe-ttl-${ttlDays}`,
        agentId: `agent-unsafe-ttl-${ttlDays}`,
      }))
      const body = await response.json() as { expiresAt: string }

      expect(new Date(body.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS)
      expect(new Date(body.expiresAt).getTime()).toBeLessThanOrEqual(before + 30 * DAY_MS + 1000)
    },
  )

  it("preserves a caller-supplied future expiresAt", async () => {
    const expiresAt = new Date(Date.now() + 5 * DAY_MS).toISOString()

    const response = await issuePassportApi(request({
      id: "passport-explicit-ttl",
      agentId: "agent-explicit-ttl",
      expiresAt,
    }))
    const body = await response.json() as { expiresAt: string }

    expect(response.status).toBe(201)
    expect(body.expiresAt).toBe(expiresAt)
    expect(getPassport("passport-explicit-ttl")?.expiresAt).toBe(expiresAt)
  })

  it.each([
    ["past", new Date(Date.now() - DAY_MS).toISOString()],
    ["invalid", "not-a-date"],
  ])("rejects a %s caller-supplied expiresAt", async (_label, expiresAt) => {
    const response = await issuePassportApi(request({
      id: "passport-invalid-ttl",
      agentId: "agent-invalid-ttl",
      expiresAt,
    }))
    const body = await response.json() as { ok: boolean; error: string }

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toContain("expiresAt")
    expect(getPassport("passport-invalid-ttl")).toBeNull()
  })
})
