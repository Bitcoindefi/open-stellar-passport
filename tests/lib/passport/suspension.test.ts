import { describe, it, expect, beforeEach } from "vitest"
import {
  issuePassport,
  resetPassportStore,
  getPassport,
} from "@/lib/passport/passport"
import {
  suspendPassport,
  unsuspendPassport,
  validatePassportForAction,
  resetSuspensionStore,
  buildSuspensionWebhookPayload,
  buildUnsuspensionWebhookPayload,
  executeSuspensionRoute,
} from "@/lib/passport/suspension"
import { listAuditEntries, resetAuditStore } from "@/lib/passport/audit"
import { listAdminAuditEntries, resetAdminAuditStore } from "@/lib/passport/audit-log"
import { revokePassport, resetRevocationStore } from "@/lib/passport/revocation"

describe("passport suspension (temp hold)", () => {
  beforeEach(() => {
    resetPassportStore()
    resetSuspensionStore()
    resetRevocationStore()
    resetAuditStore()
    resetAdminAuditStore()
  })

  it("suspends an active passport successfully and records audit logs", () => {
    issuePassport("passport-1", "agent-alpha", "admin")

    const suspension = suspendPassport("passport-1", "Payment dispute under review", "admin-wallet")
    expect(suspension.passportId).toBe("passport-1")
    expect(suspension.reason).toBe("Payment dispute under review")
    expect(suspension.suspendedBy).toBe("admin-wallet")

    const updated = getPassport("passport-1")
    expect(updated?.status).toBe("suspended")

    // Audit entry in passport audit log
    const auditEntries = listAuditEntries("passport-1")
    expect(auditEntries.some((e) => e.action === "suspended")).toBe(true)

    // Admin audit log
    const adminLog = listAdminAuditEntries({ action: "suspend" })
    expect(adminLog.some((e) => e.target === "passport-1")).toBe(true)
  })

  it("denies access/spend when passport is suspended with error 'passport_suspended'", () => {
    issuePassport("passport-2", "agent-beta", "admin")
    suspendPassport("passport-2", "Investigation pending")

    const validation = validatePassportForAction("passport-2")
    expect(validation.ok).toBe(false)
    if (!validation.ok) {
      expect(validation.error).toBe("passport_suspended")
      expect(validation.status).toBe(403)
    }
  })

  it("unsuspends a suspended passport back to active and allows access", () => {
    issuePassport("passport-3", "agent-gamma", "admin")
    suspendPassport("passport-3", "Temporary check")

    const unsuspension = unsuspendPassport("passport-3", "Dispute resolved", "admin-wallet")
    expect(unsuspension.passportId).toBe("passport-3")
    expect(unsuspension.reason).toBe("Dispute resolved")

    const updated = getPassport("passport-3")
    expect(updated?.status).toBe("active")

    const validation = validatePassportForAction("passport-3")
    expect(validation.ok).toBe(true)
  })

  it("refuses to unsuspend a revoked passport", () => {
    issuePassport("passport-4", "agent-delta", "admin")
    revokePassport("passport-4", { reason: "policy_violation" }, "admin")

    expect(() => {
      unsuspendPassport("passport-4", "Attempted reactivation")
    }).toThrow("cannot_unsuspend_revoked")
  })

  it("refuses to unsuspend an expired passport", () => {
    const pastDate = new Date(Date.now() - 100_000).toISOString()
    const passport = issuePassport("passport-5", "agent-epsilon", "admin", { allowTransfer: true }, pastDate)
    passport.status = "expired"

    expect(() => {
      unsuspendPassport("passport-5", "Attempted reactivation")
    }).toThrow("cannot_unsuspend_expired")
  })

  it("generates correct webhook event payloads", () => {
    const suspension = {
      passportId: "pass-wh",
      reason: "Suspicious activity",
      suspendedAt: new Date().toISOString(),
    }
    const whSuspension = buildSuspensionWebhookPayload(suspension)
    expect(whSuspension.type).toBe("passport.suspended")
    expect(whSuspension.passportId).toBe("pass-wh")

    const unsuspension = {
      passportId: "pass-wh",
      reason: "Cleared",
      unsuspendedAt: new Date().toISOString(),
    }
    const whUnsuspension = buildUnsuspensionWebhookPayload(unsuspension)
    expect(whUnsuspension.type).toBe("passport.unsuspended")
    expect(whUnsuspension.passportId).toBe("pass-wh")
  })

  describe("executeSuspensionRoute route handler helper", () => {
    it("returns 400 when reason is missing", async () => {
      const req = new Request("http://localhost/api/protocol/passport/pass-route-1/suspend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const res = await executeSuspensionRoute(
        req,
        { params: Promise.resolve({ id: "pass-route-1" }) },
        "suspend"
      )
      expect(res.status).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe("Missing required field: 'reason'")
    })

    it("returns 404 when passport is not found", async () => {
      const req = new Request("http://localhost/api/protocol/passport/nonexistent/suspend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Testing 404" }),
      })
      const res = await executeSuspensionRoute(
        req,
        { params: Promise.resolve({ id: "nonexistent" }) },
        "suspend"
      )
      expect(res.status).toBe(404)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe("passport_not_found")
    })

    it("executes suspend and unsuspend route lifecycle successfully", async () => {
      issuePassport("pass-route-2", "agent-route-2", "admin")

      const suspendReq = new Request("http://localhost/api/protocol/passport/pass-route-2/suspend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stellar-address": "admin-stellar",
        },
        body: JSON.stringify({ reason: "Under investigation" }),
      })
      const suspendRes = await executeSuspensionRoute(
        suspendReq,
        { params: Promise.resolve({ id: "pass-route-2" }) },
        "suspend"
      )
      expect(suspendRes.status).toBe(200)
      expect(suspendRes.body.ok).toBe(true)
      const suspendedData = suspendRes.body.suspended as Record<string, unknown>
      expect(suspendedData.status).toBe("suspended")
      expect(suspendedData.reason).toBe("Under investigation")

      const unsuspendReq = new Request("http://localhost/api/protocol/passport/pass-route-2/unsuspend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stellar-address": "admin-stellar",
        },
        body: JSON.stringify({ reason: "Cleared of allegations" }),
      })
      const unsuspendRes = await executeSuspensionRoute(
        unsuspendReq,
        { params: Promise.resolve({ id: "pass-route-2" }) },
        "unsuspend"
      )
      expect(unsuspendRes.status).toBe(200)
      expect(unsuspendRes.body.ok).toBe(true)
      const unsuspendedData = unsuspendRes.body.unsuspended as Record<string, unknown>
      expect(unsuspendedData.status).toBe("active")
      expect(unsuspendedData.reason).toBe("Cleared of allegations")
    })

    it("returns 400 when attempting to unsuspend a revoked passport via route", async () => {
      issuePassport("pass-route-3", "agent-route-3", "admin")
      revokePassport("pass-route-3", { reason: "policy_violation" }, "admin")

      const req = new Request("http://localhost/api/protocol/passport/pass-route-3/unsuspend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Should fail" }),
      })
      const res = await executeSuspensionRoute(
        req,
        { params: Promise.resolve({ id: "pass-route-3" }) },
        "unsuspend"
      )
      expect(res.status).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe("cannot_unsuspend_revoked")
    })
  })
})
