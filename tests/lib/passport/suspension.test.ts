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
})
