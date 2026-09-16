import { appendAuditEntry } from "./audit"

export type PassportStatus = "active" | "revoked" | "expired" | "suspended"


export interface PassportConfig {
  allowTransfer: boolean
}

export interface CredentialRecord {
  id?: string
  type?: string
  issuer?: string
  issuedAt?: string
  expiresAt?: string
  ttlMs?: number
  [key: string]: unknown
}

export interface PassportRecord {
  id: string
  agentId: string
  status: PassportStatus
  config: PassportConfig
  createdAt: string
  issuedAt?: string
  expiresAt?: string | null
  metadata?: Record<string, unknown>
  credentials?: CredentialRecord[]
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
  metadata?: Record<string, unknown>,
  credentials?: CredentialRecord[],
): PassportRecord {
  const now = new Date().toISOString()
  const record: PassportRecord = {
    id: normalizeId(id),
    agentId,
    status: "active",
    config,
    createdAt: now,
    issuedAt: now,
    expiresAt,
    metadata: metadata ? structuredClone(metadata) : {},
    credentials: credentials ? structuredClone(credentials) : [],
  }
  setPassport(record)
  appendAuditEntry({
    passportId: record.id,
    action: "issued",
    actor,
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

export interface ClonePassportOptions {
  newId?: string
  newAgentId?: string
  actor?: string
  reason?: string
}

export function clonePassport(
  id: string,
  newAgentId?: string,
  actor = "admin",
  reason?: string,
  options?: ClonePassportOptions,
): PassportRecord {
  const record = getPassport(id)
  if (!record) throw new Error("passport_not_found")

  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()

  let targetId = options?.newId
  if (!targetId || !targetId.trim()) {
    const baseCloneId = `${record.id}-clone`
    if (!getPassport(baseCloneId)) {
      targetId = baseCloneId
    } else {
      targetId = `${record.id}-clone-${nowMs}`
    }
  }

  const agentId = newAgentId?.trim() || options?.newAgentId?.trim() || record.agentId

  // Recalculate passport expiresAt if present
  let expiresAt: string | null | undefined = record.expiresAt
  if (record.expiresAt) {
    const sourceStart = record.issuedAt || record.createdAt
    const sourceStartMs = sourceStart ? Date.parse(sourceStart) : Number.NaN
    const sourceExpiryMs = Date.parse(record.expiresAt)
    const ttlMs =
      Number.isFinite(sourceStartMs) && Number.isFinite(sourceExpiryMs) && sourceExpiryMs > sourceStartMs
        ? sourceExpiryMs - sourceStartMs
        : 30 * 24 * 60 * 60 * 1000
    expiresAt = new Date(nowMs + ttlMs).toISOString()
  }

  // Recalculate credentials with new expiry from now + original TTL
  const credentials: CredentialRecord[] = (record.credentials || []).map((cred) => {
    let ttlMs = 30 * 24 * 60 * 60 * 1000 // default 30 days
    if (typeof cred.ttlMs === "number" && cred.ttlMs > 0) {
      ttlMs = cred.ttlMs
    } else if (
      cred.expiresAt &&
      cred.issuedAt &&
      Number.isFinite(Date.parse(cred.expiresAt)) &&
      Number.isFinite(Date.parse(cred.issuedAt))
    ) {
      const diff = Date.parse(cred.expiresAt) - Date.parse(cred.issuedAt)
      if (diff > 0) ttlMs = diff
    } else if (
      cred.expiresAt &&
      record.createdAt &&
      Number.isFinite(Date.parse(cred.expiresAt)) &&
      Number.isFinite(Date.parse(record.createdAt))
    ) {
      const diff = Date.parse(cred.expiresAt) - Date.parse(record.createdAt)
      if (diff > 0) ttlMs = diff
    }

    return {
      ...structuredClone(cred),
      issuedAt: nowIso,
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
    }
  })

  const clonedRecord: PassportRecord = {
    id: normalizeId(targetId),
    agentId,
    status: "active",
    config: { ...record.config },
    createdAt: nowIso,
    issuedAt: nowIso,
    expiresAt,
    metadata: record.metadata ? structuredClone(record.metadata) : {},
    credentials,
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
  const results: BatchVerificationResult[] = passportIds.map(id => {
    const passport = getPassport(id)
    if (!passport) {
      return {
        passportId: id,
        status: null,
        agentId: null,
        valid: false,
        error: "not_found"
      }
    }
    const valid = passport.status === "active"
    return {
      passportId: id,
      status: passport.status,
      agentId: passport.agentId,
      valid
    }
  })

  const total = results.length
  const validCount = results.filter(r => r.valid).length
  const invalidCount = total - validCount

  return {
    results,
    total,
    validCount,
    invalidCount
  }
}
