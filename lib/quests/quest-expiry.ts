import {
  setQuestStatus,
  getAgentsWithProgress,
  getExpiredQuests,
} from "./quests"

export interface QuestExpiredEvent {
  type: "quest.expired"
  questId: string
  agentId: string
  completedSubtasks: number
  totalSubtasks: number
  timestamp: string
}

type EventHandler = (event: QuestExpiredEvent) => void

const handlers: EventHandler[] = []

export function onQuestExpired(handler: EventHandler): void {
  handlers.push(handler)
}

export function removeQuestExpiredHandler(handler: EventHandler): void {
  const idx = handlers.indexOf(handler)
  if (idx !== -1) handlers.splice(idx, 1)
}

function emit(event: QuestExpiredEvent): void {
  for (const handler of handlers) {
    try {
      handler(event)
    } catch {
      // swallow per-handler errors so one bad handler doesn't break others
    }
  }
}

export interface ExpiryResult {
  expired: number
  notified: number
}

export function expireQuests(): ExpiryResult {
  const quests = getExpiredQuests()
  let notified = 0

  for (const quest of quests) {
    setQuestStatus(quest.id, "expired")

    const agents = getAgentsWithProgress(quest.id)

    if (agents.length === 0) continue

    for (const agent of agents) {
      const event: QuestExpiredEvent = {
        type: "quest.expired",
        questId: quest.id,
        agentId: agent.agentId,
        completedSubtasks: agent.completedSubtasks,
        totalSubtasks: agent.totalSubtasks,
        timestamp: new Date().toISOString(),
      }
      emit(event)
      notified++
    }
  }

  return { expired: quests.length, notified }
}

export function resetEventHandlers(): void {
  handlers.length = 0
}
