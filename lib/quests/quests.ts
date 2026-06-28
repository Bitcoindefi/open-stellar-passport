export type QuestStatus = "active" | "expired" | "completed"

export interface QuestRecord {
  id: string
  title: string
  createdAt: string
  expiresAt: string | null
  status: QuestStatus
}

export type SubtaskStatus = "pending" | "in_progress" | "completed"

export interface AgentProgress {
  agentId: string
  questId: string
  subtaskStatuses: SubtaskStatus[]
  completedSubtasks: number
  totalSubtasks: number
}

type QuestDb = Map<string, QuestRecord>
type ProgressDb = Map<string, AgentProgress>

const globalState = globalThis as typeof globalThis & {
  __openStellarPassportQuestDb__?: QuestDb
  __openStellarPassportProgressDb__?: ProgressDb
}

function getQuestDb(): QuestDb {
  if (!globalState.__openStellarPassportQuestDb__) {
    globalState.__openStellarPassportQuestDb__ = new Map()
  }
  return globalState.__openStellarPassportQuestDb__
}

function getProgressDb(): ProgressDb {
  if (!globalState.__openStellarPassportProgressDb__) {
    globalState.__openStellarPassportProgressDb__ = new Map()
  }
  return globalState.__openStellarPassportProgressDb__
}

function normalizeId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) throw new Error("questId must not be empty")
  return trimmed.slice(0, 200)
}

function progressKey(questId: string, agentId: string): string {
  return `${normalizeId(questId)}:${agentId.trim().slice(0, 200)}`
}

export function createQuest(record: QuestRecord): void {
  getQuestDb().set(normalizeId(record.id), record)
}

export function getQuest(id: string): QuestRecord | null {
  return getQuestDb().get(normalizeId(id)) ?? null
}

export function setQuestStatus(id: string, status: QuestStatus): QuestRecord | null {
  const db = getQuestDb()
  const cleanId = normalizeId(id)
  const record = db.get(cleanId)
  if (!record) return null
  record.status = status
  return record
}

export function setAgentProgress(
  questId: string,
  agentId: string,
  statuses: SubtaskStatus[],
): AgentProgress {
  const key = progressKey(questId, agentId)
  const completed = statuses.filter((s) => s === "completed").length
  const progress: AgentProgress = {
    agentId,
    questId: normalizeId(questId),
    subtaskStatuses: statuses,
    completedSubtasks: completed,
    totalSubtasks: statuses.length,
  }
  getProgressDb().set(key, progress)
  return progress
}

export function getAgentProgress(questId: string, agentId: string): AgentProgress | null {
  return getProgressDb().get(progressKey(questId, agentId)) ?? null
}

export function getAgentsWithProgress(questId: string): AgentProgress[] {
  const prefix = `${normalizeId(questId)}:`
  const result: AgentProgress[] = []
  for (const [key, progress] of getProgressDb()) {
    if (key.startsWith(prefix) && progress.subtaskStatuses.some((s) => s === "in_progress" || s === "completed")) {
      result.push(progress)
    }
  }
  return result
}

export function getExpiredQuests(): QuestRecord[] {
  const now = Date.now()
  const result: QuestRecord[] = []
  for (const quest of getQuestDb().values()) {
    if (quest.status !== "active") continue
    if (quest.expiresAt !== null && new Date(quest.expiresAt).getTime() <= now) {
      result.push(quest)
    } else if (quest.expiresAt === null) {
      const createdAt = new Date(quest.createdAt).getTime()
      if (now - createdAt > 30 * 24 * 60 * 60 * 1000) {
        result.push(quest)
      }
    }
  }
  return result
}

export function resetQuestStore(): void {
  getQuestDb().clear()
  getProgressDb().clear()
}
