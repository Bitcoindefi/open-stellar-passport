import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  appendAdminAuditEntry,
  listAdminAuditEntries,
  resetAdminAuditStore,
  type AdminAuditEntry,
} from "@/lib/passport/audit-log"
import {
  issuePassport,
  resetPassportStore,
} from "@/lib/passport/passport"
import { resetRevocationStore } from "@/lib/passport/revocation"
import { resetTransferStore } from "@/lib/passport/transfer"
import { resetAuditStore } from "@/lib/passport/audit"
import { POST as grantPost } from "@/app/api/protocol/passport/route"
import { POST as verifyBatchPost } from "@/app/api/passports/verify-batch/route"
import { GET as adminAuditGet } from "@/app/api/admin/audit/route"

// Mock next/server for route handler tests
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

const ADMIN = "GADMIN1111111111111111111111111111111111111111111111111"
const TARGET_PASSPORT = "passport-abc-123"
const TARGET_ADMIN = "GADMIN2222222222222222222222222222222222222222222222222"

describe("Admin Audit Log", () => {
  let originalAdminApiKey: string | undefined

  beforeEach(() => {
    originalAdminApiKey = process.env.ADMIN_API_KEY
    process.env.ADMIN_API_KEY = "test-admin-api-key"
    resetAdminAuditStore()
    resetPassportStore()
    resetRevocationStore()
    resetTransferStore()
    resetAuditStore()
  })

  afterEach(() => {
    process.env.ADMIN_API_KEY = originalAdminApiKey
  })

  // ─── Store-Level Tests ──────────────────────────────────────────
  describe("Store: appendAdminAuditEntry & listAdminAuditEntries", () => {
    it("perform 3 actions → audit returns 3 entries with correct fields", () => {
      appendAdminAuditEntry({
        action: "grant",
        actor: ADMIN,
        target: TARGET_PASSPORT,
      })
      appendAdminAuditEntry({
        action: "revoke",
        actor: ADMIN,
        target: TARGET_PASSPORT,
        metadata: { reason: "policy_violation" },
      })
      appendAdminAuditEntry({
        action: "admin_transfer",
        actor: ADMIN,
        target: TARGET_ADMIN,
      })

      const entries = listAdminAuditEntries()
      expect(entries).toHaveLength(3)

      // Newest first
      expect(entries[0].action).toBe("admin_transfer")
      expect(entries[1].action).toBe("revoke")
      expect(entries[2].action).toBe("grant")

      // Correct fields
      for (const entry of entries) {
        expect(entry.id).toBeDefined()
        expect(entry.actor).toBe(ADMIN)
        expect(typeof entry.timestamp).toBe("number")
      }

      expect(entries[1].metadata).toEqual({ reason: "policy_violation" })
    })

    it("filters by action", () => {
      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p1" })
      appendAdminAuditEntry({ action: "revoke", actor: ADMIN, target: "p2" })
      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p3" })

      const grants = listAdminAuditEntries({ action: "grant" })
      expect(grants).toHaveLength(2)
      expect(grants.every(e => e.action === "grant")).toBe(true)
    })

    it("filters by actor", () => {
      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p1" })
      appendAdminAuditEntry({ action: "grant", actor: TARGET_ADMIN, target: "p2" })

      const entries = listAdminAuditEntries({ actor: ADMIN })
      expect(entries).toHaveLength(1)
      expect(entries[0].target).toBe("p1")
    })

    it("filters by target", () => {
      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p1" })
      appendAdminAuditEntry({ action: "revoke", actor: ADMIN, target: "p2" })

      const entries = listAdminAuditEntries({ target: "p2" })
      expect(entries).toHaveLength(1)
      expect(entries[0].action).toBe("revoke")
    })

    it("filters by since (ISO timestamp)", () => {
      const now = Date.now()
      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p1", timestamp: now - 60000 })
      appendAdminAuditEntry({ action: "revoke", actor: ADMIN, target: "p2", timestamp: now })
      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p3", timestamp: now + 1000 })

      const since = new Date(now - 1000).toISOString()
      const entries = listAdminAuditEntries({ since })
      expect(entries).toHaveLength(2)
      expect(entries[0].target).toBe("p3")
      expect(entries[1].target).toBe("p2")
    })

    it("applies combined filters", () => {
      const now = Date.now()
      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p1", timestamp: now - 60000 })
      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p2", timestamp: now })
      appendAdminAuditEntry({ action: "revoke", actor: ADMIN, target: "p3", timestamp: now })

      const entries = listAdminAuditEntries({
        action: "grant",
        actor: ADMIN,
        since: new Date(now - 1000).toISOString(),
      })
      expect(entries).toHaveLength(1)
      expect(entries[0].target).toBe("p2")
    })

    it("respects default limit of 100", () => {
      for (let i = 0; i < 150; i++) {
        appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: `p${i}` })
      }
      const entries = listAdminAuditEntries()
      expect(entries).toHaveLength(100)
    })

    it("caps limit at 1000", () => {
      for (let i = 0; i < 50; i++) {
        appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: `p${i}` })
      }
      const entries = listAdminAuditEntries({ limit: 5000 })
      expect(entries).toHaveLength(50) // only 50 exist, but limit capped at 1000
    })
  })

  // ─── Route Integration Tests ────────────────────────────────────
  describe("Route Integration: admin actions append audit entries", () => {
    it("POST /api/protocol/passport (grant) appends a grant audit entry", async () => {

      const req = new Request("http://localhost/api/protocol/passport", {
        method: "POST",
        headers: {
          "x-stellar-address": ADMIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: TARGET_PASSPORT,
          agentId: ADMIN,
        }),
      })

      const res = await grantPost(req)
      expect(res.status).toBe(201)

      const entries = listAdminAuditEntries({ action: "grant" })
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        action: "grant",
        actor: ADMIN,
        target: TARGET_PASSPORT,
      })
    })

    it("POST /api/passports/verify-batch (batch_verify) appends a batch_verify audit entry", async () => {

      issuePassport("p1", ADMIN, ADMIN)
      issuePassport("p2", ADMIN, ADMIN)

      const req = new Request("http://localhost/api/passports/verify-batch", {
        method: "POST",
        headers: {
          "x-stellar-address": ADMIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ passportIds: ["p1", "p2"] }),
      })

      const res = await verifyBatchPost(req)
      expect(res.status).toBe(200)

      const entries = listAdminAuditEntries({ action: "batch_verify" })
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        action: "batch_verify",
        actor: ADMIN,
        target: "p1,p2",
      })
      expect(entries[0].metadata).toEqual({ count: 2 })
    })

    it("GET /api/admin/audit returns 401 Unauthorized without x-admin-key header", async () => {
      const req = new Request("http://localhost/api/admin/audit")
      const res = await adminAuditGet(req)
      expect(res.status).toBe(401)
      const body = await res.json() as { ok: boolean; error: string }
      expect(body.ok).toBe(false)
      expect(body.error).toBe("Unauthorized")
    })

    it("GET /api/admin/audit returns 401 Unauthorized with incorrect x-admin-key header", async () => {
      const req = new Request("http://localhost/api/admin/audit", {
        headers: { "x-admin-key": "wrong-key" }
      })
      const res = await adminAuditGet(req)
      expect(res.status).toBe(401)
      const body = await res.json() as { ok: boolean; error: string }
      expect(body.ok).toBe(false)
      expect(body.error).toBe("Unauthorized")
    })

    it("GET /api/admin/audit returns entries newest first", async () => {

      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p1" })
      appendAdminAuditEntry({ action: "revoke", actor: ADMIN, target: "p2" })
      appendAdminAuditEntry({ action: "batch_verify", actor: ADMIN, target: "p3" })

      const req = new Request("http://localhost/api/admin/audit", {
        headers: { "x-admin-key": "test-admin-api-key" }
      })
      const res = await adminAuditGet(req)
      expect(res.status).toBe(200)

      const body = await res.json() as { entries: AdminAuditEntry[]; total: number }
      expect(body.total).toBe(3)
      expect(body.entries[0].action).toBe("batch_verify")
      expect(body.entries[1].action).toBe("revoke")
      expect(body.entries[2].action).toBe("grant")
    })

    it("GET /api/admin/audit supports filter query params", async () => {

      appendAdminAuditEntry({ action: "grant", actor: ADMIN, target: "p1" })
      appendAdminAuditEntry({ action: "revoke", actor: ADMIN, target: "p2" })
      appendAdminAuditEntry({ action: "grant", actor: TARGET_ADMIN, target: "p3" })

      const req = new Request("http://localhost/api/admin/audit?action=grant&actor=" + ADMIN, {
        headers: { "x-admin-key": "test-admin-api-key" }
      })
      const res = await adminAuditGet(req)
      expect(res.status).toBe(200)

      const body = await res.json() as { entries: AdminAuditEntry[]; total: number }
      expect(body.total).toBe(1)
      expect(body.entries[0].target).toBe("p1")
    })
  })
})
