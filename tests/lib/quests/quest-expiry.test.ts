import { describe, it, expect, beforeEach } from "vitest"
import {
  createQuest,
  getQuest,
  setAgentProgress,
  getAgentProgress,
  getAgentsWithProgress,
  getExpiredQuests,
  resetQuestStore,
  type QuestRecord,
  type SubtaskStatus,
} from "@/lib/quests/quests"
import {
  expireQuests,
  onQuestExpired,
  resetEventHandlers,
  type QuestExpiredEvent,
} from "@/lib/quests/quest-expiry"

function pastDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
}

function futureDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString()
}

function activeQuest(id: string, opts?: { expiresAt?: string | null; createdAt?: string }): QuestRecord {
  const hasOpts = opts !== undefined
  return {
    id,
    title: `Quest ${id}`,
    createdAt: hasOpts && opts.createdAt !== undefined ? opts.createdAt : new Date().toISOString(),
    expiresAt: hasOpts && opts.expiresAt !== undefined ? opts.expiresAt : futureDate(7),
    status: "active",
  }
}

const AGENT_A = "agent-alice"
const AGENT_B = "agent-bob"
const AGENT_C = "agent-charlie"

describe("quest expiry", () => {
  beforeEach(() => {
    resetQuestStore()
    resetEventHandlers()
  })

  // ─── quest store ──────────────────────────────────────────────
  describe("quest store", () => {
    it("creates and retrieves a quest", () => {
      const q = activeQuest("quest-1")
      createQuest(q)
      expect(getQuest("quest-1")).toEqual(q)
    })

    it("returns null for non-existent quest", () => {
      expect(getQuest("nonexistent")).toBeNull()
    })
  })

  // ─── agent progress ───────────────────────────────────────────
  describe("agent progress", () => {
    it("sets and gets progress for an agent on a quest", () => {
      createQuest(activeQuest("quest-1"))
      const progress = setAgentProgress("quest-1", AGENT_A, ["completed", "in_progress", "pending"])

      expect(progress.agentId).toBe(AGENT_A)
      expect(progress.questId).toBe("quest-1")
      expect(progress.completedSubtasks).toBe(1)
      expect(progress.totalSubtasks).toBe(3)

      const stored = getAgentProgress("quest-1", AGENT_A)
      expect(stored).toEqual(progress)
    })

    it("returns null when no progress exists", () => {
      expect(getAgentProgress("quest-1", AGENT_A)).toBeNull()
    })

    it("getAgentsWithProgress returns only agents with activity", () => {
      createQuest(activeQuest("quest-1"))
      setAgentProgress("quest-1", AGENT_A, ["completed", "in_progress", "pending"])
      setAgentProgress("quest-1", AGENT_B, ["in_progress", "pending"])
      setAgentProgress("quest-1", AGENT_C, ["pending", "pending"])

      const agents = getAgentsWithProgress("quest-1")
      expect(agents).toHaveLength(2)
      expect(agents.map((a) => a.agentId).sort()).toEqual([AGENT_A, AGENT_B])
    })
  })

  // ─── getExpiredQuests ─────────────────────────────────────────
  describe("getExpiredQuests", () => {
    it("finds quests with past expiresAt", () => {
      createQuest(activeQuest("quest-1", { expiresAt: pastDate(1) }))
      createQuest(activeQuest("quest-2", { expiresAt: futureDate(1) }))

      const expired = getExpiredQuests()
      expect(expired).toHaveLength(1)
      expect(expired[0].id).toBe("quest-1")
    })

    it("finds quests with null expiresAt older than 30 days", () => {
      createQuest(activeQuest("quest-1", { expiresAt: null, createdAt: pastDate(31) }))
      createQuest(activeQuest("quest-2", { expiresAt: null, createdAt: pastDate(29) }))

      const expired = getExpiredQuests()
      expect(expired).toHaveLength(1)
      expect(expired[0].id).toBe("quest-1")
    })

    it("ignores non-active quests", () => {
      createQuest({ ...activeQuest("quest-1", { expiresAt: pastDate(1) }), status: "completed" })
      createQuest({ ...activeQuest("quest-2", { expiresAt: pastDate(1) }), status: "expired" })

      expect(getExpiredQuests()).toHaveLength(0)
    })
  })

  // ─── expireQuests ─────────────────────────────────────────────
  describe("expireQuests", () => {
    it("marks expired quest status as expired", () => {
      createQuest(activeQuest("quest-1", { expiresAt: pastDate(1) }))

      expireQuests()

      const quest = getQuest("quest-1")
      expect(quest?.status).toBe("expired")
    })

    it("fires quest.expired event for each agent with progress", () => {
      createQuest(activeQuest("quest-1", { expiresAt: pastDate(1) }))
      setAgentProgress("quest-1", AGENT_A, ["completed", "in_progress", "pending"])
      setAgentProgress("quest-1", AGENT_B, ["in_progress", "pending"])

      const events: QuestExpiredEvent[] = []
      onQuestExpired((e) => events.push(e))

      const result = expireQuests()

      expect(result).toEqual({ expired: 1, notified: 2 })
      expect(events).toHaveLength(2)

      const eventA = events.find((e) => e.agentId === AGENT_A)
      expect(eventA).toBeDefined()
      expect(eventA!.questId).toBe("quest-1")
      expect(eventA!.completedSubtasks).toBe(1)
      expect(eventA!.totalSubtasks).toBe(3)

      const eventB = events.find((e) => e.agentId === AGENT_B)
      expect(eventB).toBeDefined()
      expect(eventB!.completedSubtasks).toBe(0)
      expect(eventB!.totalSubtasks).toBe(2)
    })

    it("does not fire events for quests with zero participant activity", () => {
      createQuest(activeQuest("quest-1", { expiresAt: pastDate(1) }))

      const events: QuestExpiredEvent[] = []
      onQuestExpired((e) => events.push(e))

      const result = expireQuests()

      expect(result).toEqual({ expired: 1, notified: 0 })
      expect(events).toHaveLength(0)
    })

    it("handles multiple expired quests", () => {
      createQuest(activeQuest("quest-1", { expiresAt: pastDate(1) }))
      createQuest(activeQuest("quest-2", { expiresAt: pastDate(1) }))
      setAgentProgress("quest-1", AGENT_A, ["completed"])
      setAgentProgress("quest-2", AGENT_B, ["in_progress"])

      const events: QuestExpiredEvent[] = []
      onQuestExpired((e) => events.push(e))

      const result = expireQuests()

      expect(result).toEqual({ expired: 2, notified: 2 })
      expect(events).toHaveLength(2)
    })

    it("event payload includes snapshot of completed/total subtasks", () => {
      createQuest(activeQuest("quest-1", { expiresAt: pastDate(1) }))
      setAgentProgress("quest-1", AGENT_A, ["completed", "completed", "in_progress", "pending"])

      const events: QuestExpiredEvent[] = []
      onQuestExpired((e) => events.push(e))

      expireQuests()

      expect(events[0].completedSubtasks).toBe(2)
      expect(events[0].totalSubtasks).toBe(4)
    })

    it("skips quests that are not yet expired", () => {
      createQuest(activeQuest("quest-1", { expiresAt: futureDate(7) }))
      setAgentProgress("quest-1", AGENT_A, ["in_progress"])

      const result = expireQuests()

      expect(result).toEqual({ expired: 0, notified: 0 })
    })
  })
})
