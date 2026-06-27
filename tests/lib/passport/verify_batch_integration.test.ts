import { describe, it, expect, beforeEach, vi } from "vitest"
import { POST as verifyBatchApi } from "@/app/api/passports/verify-batch/route"
import {
  issuePassport,
  resetPassportStore,
} from "@/lib/passport/passport"
import { revokePassport, resetRevocationStore } from "@/lib/passport/revocation"
import { resetAuditStore } from "@/lib/passport/audit"

// Mock next/server
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

const AGENT_A = "GA111111111111111111111111111111111111111111111111111111"
const AGENT_B = "GB222222222222222222222222222222222222222222222222222222"

describe("verify-batch API integration tests", () => {
  beforeEach(() => {
    resetPassportStore()
    resetRevocationStore()
    resetAuditStore()
  })

  it("returns 200 and correct status for all valid IDs", async () => {
    issuePassport("id-1", AGENT_A, "issuer-1")
    issuePassport("id-2", AGENT_B, "issuer-1")

    const req = new Request("http://localhost/api/passports/verify-batch", {
      method: "POST",
      body: JSON.stringify({ passportIds: ["id-1", "id-2"] }),
    })

    const res = await verifyBatchApi(req)
    expect(res.status).toBe(200)

    const data = await res.json() as any
    expect(data.total).toBe(2)
    expect(data.validCount).toBe(2)
    expect(data.invalidCount).toBe(0)
    expect(data.results).toEqual([
      { passportId: "id-1", status: "active", agentId: AGENT_A, valid: true },
      { passportId: "id-2", status: "active", agentId: AGENT_B, valid: true },
    ])
  })

  it("handles a mix of valid, revoked, and unknown IDs without failing the whole request", async () => {
    issuePassport("id-1", AGENT_A, "issuer-1")

    issuePassport("id-2", AGENT_B, "issuer-1")
    revokePassport("id-2", { reason: "security_compromise" }, "admin")

    const req = new Request("http://localhost/api/passports/verify-batch", {
      method: "POST",
      body: JSON.stringify({ passportIds: ["id-1", "id-2", "unknown-id"] }),
    })

    const res = await verifyBatchApi(req)
    expect(res.status).toBe(200)

    const data = await res.json() as any
    expect(data.total).toBe(3)
    expect(data.validCount).toBe(1)
    expect(data.invalidCount).toBe(2)
    expect(data.results).toEqual([
      { passportId: "id-1", status: "active", agentId: AGENT_A, valid: true },
      { passportId: "id-2", status: "revoked", agentId: AGENT_B, valid: false },
      { passportId: "unknown-id", status: null, agentId: null, valid: false, error: "not_found" },
    ])
  })

  it("returns 400 if passportIds array is empty", async () => {
    const req = new Request("http://localhost/api/passports/verify-batch", {
      method: "POST",
      body: JSON.stringify({ passportIds: [] }),
    })

    const res = await verifyBatchApi(req)
    expect(res.status).toBe(400)

    const data = await res.json() as any
    expect(data.ok).toBe(false)
    expect(data.error).toContain("passportIds must be a non-empty array")
  })

  it("returns 400 if passportIds is not an array", async () => {
    const req = new Request("http://localhost/api/passports/verify-batch", {
      method: "POST",
      body: JSON.stringify({ passportIds: "not-an-array" }),
    })

    const res = await verifyBatchApi(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 if passportIds contains more than 50 IDs", async () => {
    const largeBatch = Array.from({ length: 51 }, (_, i) => `id-${i}`)
    const req = new Request("http://localhost/api/passports/verify-batch", {
      method: "POST",
      body: JSON.stringify({ passportIds: largeBatch }),
    })

    const res = await verifyBatchApi(req)
    expect(res.status).toBe(400)

    const data = await res.json() as any
    expect(data.ok).toBe(false)
    expect(data.error).toContain("Cannot verify more than 50 passport IDs at once")
  })
})
