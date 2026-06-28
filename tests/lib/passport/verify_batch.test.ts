import { describe, it, expect, beforeEach } from "vitest"
import {
  issuePassport,
  suspendPassport,
  expirePassport,
  verifyPassportBatch,
  resetPassportStore,
} from "@/lib/passport/passport"
import { revokePassport, resetRevocationStore } from "@/lib/passport/revocation"
import { resetAuditStore } from "@/lib/passport/audit"

const AGENT_A = "GA111111111111111111111111111111111111111111111111111111"
const AGENT_B = "GB222222222222222222222222222222222222222222222222222222"
const AGENT_C = "GC333333333333333333333333333333333333333333333333333333"

describe("verifyPassportBatch logic", () => {
  beforeEach(() => {
    resetPassportStore()
    resetRevocationStore()
    resetAuditStore()
  })

  it("handles an all-valid batch of passports", () => {
    issuePassport("id-1", AGENT_A, "issuer-1")
    issuePassport("id-2", AGENT_B, "issuer-1")

    const res = verifyPassportBatch(["id-1", "id-2"])
    expect(res).toEqual({
      results: [
        { passportId: "id-1", status: "active", agentId: AGENT_A, valid: true },
        { passportId: "id-2", status: "active", agentId: AGENT_B, valid: true },
      ],
      total: 2,
      validCount: 2,
      invalidCount: 0,
    })
  })

  it("handles a mix of active, revoked, suspended, expired, and unknown passports", () => {
    issuePassport("active-id", AGENT_A, "issuer-1")

    issuePassport("revoked-id", AGENT_B, "issuer-1")
    revokePassport("revoked-id", { reason: "security_compromise" }, "admin")

    issuePassport("suspended-id", AGENT_C, "issuer-1")
    suspendPassport("suspended-id", "admin")

    issuePassport("expired-id", AGENT_C, "issuer-1")
    expirePassport("expired-id", "admin")

    const res = verifyPassportBatch(["active-id", "revoked-id", "suspended-id", "expired-id", "unknown-id"])
    expect(res.total).toBe(5)
    expect(res.validCount).toBe(1)
    expect(res.invalidCount).toBe(4)

    expect(res.results).toEqual([
      { passportId: "active-id", status: "active", agentId: AGENT_A, valid: true },
      { passportId: "revoked-id", status: "revoked", agentId: AGENT_B, valid: false },
      { passportId: "suspended-id", status: "suspended", agentId: AGENT_C, valid: false },
      { passportId: "expired-id", status: "expired", agentId: AGENT_C, valid: false },
      { passportId: "unknown-id", status: null, agentId: null, valid: false, error: "not_found" },
    ])
  })

  it("handles empty arrays", () => {
    const res = verifyPassportBatch([])
    expect(res).toEqual({
      results: [],
      total: 0,
      validCount: 0,
      invalidCount: 0,
    })
  })
})
