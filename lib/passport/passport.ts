import { appendAuditEntry } from "./audit"

export type PassportStatus = "active" | "revoked" | "expired" | "suspended"

export interface PassportConfig {
  allowTransfer: boolean
}

export interface CredentialEntry {
  id: string
  passportId: string
  expiresAt: string | null
  createdAt?: string
}

export interface PassportRecord {
  id: string
  agentId: string
  status: PassportStatus
  config: PassportConfig
  createdAt: string
  expiresAt?: string | null
  metadata?: Record<string, unknown> | null
  credentials?: CredentialEntry[] | null
}

type PassportDb = Map<string, PassportRecord>
type AgentIndex = Map<string, string>
type CredentialDb = Map<string, CredentialEntry>

const globalState = globalThis as typeof globalThis & {
  __openStellarPassportDb__?: PassportDb
  __openStellarPassportAgentIndex__?: AgentIndex
  __openStellarPassportCredentialDb__?: CredentialDb
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

function normalizeCredentialId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) throw new Error("credentialId must not be empty")
  return trimmed.slice(0, 200)
}

function getCredentialDb(): CredentialDb {
  if (!globalState.__openStellarPassportCredentialDb__) {
    globalState.__openStellarPassportCredentialDb__ = new Map()
  }
  return globalState.__openStellarPassportCredentialDb__
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
  resetCredentialStore()
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
  metadata?: Record<string, unknown> | null,
  credentials?: CredentialEntry[] | null,
): PassportRecord {
  const record: PassportRecord = {
    id: normalizeId(id),
    agentId,
    status: "active",
    config,
    createdAt: new Date().toISOString(),
    expiresAt,
    metadata: metadata ?? null,
    credentials: credentials ?? null,
  }
  setPassport(record)
  if (credentials) {
    for (const cred of credentials) {
      setCredential(cred)
    }
  }
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

export function setCredential(entry: CredentialEntry): void {
  const db = getCredentialDb()
  db.set(normalizeCredentialId(entry.id), { ...entry })
}

export function getCredential(id: string): CredentialEntry | null {
  const db = getCredentialDb()
  return db.get(normalizeCredentialId(id)) ?? null
}

export function getCredentialsByPassportId(passportId: string): CredentialEntry[] {
  const db = getCredentialDb()
  return [...db.values()].filter(c => c.passportId === passportId)
}

export function resetCredentialStore(): void {
  getCredentialDb().clear()
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
    metadata: record.metadata,
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

/**
 * Deep clone a passport: creates a new passport record with a new id,
 * same agentId and config, and recalculates expiresAt from now using
 * the original TTL (if present). Copies metadata and re-issues credentials
 * with recalculated expiry. Records an audit "cloned" entry on
 * the source passport.
 */
export function clonePassportWithTtlFromNow(id: string, actor: string, reason?: string): PassportRecord {
  const record = getPassport(id)
  if (!record) throw new Error("passport_not_found")

  // Compute TTL from original if expiresAt is set
  let newExpiresAt: string | null | undefined = undefined
  if (record.expiresAt) {
    try {
      const created = Date.parse(record.createdAt)
      const originalExpires = Date.parse(record.expiresAt)
      const ttlMs = originalExpires - created
      if (Number.isFinite(ttlMs) && ttlMs > 0) {
        newExpiresAt = new Date(Date.now() + ttlMs).toISOString()
      } else {
        newExpiresAt = null
      }
    } catch {
      newExpiresAt = null
    }
  }

  // Re-issue credentials with recalculated expiry
  const now = Date.now()
  let newCredentials: CredentialEntry[] | null = null
  if (record.credentials && record.credentials.length > 0) {
    newCredentials = record.credentials.map(cred => {
      // Calculate TTL based on credential's original expiry relative to passport's createdAt
      let credExpiresAt: string | null = null
      if (cred.expiresAt) {
        const created = Date.parse(record.createdAt)
        const credExpires = Date.parse(cred.expiresAt)
        const ttlMs = credExpires - created
        if (Number.isFinite(ttlMs) && ttlMs > 0) {
          credExpiresAt = new Date(now + ttlMs).toISOString()
        }
      }
      return {
        id: `${cred.id}-clone-${Date.now().toString(36)}`,
        passportId: "",
        expiresAt: credExpiresAt,
      }
    })
  }

  const newId = `${record.id}-clone-${Date.now().toString(36)}`
  const cloned = issuePassport(
    newId,
    record.agentId,
    actor,
    { ...record.config },
    newExpiresAt ?? undefined,
    record.metadata,
    newCredentials,
  )

  // Update credential passportIds after passport is issued
  if (newCredentials) {
    for (const cred of newCredentials) {
      cred.passportId = cloned.id
      setCredential(cred)
    }
    cloned.credentials = newCredentials
  }

  appendAuditEntry({
    passportId: record.id,
    action: "cloned",
    actor,
    target: cloned.id,
    reason,
  })

  return cloned
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
