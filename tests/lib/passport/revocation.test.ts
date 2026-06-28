import { describe, it, expect, beforeEach } from "vitest"
import {
  revokePassport,
  getRevocation,
  isPassportRevoked,
  listRevocations,
  listRevocationAuditLog,
  validateRevocationInput,
  isValidRevocationReason,
  resetRevocationStore,
  buildRevocationWebhookPayload,
  VALID_REVOCATION_REASONS,
  type RevocationReason,
} from "@/lib/passport/revocation"

describe("passport revocation", () => {
  beforeEach(() => {
    resetRevocationStore()
  })

  // ─── reason code enum validation ─────────────────────────────────
  it("accepts all valid reason codes", () => {
    for (const reason of VALID_REVOCATION_REASONS) {
      expect(isValidRevocationReason(reason)).toBe(true)
    }
  })

  it("rejects invalid reason codes", () => {
    expect(isValidRevocationReason("invalid_reason")).toBe(false)
    expect(isValidRevocationReason("")).toBe(false)
    expect(isValidRevocationReason(123)).toBe(false)
    expect(isValidRevocationReason(null)).toBe(false)
  })

  // ─── validateRevocationInput ───────────────────────────────────────
  it("returns valid for correct input", () => {
    const result = validateRevocationInput({ reason: "policy_violation", notes: "Test note" })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.input.reason).toBe("policy_violation")
      expect(result.input.notes).toBe("Test note")
    }
  })

  it("returns error when reason is missing", () => {
    const result = validateRevocationInput({ notes: "Some notes" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain("Missing required field: 'reason'")
      expect(result.error).toContain("policy_violation")
    }
  })

  it("returns error when reason is invalid", () => {
    const result = validateRevocationInput({ reason: "not_a_reason" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain("Invalid reason")
      expect(result.error).toContain("policy_violation")
      expect(result.error).toContain("security_compromise")
    }
  })

  it("returns error for non-object body", () => {
    const result = validateRevocationInput("string")
    expect(result.valid).toBe(false)
  })

  it("allows notes to be optional", () => {
    const result = validateRevocationInput({ reason: "admin_override" })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.input.notes).toBeUndefined()
    }
  })

  it("truncates notes longer than 500 chars", () => {
    const longNotes = "a".repeat(600)
    const result = validateRevocationInput({ reason: "other", notes: longNotes })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.input.notes).toHaveLength(500)
    }
  })

  // ─── revokePassport ──────────────────────────────────────────────
  it("revokes a passport and stores the record", () => {
    const record = revokePassport("passport-123", { reason: "policy_violation", notes: "Violated terms" })

    expect(record.passportId).toBe("passport-123")
    expect(record.reason).toBe("policy_violation")
    expect(record.notes).toBe("Violated terms")
    expect(record.revokedAt).toBeDefined()
  })

  it("marks passport as revoked", () => {
    revokePassport("passport-123", { reason: "security_compromise" })
    expect(isPassportRevoked("passport-123")).toBe(true)
  })

  it("returns null for non-revoked passport", () => {
    expect(getRevocation("passport-999")).toBeNull()
    expect(isPassportRevoked("passport-999")).toBe(false)
  })

  it("overwrites previous revocation on same passport", () => {
    revokePassport("passport-123", { reason: "duplicate_passport" })
    const updated = revokePassport("passport-123", { reason: "admin_override", notes: "Updated" })

    expect(updated.reason).toBe("admin_override")
    expect(getRevocation("passport-123")?.reason).toBe("admin_override")
  })

  // ─── revoke with each valid reason code → no error ───────────────
  it("revoke with each valid reason code → no error", () => {
    const reasons: RevocationReason[] = [
      "policy_violation",
      "security_compromise",
      "duplicate_passport",
      "agent_offboarded",
      "admin_override",
      "other",
    ]

    for (let i = 0; i < reasons.length; i++) {
      const reason = reasons[i]
      expect(() =>
        revokePassport(`passport-${i}`, { reason, notes: `Revoked for ${reason}` }),
      ).not.toThrow()
    }

    expect(listRevocations()).toHaveLength(6)
  })

  // ─── audit log ───────────────────────────────────────────────────
  it("creates an audit entry on revocation", () => {
    revokePassport("passport-123", { reason: "agent_offboarded", notes: "Agent left" })

    const auditLog = listRevocationAuditLog()
    expect(auditLog).toHaveLength(1)
    expect(auditLog[0]).toMatchObject({
      action: "revoke",
      passportId: "passport-123",
      reason: "agent_offboarded",
      notes: "Agent left",
    })
    expect(auditLog[0].revokedAt).toBeDefined()
  })

  it("stores null notes when not provided", () => {
    revokePassport("passport-123", { reason: "other" })

    const auditLog = listRevocationAuditLog()
    expect(auditLog[0].notes).toBeNull()
  })

  // ─── webhook payload ──────────────────────────────────────────────
  it("builds correct webhook payload", () => {
    const record = revokePassport("passport-123", { reason: "security_compromise", notes: "Key leaked" })
    const payload = buildRevocationWebhookPayload(record)

    expect(payload).toEqual({
      type: "passport.revoked",
      passportId: "passport-123",
      reason: "security_compromise",
      notes: "Key leaked",
      revokedAt: record.revokedAt,
    })
  })

  // ─── listRevocations ─────────────────────────────────────────────
  it("lists all revocations sorted by revokedAt desc", async () => {
    revokePassport("passport-a", { reason: "policy_violation" })
    await new Promise((r) => setTimeout(r, 5))
    revokePassport("passport-b", { reason: "other" })

    const revocations = listRevocations()
    expect(revocations).toHaveLength(2)
    expect(revocations[0].passportId).toBe("passport-b")
    expect(revocations[1].passportId).toBe("passport-a")
  })

  // ─── edge cases ───────────────────────────────────────────────────
  it("throws on empty passportId", () => {
    expect(() => revokePassport("", { reason: "other" })).toThrow("passportId must not be empty")
  })

  it("trims passportId", () => {
    const record = revokePassport("  passport-123  ", { reason: "other" })
    expect(record.passportId).toBe("passport-123")
  })
})