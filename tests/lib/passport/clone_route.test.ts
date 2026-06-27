import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST as clonePassportApi } from "@/app/api/passports/[id]/clone/route"
import {
  issuePassport,
  getPassport,
  resetPassportStore,
  getCredentialsByPassportId,
} from "@/lib/passport/passport"
import { revokePassport, resetRevocationStore } from "@/lib/passport/revocation"
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

function request(): Request {
  return new Request("http://localhost/api/passports/orig/clone", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stellar-address": "admin",
    },
  })
}

describe("POST /api/passports/:id/clone", () => {
  beforeEach(() => {
    resetPassportStore()
    resetRevocationStore()
    resetAuditStore()
  })

  it("clones an existing passport and recalculates expiresAt from now", async () => {
    const now = Date.now()
    const ttlDays = 7
    const expiresAt = new Date(now + ttlDays * 24 * 60 * 60 * 1000).toISOString()
    issuePassport("orig", "agent-1", "issuer-1", { allowTransfer: true }, expiresAt)

    const res = await clonePassportApi(request(), { params: Promise.resolve({ id: "orig" }) })
    expect(res.status).toBe(201)
    const body = await res.json() as any

    expect(body.id).not.toBe("orig")
    expect(body.agentId).toBe("agent-1")
    expect(Date.parse(body.createdAt)).toBeGreaterThanOrEqual(now)
    const newExpires = Date.parse(body.expiresAt)
    expect(newExpires).toBeGreaterThanOrEqual(now + ttlDays * 24 * 60 * 60 * 1000)

    const src = getPassport("orig")
    expect(src).not.toBeNull()
    expect(src?.id).toBe("orig")
  })

  it("returns 404 when source passport does not exist", async () => {
    const res = await clonePassportApi(request(), { params: Promise.resolve({ id: "does-not-exist" }) })
    expect(res.status).toBe(404)
    const body = await res.json() as any
    expect(body).toEqual({ ok: false, error: "passport_not_found" })
  })

  it("allows cloning a revoked passport", async () => {
    issuePassport("orig2", "agent-2", "issuer-1")
    revokePassport("orig2", { reason: "admin_override" }, "admin")

    const res = await clonePassportApi(request(), { params: Promise.resolve({ id: "orig2" }) })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.agentId).toBe("agent-2")
    expect(body.status).toBe("active")
  })

  it("copies metadata from source passport", async () => {
    const metadata = { tier: "premium", region: "us-east" }
    issuePassport("orig3", "agent-3", "issuer-1", { allowTransfer: true }, undefined, metadata as any)

    const res = await clonePassportApi(request(), { params: Promise.resolve({ id: "orig3" }) })
    expect(res.status).toBe(201)
    const body = await res.json() as any

    expect(body.metadata).toEqual(metadata)
    expect(getPassport("orig3")?.metadata).toEqual(metadata)
  })

  it("copies credentials with recalculated expiry from now", async () => {
    const now = Date.now()
    const passportExpiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString()
    const credentialExpiresAt = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString()

    const credentials = [
      { id: "cred-1", passportId: "orig4", expiresAt: credentialExpiresAt },
      { id: "cred-2", passportId: "orig4", expiresAt: null },
    ]

    issuePassport("orig4", "agent-4", "issuer-1", { allowTransfer: true }, passportExpiresAt, null, credentials as any)

    const res = await clonePassportApi(request(), { params: Promise.resolve({ id: "orig4" }) })
    expect(res.status).toBe(201)
    const body = await res.json() as any

    expect(body.credentials).toHaveLength(2)
    expect(body.credentials[0].id).not.toBe("cred-1")
    expect(body.credentials[0].expiresAt).toMatch(/T\d{2}:\d{2}:\d{2}/)
    expect(body.credentials[1].expiresAt).toBeNull()

    const clonedCreds = getCredentialsByPassportId(body.id)
    expect(clonedCreds).toHaveLength(2)
  })
})
