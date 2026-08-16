// lib/passport/passport.ts
import { appendAuditEntry } from "./audit"
import { appendAuditEvent } from "./audit-log"

export type PassportStatus = "active" | "revoked" | "expired" | "suspended"

export interface PassportConfig {
  allowTransfer: boolean
}

export interface PassportRecord {
  id: string
  agentId: string
  status: PassportStatus
  config: PassportConfig
  createdAt: string
  expiresAt?: string | null
}

type PassportDb = Map<string, PassportRecord>
type AgentIndex = Map<string, string>

const globalState = globalThis as typeof globalThis & {
  __openStellarPassportDb__?: PassportDb
  __openStellarPassportAgentIndex__?: AgentIndex
}

function getDb(): PassportDb {
  if (!globalState.__openStellarPassportDb__) {
    globalState.__openStellarPassportDb__ = new Map()
  }
  return globalState.__openStellarPassportDb__
}

function getAgentIndex(): AgentIndex {
  if (!globalState.__openStellarPassportAgentIndex__) {
    globalState.__openStellarPassportAgentIndex__ = new Map()
  }
  return globalState.__openStellarPassportAgentIndex__
}

function normalizeId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) throw new Error("passportId must not be empty")
  return trimmed.slice(0, 200)
}

export function getPassport(id: string): PassportRecord | null {
  const cleanId = normalizeId(id)
  return getDb().get(cleanId) ?? null
}

export function getPassportByAgentId(agentId: string): PassportRecord | null {
  const passportId = getAgentIndex().get(agentId)
  if (!passportId) return null
  return getDb().get(passportId) ?? null
}

export function setPassport(record: PassportRecord): void {
  const db = getDb()
  const index = getAgentIndex()
  const cleanId = normalizeId(record.id)
  db.set(cleanId, record)
  index.set(record.agentId, cleanId)
}

export function updatePassportAgentId(id: string, newAgentId: string): PassportRecord | null {
  const db = getDb()
  const index = getAgentIndex()
  const cleanId = normalizeId(id)
  const record = db.get(cleanId)
  if (!record) return null

  index.delete(record.agentId)
  record.agentId = newAgentId
  index.set(newAgentId, cleanId)

  return record
}

export function isPassportTransferable(id: string): { ok: true } | { ok: false; error: string } {
  const cleanId = normalizeId(id)
  const record = getDb().get(cleanId)
  if (!record) return { ok: false, error: "passport_not_found" }
  if (record.status !== "active") return { ok: false, error: `passport_${record.status}` }
  if (!record.config.allowTransfer) return { ok: false, error: "transfer_not_allowed" }
  return { ok: true }
}

export function resetPassportStore(): void {
  getDb().clear()
  getAgentIndex().clear()
}

export function getAllPassports(): PassportRecord[] {
  return Array.from(getDb().values())
}

export function issuePassport(
  id: string,
  agentId: string,
  actor: string,
  config: PassportConfig = { allowTransfer: true },
  expiresAt?: string | null,
): PassportRecord {
  const record: PassportRecord = {
    id: normalizeId(id),
    agentId,
    status: "active",
    config,
    createdAt: new Date().toISOString(),
    expiresAt,
  }
  setPassport(record)

  // Legacy passport-level audit
  appendAuditEntry({
    passportId: record.id,
    action: "issued",
    actor,
  })

  // NEW: Per-agent audit
  appendAuditEvent({
    agentId: record.agentId,
    type: "issued",
  })

  return record
}

export function authorizePassportSpend(
  agentId: string,
  amount: number,
  quoteId: string,
  actor: string,
): { ok: true; record: PassportRecord } | { ok: false; error: string } {
  const record = getPassportByAgentId(agentId)
  if (!record) {
    appendAuditEvent({ agentId, type: "authorized", amount, quoteId, ok: false })
    return { ok: false, error: "passport_not_found" }
  }
  if (record.status !== "active") {
    appendAuditEvent({ agentId, type: "authorized", amount, quoteId, ok: false })
    return { ok: false, error: `passport_${record.status}` }
  }

  appendAuditEvent({ agentId, type: "authorized", amount, quoteId, ok: true })
  return { ok: true, record }
}

export function revokePassport(
  id: string,
  actor: string,
  reason?: string,
): PassportRecord {
  const record = getPassport(id)
  if (!record) throw new Error("passport_not_found")

  record.status = "revoked"
  setPassport(record)

  // Legacy passport-level audit
  appendAuditEntry({
    passportId: record.id,
    action: "revoked",
    actor,
    reason,
  })

  // NEW: Per-agent audit
  appendAuditEvent({
    agentId: record.agentId,
    type: "revoked",
    reason,
  })

  return record
}

export function suspendPassport(id: string, actor: string, reason?: string): PassportRecord {
  const record = getPassport(id)
  if (!record) throw new Error("passport_not_found")
  record.status = "suspended"
  setPassport(record)
  appendAuditEntry({
    passportId: record.id,
    action: "suspended",
    actor,
    reason,
  })
  return record
}

export function reactivatePassport(id: string, actor: string, reason?: string): PassportRecord {
  const record = getPassport(id)
  if (!record) throw new Error("passport_not_found")
  record.status = "active"
  setPassport(record)
  appendAuditEntry({
    passportId: record.id,
    action: "reactivated",
    actor,
    reason,
  })
  return record
}

export function expirePassport(id: string, actor: string, reason?: string): PassportRecord {
  const record = getPassport(id)
  if (!record) throw new Error("passport_not_found")
  record.status = "expired"
  setPassport(record)

  appendAuditEntry({
    passportId: record.id,
    action: "expired",
    actor,
    reason,
  })

  // NEW: Per-agent audit
  appendAuditEvent({
    agentId: record.agentId,
    type: "expired",
    reason,
  })

  return record
}

export function extendPassport(agentId: string, additionalDays: number, actor: string): PassportRecord {
  const record = getPassportByAgentId(agentId)
  if (!record) throw new Error("passport_not_found")
  if (record.status === "revoked") throw new Error("passport_revoked")

  const oldExpiresAt = record.expiresAt
  const oldExpiresAtMs = typeof oldExpiresAt === "string" ? Date.parse(oldExpiresAt) : Number.NaN
  if (!Number.isFinite(oldExpiresAtMs)) throw new Error("passport_expiry_invalid")

  const newExpiresAt = new Date(oldExpiresAtMs + additionalDays * 24 * 60 * 60 * 1000).toISOString()
  record.expiresAt = newExpiresAt
  setPassport(record)
  appendAuditEntry({
    passportId: record.id,
    action: "extended",
    actor,
    metadata: {
      oldExpiresAt,
      newExpiresAt,
    },
  })
  return record
}

export function clonePassport(id: string, newAgentId: string, actor: string, reason?: string): PassportRecord {
  const record = getPassport(id)
  if (!record) throw new Error("passport_not_found")
  const clonedRecord: PassportRecord = {
    id: `${record.id}-clone`,
    agentId: newAgentId,
    status: "active",
    config: { ...record.config },
    createdAt: new Date().toISOString(),
  }
  setPassport(clonedRecord)
  appendAuditEntry({
    passportId: record.id,
    action: "cloned",
    actor,
    target: clonedRecord.id,
    reason,
  })
  return clonedRecord
}

export interface BatchVerificationResult {
  passportId: string
  status: PassportStatus | null
  agentId: string | null
  valid: boolean
  error?: string
}

export interface BatchVerificationResponse {
  results: BatchVerificationResult[]
  total: number
  validCount: number
  invalidCount: number
}

export function verifyPassportBatch(passportIds: string[]): BatchVerificationResponse {
  const results: BatchVerificationResult[] = passportIds.map((id) => {
    const passport = getPassport(id)
    if (!passport) {
      return {
        passportId: id,
        status: null,
        agentId: null,
        valid: false,
        error: "not_found",
      }
    }
    const valid = passport.status === "active"
    return {
      passportId: id,
      status: passport.status,
      agentId: passport.agentId,
      valid,
    }
  })

  const total = results.length
  const validCount = results.filter((r) => r.valid).length
  const invalidCount = total - validCount

  // NEW: Per-agent audit for batch verification
  results.forEach((r) => {
    if (r.agentId) {
      appendAuditEvent({
        agentId: r.agentId,
        type: "batch_verified",
        ok: r.valid,
      })
    }
  })

  return {
    results,
    total,
    validCount,
    invalidCount,
  }
}