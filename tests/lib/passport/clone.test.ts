import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { POST as clonePassportApi } from "@/app/api/passports/[id]/clone/route"
import { POST as cloneProtocolPassportApi } from "@/app/api/protocol/passport/[id]/clone/route"
import {
  getPassport,
  issuePassport,
  resetPassportStore,
  setPassport,
  type PassportRecord,
} from "@/lib/passport/passport"
import { listAuditEntries, resetAuditStore } from "@/lib/passport/audit"

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
const ADMIN_KEY = "test-admin-key-issue-129"
const SOURCE_PASSPORT_ID = "passport-src-001"
const AGENT_ID = "agent-stellar-42"
const ACTOR = "GADMIN_STELLAR_TEST"

function cloneRequest(
  passportId: string,
  body: unknown = {},
  adminKey: string | null = ADMIN_KEY,
  actor: string | null = ACTOR,
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (adminKey !== null) {
    headers["x-admin-key"] = adminKey
  }
  if (actor !== null) {
    headers["x-stellar-address"] = actor
  }

  return new Request(
    `http://localhost/api/passports/${encodeURIComponent(passportId)}/clone`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  )
}

describe("POST /api/passports/:id/clone - Passport clone endpoint", () => {
  let originalAdminKey: string | undefined

  beforeEach(() => {
    originalAdminKey = process.env.ADMIN_API_KEY
    process.env.ADMIN_API_KEY = ADMIN_KEY
    resetPassportStore()
    resetAuditStore()
  })

  afterEach(() => {
    if (originalAdminKey === undefined) {
      delete process.env.ADMIN_API_KEY
    } else {
      process.env.ADMIN_API_KEY = originalAdminKey
    }
  })

  it("happy path: clones an existing passport with fresh issuedAt, copied metadata, recalculated credentials, and active status", async () => {
    const originalIssuedAt = "2026-01-01T00:00:00.000Z"
    const originalExpiresAt = "2026-01-31T00:00:00.000Z" // 30-day TTL

    const metadata = {
      tier: "gold",
      organization: "soroban-agents",
      customLimit: 5000,
    }

    const credentials = [
      {
        id: "cred-identity-1",
        type: "IdentityCredential",
        issuer: "stellar-did-authority",
        issuedAt: originalIssuedAt,
        expiresAt: originalExpiresAt, // 30 day TTL
      },
      {
        id: "cred-reputation-2",
        type: "ReputationScore",
        score: 950,
        issuedAt: "2026-01-10T00:00:00.000Z",
        expiresAt: "2026-01-20T00:00:00.000Z", // 10 day TTL
        ttlMs: 10 * DAY_MS,
      },
    ]

    // Create source passport
    setPassport({
      id: SOURCE_PASSPORT_ID,
      agentId: AGENT_ID,
      status: "active",
      config: { allowTransfer: true },
      createdAt: originalIssuedAt,
      issuedAt: originalIssuedAt,
      expiresAt: originalExpiresAt,
      metadata,
      credentials,
    })

    const sourceBefore = structuredClone(getPassport(SOURCE_PASSPORT_ID)!)

    const beforeMs = Date.now()
    const response = await clonePassportApi(cloneRequest(SOURCE_PASSPORT_ID), {
      params: Promise.resolve({ id: SOURCE_PASSPORT_ID }),
    })
    const afterMs = Date.now()

    expect(response.status).toBe(201)
    const cloned = (await response.json()) as PassportRecord

    // Verify cloned passport properties
    expect(cloned.id).toBe(`${SOURCE_PASSPORT_ID}-clone`)
    expect(cloned.agentId).toBe(AGENT_ID)
    expect(cloned.status).toBe("active")
    expect(cloned.config).toEqual(sourceBefore.config)

    // IssuedAt / createdAt must be updated to now
    const clonedIssuedAtMs = Date.parse(cloned.issuedAt!)
    expect(clonedIssuedAtMs).toBeGreaterThanOrEqual(beforeMs)
    expect(clonedIssuedAtMs).toBeLessThanOrEqual(afterMs)
    expect(cloned.createdAt).toBe(cloned.issuedAt)

    // Metadata copied accurately
    expect(cloned.metadata).toEqual(metadata)

    // Credentials recalculated from now (not copied directly from old dates)
    expect(cloned.credentials).toHaveLength(2)

    // First credential (30 day TTL recalculated from now)
    const cred1 = cloned.credentials![0]
    expect(cred1.id).toBe("cred-identity-1")
    expect(cred1.type).toBe("IdentityCredential")
    expect(cred1.issuedAt).toBe(cloned.issuedAt)
    const cred1ExpiryMs = Date.parse(cred1.expiresAt!)
    expect(cred1ExpiryMs).toBeGreaterThanOrEqual(beforeMs + 30 * DAY_MS)
    expect(cred1ExpiryMs).toBeLessThanOrEqual(afterMs + 30 * DAY_MS)

    // Second credential (10 day TTL recalculated from now)
    const cred2 = cloned.credentials![1]
    expect(cred2.id).toBe("cred-reputation-2")
    expect(cred2.score).toBe(950)
    expect(cred2.issuedAt).toBe(cloned.issuedAt)
    const cred2ExpiryMs = Date.parse(cred2.expiresAt!)
    expect(cred2ExpiryMs).toBeGreaterThanOrEqual(beforeMs + 10 * DAY_MS)
    expect(cred2ExpiryMs).toBeLessThanOrEqual(afterMs + 10 * DAY_MS)

    // Source passport remains completely unchanged in store
    const sourceAfter = getPassport(SOURCE_PASSPORT_ID)
    expect(sourceAfter).toEqual(sourceBefore)
    expect(sourceAfter?.issuedAt).toBe(originalIssuedAt)
    expect(sourceAfter?.credentials![0].expiresAt).toBe(originalExpiresAt)

    // Audit log contains cloned action
    const entries = listAuditEntries(SOURCE_PASSPORT_ID)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      passportId: SOURCE_PASSPORT_ID,
      action: "cloned",
      actor: ACTOR,
      target: cloned.id,
    })
  })

  it("returns 404 when cloning a non-existent source passport", async () => {
    const nonExistentId = "passport-does-not-exist"
    const response = await clonePassportApi(cloneRequest(nonExistentId), {
      params: Promise.resolve({ id: nonExistentId }),
    })

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body).toEqual({ ok: false, error: "passport_not_found" })
  })

  it("successfully clones a revoked source passport as active (recovery migration)", async () => {
    setPassport({
      id: "revoked-passport-1",
      agentId: "agent-compromised",
      status: "revoked",
      config: { allowTransfer: false },
      createdAt: "2026-02-01T00:00:00.000Z",
      issuedAt: "2026-02-01T00:00:00.000Z",
      expiresAt: "2026-03-01T00:00:00.000Z",
      metadata: { recoveryReason: "key_rotation" },
      credentials: [
        {
          id: "cred-rec-1",
          type: "StellarAuthKey",
          issuedAt: "2026-02-01T00:00:00.000Z",
          expiresAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    })

    const response = await clonePassportApi(cloneRequest("revoked-passport-1", {
      reason: "Recovery migration after wallet compromise",
    }), {
      params: Promise.resolve({ id: "revoked-passport-1" }),
    })

    expect(response.status).toBe(201)
    const cloned = (await response.json()) as PassportRecord

    // Cloned passport is active
    expect(cloned.status).toBe("active")
    expect(cloned.id).toBe("revoked-passport-1-clone")

    // Source passport is UNCHANGED and remains revoked
    const source = getPassport("revoked-passport-1")
    expect(source?.status).toBe("revoked")

    // Audit trail records clone
    const entries = listAuditEntries("revoked-passport-1")
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe("cloned")
    expect(entries[0].reason).toBe("Recovery migration after wallet compromise")
  })

  it("successfully clones an expired source passport", async () => {
    setPassport({
      id: "expired-passport-1",
      agentId: "agent-expired",
      status: "expired",
      config: { allowTransfer: true },
      createdAt: "2026-01-01T00:00:00.000Z",
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-31T00:00:00.000Z",
    })

    const response = await clonePassportApi(cloneRequest("expired-passport-1"), {
      params: Promise.resolve({ id: "expired-passport-1" }),
    })

    expect(response.status).toBe(201)
    const cloned = (await response.json()) as PassportRecord
    expect(cloned.status).toBe("active")
    expect(getPassport("expired-passport-1")?.status).toBe("expired")
  })

  it("successfully clones a suspended source passport", async () => {
    setPassport({
      id: "suspended-passport-1",
      agentId: "agent-suspended",
      status: "suspended",
      config: { allowTransfer: true },
      createdAt: "2026-01-01T00:00:00.000Z",
    })

    const response = await clonePassportApi(cloneRequest("suspended-passport-1"), {
      params: Promise.resolve({ id: "suspended-passport-1" }),
    })

    expect(response.status).toBe(201)
    const cloned = (await response.json()) as PassportRecord
    expect(cloned.status).toBe("active")
    expect(getPassport("suspended-passport-1")?.status).toBe("suspended")
  })

  it("rejects with 401 Unauthorized when x-admin-key header is missing", async () => {
    issuePassport(SOURCE_PASSPORT_ID, AGENT_ID, ACTOR)

    const response = await clonePassportApi(cloneRequest(SOURCE_PASSPORT_ID, {}, null), {
      params: Promise.resolve({ id: SOURCE_PASSPORT_ID }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, error: "Unauthorized" })
    expect(getPassport(`${SOURCE_PASSPORT_ID}-clone`)).toBeNull()
  })

  it("rejects with 401 Unauthorized when x-admin-key header is invalid", async () => {
    issuePassport(SOURCE_PASSPORT_ID, AGENT_ID, ACTOR)

    const response = await clonePassportApi(cloneRequest(SOURCE_PASSPORT_ID, {}, "wrong-admin-key"), {
      params: Promise.resolve({ id: SOURCE_PASSPORT_ID }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, error: "Unauthorized" })
    expect(getPassport(`${SOURCE_PASSPORT_ID}-clone`)).toBeNull()
  })

  it("supports custom cloned ID and agentId in request body", async () => {
    issuePassport(SOURCE_PASSPORT_ID, AGENT_ID, ACTOR, { allowTransfer: true }, null, { role: "bot" })

    const response = await clonePassportApi(
      cloneRequest(SOURCE_PASSPORT_ID, {
        id: "custom-migrated-passport-999",
        agentId: "new-migrated-agent",
      }),
      {
        params: Promise.resolve({ id: SOURCE_PASSPORT_ID }),
      },
    )

    expect(response.status).toBe(201)
    const cloned = (await response.json()) as PassportRecord
    expect(cloned.id).toBe("custom-migrated-passport-999")
    expect(cloned.agentId).toBe("new-migrated-agent")
    expect(cloned.metadata).toEqual({ role: "bot" })
    expect(getPassport("custom-migrated-passport-999")).toEqual(cloned)
  })

  it("protocol route alias /api/protocol/passport/:id/clone behaves identically", async () => {
    issuePassport(SOURCE_PASSPORT_ID, AGENT_ID, ACTOR)

    const req = new Request(
      `http://localhost/api/protocol/passport/${SOURCE_PASSPORT_ID}/clone`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-key": ADMIN_KEY,
          "x-stellar-address": ACTOR,
        },
        body: JSON.stringify({}),
      },
    )

    const response = await cloneProtocolPassportApi(req, {
      params: Promise.resolve({ id: SOURCE_PASSPORT_ID }),
    })

    expect(response.status).toBe(201)
    const cloned = (await response.json()) as PassportRecord
    expect(cloned.id).toBe(`${SOURCE_PASSPORT_ID}-clone`)
    expect(cloned.status).toBe("active")
  })
})
