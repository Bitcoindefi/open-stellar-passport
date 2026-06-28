import { describe, it, expect, beforeEach } from "vitest"
import {
  appendAuditEntry,
  listAuditEntries,
  listAuditEntriesByActor,
  resetAuditStore,
} from "@/lib/passport/audit"

const PASSPORT_1 = "passport-abc-123"
const PASSPORT_2 = "passport-xyz-789"
const ACTOR_1 = "GA111111111111111111111111111111111111111111111111111111"
const ACTOR_2 = "GB222222222222222222222222222222222222222222222222222222"

describe("Audit Store", () => {
  beforeEach(() => {
    resetAuditStore()
  })

  it("successfully appends and lists audit entries newest-first", () => {
    const entry1 = appendAuditEntry({
      passportId: PASSPORT_1,
      action: "issued",
      actor: ACTOR_1,
      reason: "Initial issuance",
    })

    const entry2 = appendAuditEntry({
      passportId: PASSPORT_1,
      action: "suspended",
      actor: ACTOR_2,
      reason: "Suspicious activity",
    })

    expect(entry1.id).toBeDefined()
    expect(entry1.timestamp).toBeDefined()
    expect(entry1.action).toBe("issued")

    const logs = listAuditEntries()
    expect(logs).toHaveLength(2)
    expect(logs[0].id).toBe(entry2.id) // Newest first
    expect(logs[1].id).toBe(entry1.id)
  })

  it("correctly filters audit logs by passport ID", () => {
    appendAuditEntry({
      passportId: PASSPORT_1,
      action: "issued",
      actor: ACTOR_1,
    })

    appendAuditEntry({
      passportId: PASSPORT_2,
      action: "issued",
      actor: ACTOR_2,
    })

    const logs1 = listAuditEntries(PASSPORT_1)
    expect(logs1).toHaveLength(1)
    expect(logs1[0].passportId).toBe(PASSPORT_1)

    const logs2 = listAuditEntries(PASSPORT_2)
    expect(logs2).toHaveLength(1)
    expect(logs2[0].passportId).toBe(PASSPORT_2)
  })

  it("correctly filters audit logs by actor (case-insensitive and trimmed)", () => {
    appendAuditEntry({
      passportId: PASSPORT_1,
      action: "issued",
      actor: ACTOR_1,
    })

    appendAuditEntry({
      passportId: PASSPORT_2,
      action: "suspended",
      actor: ACTOR_2,
    })

    appendAuditEntry({
      passportId: PASSPORT_1,
      action: "reactivated",
      actor: `  ${ACTOR_1.toLowerCase()}  `,
    })

    const logsActor1 = listAuditEntriesByActor(ACTOR_1)
    expect(logsActor1).toHaveLength(2)
    expect(logsActor1[0].action).toBe("reactivated")
    expect(logsActor1[1].action).toBe("issued")

    const logsActor2 = listAuditEntriesByActor(ACTOR_2)
    expect(logsActor2).toHaveLength(1)
    expect(logsActor2[0].action).toBe("suspended")
  })

  it("limits audit log storage to 10,000 entries", () => {
    for (let i = 0; i < 10005; i++) {
      appendAuditEntry({
        passportId: `passport-${i}`,
        action: "issued",
        actor: ACTOR_1,
      })
    }

    const logs = listAuditEntries()
    expect(logs).toHaveLength(10000)
    // The oldest 5 should be pruned, so the last element should be index 5
    expect(logs[9999].passportId).toBe("passport-5")
  })
})
