// lib/passport/audit-log.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  appendAuditEvent,
  listAuditEvents,
  resetAuditFile,
  type PassportAuditEvent,
} from "./audit-log"
import {
  issuePassport,
  authorizePassportSpend,
  revokePassport,
  verifyPassportBatch,
  resetPassportStore,
} from "./passport"

describe("PassportAuditLog", () => {
  beforeEach(() => {
    resetAuditFile()
    resetPassportStore()
  })

  afterEach(() => {
    resetAuditFile()
    resetPassportStore()
  })

  it("appends and reads issued event", () => {
    const ev = appendAuditEvent({ agentId: "agent-1", type: "issued" })
    expect(ev.agentId).toBe("agent-1")
    expect(ev.type).toBe("issued")
    expect(ev.id).toBeDefined()
    expect(ev.at).toBeDefined()
  })

  it("appends authorized event with amount, quoteId, ok", () => {
    const ev = appendAuditEvent({
      agentId: "agent-2",
      type: "authorized",
      amount: 100,
      quoteId: "quote-42",
      ok: true,
    })
    expect(ev.amount).toBe(100)
    expect(ev.quoteId).toBe("quote-42")
    expect(ev.ok).toBe(true)
  })

  it("appends revoked event with reason", () => {
    const ev = appendAuditEvent({
      agentId: "agent-3",
      type: "revoked",
      reason: "compromised",
    })
    expect(ev.reason).toBe("compromised")
  })

  it("caps log at 1000 events", () => {
    for (let i = 0; i < 1005; i++) {
      appendAuditEvent({ agentId: `agent-${i}`, type: "issued" })
    }
    const all = listAuditEvents({ agentId: "agent-1004", limit: 1000 })
    // agent-1004 should exist (it was the 1005th, so kept)
    expect(all.length).toBe(1)
    // Check total file size is capped
    const every = listAuditEvents({ agentId: "agent-0", limit: 1000 })
    expect(every.length).toBe(0) // agent-0 was trimmed
  })

  it("lists events newest-first for an agent", () => {
    appendAuditEvent({ agentId: "agent-x", type: "issued" })
    appendAuditEvent({ agentId: "agent-x", type: "authorized", amount: 10, quoteId: "q1", ok: true })
    appendAuditEvent({ agentId: "agent-x", type: "revoked", reason: "test" })

    const events = listAuditEvents({ agentId: "agent-x", limit: 50 })
    expect(events).toHaveLength(3)
    expect(events[0].type).toBe("revoked")
    expect(events[1].type).toBe("authorized")
    expect(events[2].type).toBe("issued")
  })

  it("filters by agentId only", () => {
    appendAuditEvent({ agentId: "agent-a", type: "issued" })
    appendAuditEvent({ agentId: "agent-b", type: "issued" })
    const events = listAuditEvents({ agentId: "agent-a", limit: 50 })
    expect(events).toHaveLength(1)
    expect(events[0].agentId).toBe("agent-a")
  })

  it("end-to-end: issue -> authorize -> revoke -> audit list shows 3 events in order", () => {
    // Issue
    issuePassport("pp-1", "agent-007", "admin", { allowTransfer: true })

    // Authorize
    authorizePassportSpend("agent-007", 50, "quote-123", "admin")

    // Revoke
    revokePassport("pp-1", "admin", "security_breach")

    // Query audit
    const events = listAuditEvents({ agentId: "agent-007", limit: 50 })
    expect(events).toHaveLength(3)

    // Newest-first order
    expect(events[0].type).toBe("revoked")
    expect(events[0].reason).toBe("security_breach")

    expect(events[1].type).toBe("authorized")
    expect(events[1].amount).toBe(50)
    expect(events[1].quoteId).toBe("quote-123")
    expect(events[1].ok).toBe(true)

    expect(events[2].type).toBe("issued")
  })

  it("batch_verify appends audit events per agent", () => {
    issuePassport("pp-a", "agent-101", "admin")
    issuePassport("pp-b", "agent-102", "admin")

    verifyPassportBatch(["pp-a", "pp-b", "missing"])

    const e101 = listAuditEvents({ agentId: "agent-101", limit: 10 })
    const e102 = listAuditEvents({ agentId: "agent-102", limit: 10 })

    expect(e101).toHaveLength(2) // issued + batch_verified
    expect(e101[0].type).toBe("batch_verified")
    expect(e101[0].ok).toBe(true)

    expect(e102).toHaveLength(2)
    expect(e102[0].type).toBe("batch_verified")
    expect(e102[0].ok).toBe(true)
  })

  it("authorize failure still appends audit with ok:false", () => {
    const result = authorizePassportSpend("unknown-agent", 10, "q-1", "admin")
    expect(result.ok).toBe(false)

    const events = listAuditEvents({ agentId: "unknown-agent", limit: 10 })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("authorized")
    expect(events[0].ok).toBe(false)
    expect(events[0].amount).toBe(10)
    expect(events[0].quoteId).toBe("q-1")
  })
})