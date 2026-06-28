import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  issuePassport,
  suspendPassport,
  reactivatePassport,
  expirePassport,
  clonePassport,
  resetPassportStore,
  getPassport,
} from "@/lib/passport/passport"
import { revokePassport, resetRevocationStore } from "@/lib/passport/revocation"
import { transferPassport, resetTransferStore } from "@/lib/passport/transfer"
import { resetAuditStore, listAuditEntries, listAuditEntriesByActor } from "@/lib/passport/audit"
import { GET as getPassportAudit } from "@/app/api/passports/[id]/audit/route"
import { GET as getActorAudit } from "@/app/api/audit/route"
import { GET as runExpiryCron } from "@/app/api/cron/expiry/route"
import { POST as revokePassportApi } from "@/app/api/protocol/passport/[id]/revoke/route"
import { POST as transferPassportApi } from "@/app/api/protocol/passport/[id]/transfer/route"

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
    NextRequest: class {
      url: string
      headers: Headers
      constructor(url: string, init?: { headers?: Record<string, string> }) {
        this.url = url
        this.headers = new Headers(init?.headers)
      }
    },
  }
})

const PASSPORT_ID = "passport-test-123"
const AGENT_ID = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const NEW_AGENT_ID = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW"
const ACTOR = "GB111111111111111111111111111111111111111111111111111111"

describe("Audit Trail Integration & API", () => {
  let originalCronSecret: string | undefined

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET
    process.env.CRON_SECRET = "supersecret"
    resetPassportStore()
    resetRevocationStore()
    resetTransferStore()
    resetAuditStore()
    vi.useRealTimers()
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret
  })


  // ─── Lifecycle Actions ───────────────────────────────────────────
  describe("Lifecycle Actions", () => {
    it("should record an audit entry when a passport is issued", () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)

      const entries = listAuditEntries(PASSPORT_ID)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        passportId: PASSPORT_ID,
        action: "issued",
        actor: ACTOR,
      })
    })

    it("should record an audit entry when a passport is revoked", () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)
      revokePassport(PASSPORT_ID, { reason: "security_compromise", notes: "leak" }, ACTOR)

      const entries = listAuditEntries(PASSPORT_ID)
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        passportId: PASSPORT_ID,
        action: "revoked",
        actor: ACTOR,
        reason: "security_compromise",
      })
      expect(entries[0].metadata).toEqual({ notes: "leak" })
      expect(getPassport(PASSPORT_ID)?.status).toBe("revoked")
    })

    it("should record an audit entry when a passport is suspended", () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)
      suspendPassport(PASSPORT_ID, ACTOR, "Temporary suspension")

      const entries = listAuditEntries(PASSPORT_ID)
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        passportId: PASSPORT_ID,
        action: "suspended",
        actor: ACTOR,
        reason: "Temporary suspension",
      })
      expect(getPassport(PASSPORT_ID)?.status).toBe("suspended")
    })

    it("should record an audit entry when a passport is reactivated", () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)
      suspendPassport(PASSPORT_ID, ACTOR)
      reactivatePassport(PASSPORT_ID, ACTOR, "Reactivation ok")

      const entries = listAuditEntries(PASSPORT_ID)
      expect(entries).toHaveLength(3)
      expect(entries[0]).toMatchObject({
        passportId: PASSPORT_ID,
        action: "reactivated",
        actor: ACTOR,
        reason: "Reactivation ok",
      })
      expect(getPassport(PASSPORT_ID)?.status).toBe("active")
    })

    it("should record an audit entry when a passport is expired", () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)
      expirePassport(PASSPORT_ID, ACTOR, "TTL expiry")

      const entries = listAuditEntries(PASSPORT_ID)
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        passportId: PASSPORT_ID,
        action: "expired",
        actor: ACTOR,
        reason: "TTL expiry",
      })
      expect(getPassport(PASSPORT_ID)?.status).toBe("expired")
    })

    it("should record an audit entry when a passport is cloned", () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)
      clonePassport(PASSPORT_ID, NEW_AGENT_ID, ACTOR, "Cloning original")

      const entries = listAuditEntries(PASSPORT_ID)
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        passportId: PASSPORT_ID,
        action: "cloned",
        actor: ACTOR,
        target: `${PASSPORT_ID}-clone`,
        reason: "Cloning original",
      })
    })

    it("should record an audit entry when a passport is transferred", () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)
      transferPassport(PASSPORT_ID, AGENT_ID, { newOwnerAddress: NEW_AGENT_ID, reason: "transfer wallet" })

      const entries = listAuditEntries(PASSPORT_ID)
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        passportId: PASSPORT_ID,
        action: "transferred",
        actor: AGENT_ID,
        target: NEW_AGENT_ID,
        reason: "transfer wallet",
      })
    })
  })

  // ─── API Routes ──────────────────────────────────────────────────
  describe("API Route: GET /api/passports/:id/audit", () => {
    it("returns 404 for non-existent passport", async () => {
      const res = await getPassportAudit(new Request("http://localhost/api/passports/nonexistent/audit"), {
        params: Promise.resolve({ id: "nonexistent" }),
      })
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body).toEqual({ ok: false, error: "passport_not_found" })
    })

    it("returns all audit entries sorted newest-first", async () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)
      suspendPassport(PASSPORT_ID, ACTOR)

      const res = await getPassportAudit(new Request(`http://localhost/api/passports/${PASSPORT_ID}/audit`), {
        params: Promise.resolve({ id: PASSPORT_ID }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { passportId: string; entries: any[]; total: number }
      expect(body.passportId).toBe(PASSPORT_ID)
      expect(body.total).toBe(2)
      expect(body.entries[0].action).toBe("suspended")
      expect(body.entries[1].action).toBe("issued")
    })
  })

  describe("API Route: GET /api/audit?actor=<address>", () => {
    it("returns 400 if actor query parameter is missing", async () => {
      const req = new NextRequest("http://localhost/api/audit") as any
      const res = await getActorAudit(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body).toEqual({ ok: false, error: "actor query parameter is required" })
    })

    it("returns cross-passport entries for the given actor address", async () => {
      const anotherPassport = "passport-456"
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)
      issuePassport(anotherPassport, AGENT_ID, "ANOTHER_ACTOR")
      suspendPassport(anotherPassport, ACTOR)

      const req = new NextRequest(`http://localhost/api/audit?actor=${ACTOR}`) as any
      const res = await getActorAudit(req)
      expect(res.status).toBe(200)
      const body = await res.json() as { actor: string; entries: any[]; total: number }
      expect(body.actor).toBe(ACTOR)
      expect(body.total).toBe(2)
      expect(body.entries[0].action).toBe("suspended")
      expect(body.entries[0].passportId).toBe(anotherPassport)
      expect(body.entries[1].action).toBe("issued")
      expect(body.entries[1].passportId).toBe(PASSPORT_ID)
    })
  })

  // ─── Expiry Cron Job ─────────────────────────────────────────────
  describe("API Route: GET /api/cron/expiry", () => {
    it("should return 401 Unauthorized if cron secret is invalid", async () => {
      const res = await runExpiryCron(new Request("http://localhost/api/cron/expiry", {
        headers: { authorization: "Bearer invalid_secret" }
      }))
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toEqual({ ok: false, error: "Unauthorized" })
    })

    it("should return 401 Unauthorized if authorization header is missing", async () => {
      const res = await runExpiryCron(new Request("http://localhost/api/cron/expiry"))
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toEqual({ ok: false, error: "Unauthorized" })
    })

    it("should mark active passports older than 30 days as expired and record audit trail", async () => {
      vi.useFakeTimers()
      const now = new Date("2026-06-27T09:00:00Z").getTime()
      vi.setSystemTime(now)

      // Issued today (should not expire)
      const activeId = "active-passport"
      issuePassport(activeId, AGENT_ID, ACTOR)

      // Issued 31 days ago (should expire)
      const expiredId = "expired-passport"
      const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000
      vi.setSystemTime(thirtyOneDaysAgo)
      issuePassport(expiredId, AGENT_ID, ACTOR)

      // Reset system time to today
      vi.setSystemTime(now)

      const res = await runExpiryCron(new Request("http://localhost/api/cron/expiry", {
        headers: { authorization: "Bearer supersecret" }
      }))
      expect(res.status).toBe(200)
      const body = await res.json() as { ok: boolean; expiredCount: number; expiredIds: string[] }
      expect(body.ok).toBe(true)
      expect(body.expiredCount).toBe(1)
      expect(body.expiredIds).toEqual([expiredId])

      // Check statuses
      expect(getPassport(activeId)?.status).toBe("active")
      expect(getPassport(expiredId)?.status).toBe("expired")

      // Check audit log for expired passport
      const entries = listAuditEntries(expiredId)
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        passportId: expiredId,
        action: "expired",
        actor: "cron",
        reason: "expired_by_cron_ttl",
      })
    })
  })


  // ─── Endpoint Revocation Integration ─────────────────────────────
  describe("API Route Integration: POST /api/protocol/passport/:id/revoke", () => {
    it("passes actor from x-stellar-address header to revokePassport", async () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)

      const req = new Request(`http://localhost/api/protocol/passport/${PASSPORT_ID}/revoke`, {
        method: "POST",
        headers: {
          "x-stellar-address": ACTOR,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "policy_violation", notes: "test note" }),
      })

      const res = await revokePassportApi(req, { params: Promise.resolve({ id: PASSPORT_ID }) })
      expect(res.status).toBe(200)

      const entries = listAuditEntries(PASSPORT_ID)
      expect(entries).toHaveLength(2)
      expect(entries[0].action).toBe("revoked")
      expect(entries[0].actor).toBe(ACTOR)
    })
  })

  // ─── Endpoint Transfer Integration ───────────────────────────────
  describe("API Route Integration: POST /api/protocol/passport/:id/transfer", () => {
    it("passes owner from x-stellar-address to transferPassport and records audit log", async () => {
      issuePassport(PASSPORT_ID, AGENT_ID, ACTOR)

      const req = new Request(`http://localhost/api/protocol/passport/${PASSPORT_ID}/transfer`, {
        method: "POST",
        headers: {
          "x-stellar-address": AGENT_ID,
          "content-type": "application/json",
        },
        body: JSON.stringify({ newOwnerAddress: NEW_AGENT_ID, reason: "rotating wallet" }),
      })

      const res = await transferPassportApi(req, { params: Promise.resolve({ id: PASSPORT_ID }) })
      expect(res.status).toBe(200)

      const entries = listAuditEntries(PASSPORT_ID)
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        passportId: PASSPORT_ID,
        action: "transferred",
        actor: AGENT_ID,
        target: NEW_AGENT_ID,
        reason: "rotating wallet",
      })
    })
  })
})
