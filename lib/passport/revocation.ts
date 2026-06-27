import { appendAuditEntry } from "./audit"
import { getPassport, setPassport } from "./passport"

export type RevocationReason =

  | "policy_violation"
  | "security_compromise"
  | "duplicate_passport"
  | "agent_offboarded"
  | "admin_override"
  | "other"

export const VALID_REVOCATION_REASONS: RevocationReason[] = [
  "policy_violation",
  "security_compromise",
  "duplicate_passport",
  "agent_offboarded",
  "admin_override",
  "other",
]

export interface RevocationInput {
  reason: RevocationReason
  notes?: string
}

export interface RevocationRecord {
  passportId: string
  reason: RevocationReason
  notes: string | null
  revokedAt: string
  revokedBy?: string
}

export interface RevocationAuditEntry {
  action: "revoke"
  passportId: string
  reason: RevocationReason
  notes: string | null
  revokedAt: string
}

export interface RevocationWebhookPayload {
  type: "passport.revoked"
  passportId: string
  reason: RevocationReason
  notes: string | null
  revokedAt: string
}

type RevocationDb = Map<string, RevocationRecord>
type AuditLog = RevocationAuditEntry[]

const globalState = globalThis as typeof globalThis & {
  __openStellarPassportRevocationDb__?: RevocationDb
  __openStellarPassportRevocationAuditLog__?: AuditLog
}

function getDb(): RevocationDb {
  if (!globalState.__openStellarPassportRevocationDb__) {
    globalState.__openStellarPassportRevocationDb__ = new Map()
  }
  return globalState.__openStellarPassportRevocationDb__
}

function getAuditLog(): AuditLog {
  if (!globalState.__openStellarPassportRevocationAuditLog__) {
    globalState.__openStellarPassportRevocationAuditLog__ = []
  }
  return globalState.__openStellarPassportRevocationAuditLog__
}

function normalizePassportId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) throw new Error("passportId must not be empty")
  return trimmed.slice(0, 200)
}

function normalizeNotes(notes: unknown): string | null {
  if (notes === undefined || notes === null) return null
  const str = String(notes).trim()
  if (!str) return null
  return str.slice(0, 500)
}

export function isValidRevocationReason(value: unknown): value is RevocationReason {
  return typeof value === "string" && VALID_REVOCATION_REASONS.includes(value as RevocationReason)
}

export function validateRevocationInput(body: unknown): { valid: true; input: RevocationInput } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: `Request body must be an object with { reason, notes? }. Valid reasons: ${VALID_REVOCATION_REASONS.join(", ")}` }
  }

  const obj = body as Record<string, unknown>

  if (!("reason" in obj)) {
    return { valid: false, error: `Missing required field: 'reason'. Valid reasons: ${VALID_REVOCATION_REASONS.join(", ")}` }
  }

  if (!isValidRevocationReason(obj.reason)) {
    return { valid: false, error: `Invalid reason: '${obj.reason}'. Valid reasons: ${VALID_REVOCATION_REASONS.join(", ")}` }
  }

  const notes = normalizeNotes(obj.notes)

  return {
    valid: true,
    input: {
      reason: obj.reason as RevocationReason,
      notes: notes ?? undefined,
    },
  }
}

export function revokePassport(
  passportId: string,
  input: RevocationInput,
  revokedBy?: string,
): RevocationRecord {
  const cleanId = normalizePassportId(passportId)
  const db = getDb()
  const auditLog = getAuditLog()
  const now = new Date().toISOString()

  const record: RevocationRecord = {
    passportId: cleanId,
    reason: input.reason,
    notes: normalizeNotes(input.notes) ?? null,
    revokedAt: now,
    revokedBy,
  }

  db.set(cleanId, record)

  // Update PassportRecord status if it exists
  const passport = getPassport(cleanId)
  if (passport) {
    passport.status = "revoked"
    setPassport(passport)
  }

  const auditEntry: RevocationAuditEntry = {
    action: "revoke",
    passportId: cleanId,
    reason: input.reason,
    notes: record.notes,
    revokedAt: now,
  }
  auditLog.push(auditEntry)

  appendAuditEntry({
    passportId: cleanId,
    action: "revoked",
    actor: revokedBy || "admin",
    reason: input.reason,
    metadata: record.notes ? { notes: record.notes } : undefined,
  })

  // Keep audit log bounded
  if (auditLog.length > 10_000) {
    auditLog.splice(0, auditLog.length - 10_000)
  }

  return record
}

export function getRevocation(passportId: string): RevocationRecord | null {
  const cleanId = normalizePassportId(passportId)
  return getDb().get(cleanId) ?? null
}

export function isPassportRevoked(passportId: string): boolean {
  return getRevocation(passportId) !== null
}

export function listRevocations(): RevocationRecord[] {
  return Array.from(getDb().values()).sort((a, b) => b.revokedAt.localeCompare(a.revokedAt))
}

export function listRevocationAuditLog(limit = 100): RevocationAuditEntry[] {
  return getAuditLog().slice(-limit).reverse()
}

export function buildRevocationWebhookPayload(record: RevocationRecord): RevocationWebhookPayload {
  return {
    type: "passport.revoked",
    passportId: record.passportId,
    reason: record.reason,
    notes: record.notes,
    revokedAt: record.revokedAt,
  }
}

export function resetRevocationStore(): void {
  getDb().clear()
  getAuditLog().splice(0, getAuditLog().length)
}