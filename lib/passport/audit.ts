import { randomUUID } from "node:crypto"

export type AuditAction =
  | "issued"
  | "revoked"
  | "suspended"
  | "reactivated"
  | "transferred"
  | "expired"
  | "extended"
  | "cloned"

export interface AuditEntry {
  id: string             // uuid
  passportId: string
  action: AuditAction
  actor: string          // Stellar address of who performed the action
  target?: string        // for 'transferred': new owner address
  reason?: string        // optional human-readable reason
  timestamp: string      // ISO 8601
  metadata?: Record<string, unknown>
}

type AuditLog = AuditEntry[]

const globalState = globalThis as typeof globalThis & {
  __openStellarPassportAuditLog__?: AuditLog
}

function getAuditLog(): AuditLog {
  if (!globalState.__openStellarPassportAuditLog__) {
    globalState.__openStellarPassportAuditLog__ = []
  }
  return globalState.__openStellarPassportAuditLog__
}

/**
 * Appends a new audit entry to the global trail.
 * Generates an ID (UUID) and timestamp if not provided.
 */
export function appendAuditEntry(entry: Omit<AuditEntry, "id" | "timestamp"> & { id?: string; timestamp?: string }): AuditEntry {
  const newEntry: AuditEntry = {
    id: entry.id || randomUUID(),
    passportId: entry.passportId,
    action: entry.action,
    actor: entry.actor,
    target: entry.target,
    reason: entry.reason,
    timestamp: entry.timestamp || new Date().toISOString(),
    metadata: entry.metadata,
  }

  const log = getAuditLog()
  log.push(newEntry)

  // Bound the audit log size to 10,000 entries
  if (log.length > 10_000) {
    log.splice(0, log.length - 10_000)
  }

  return newEntry
}

/**
 * Lists audit entries newest-first, optionally filtered by passportId.
 */
export function listAuditEntries(passportId?: string): AuditEntry[] {
  const log = getAuditLog()
  if (passportId) {
    return log.filter((e) => e.passportId === passportId).reverse()
  }
  return [...log].reverse()
}

/**
 * Lists audit entries newest-first where the given Stellar address is the actor.
 */
export function listAuditEntriesByActor(actor: string): AuditEntry[] {
  const log = getAuditLog()
  const cleanActor = actor.toLowerCase().trim()
  return log
    .filter((e) => e.actor.toLowerCase().trim() === cleanActor)
    .reverse()
}

/**
 * Clears the audit store. Primarily for test isolation.
 */
export function resetAuditStore(): void {
  getAuditLog().splice(0, getAuditLog().length)
}
