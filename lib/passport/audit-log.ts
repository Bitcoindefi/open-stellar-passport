import { randomUUID } from "node:crypto"

export type AdminAuditAction =
  | "grant"
  | "revoke"
  | "batch_verify"
  | "admin_transfer"
  | "verifier_change"

export interface AdminAuditEntry {
  id: string                        // crypto.randomUUID()
  action: AdminAuditAction
  actor: string                     // admin wallet address
  target: string                    // passport ID or new admin address
  timestamp: number                 // Date.now()
  metadata?: Record<string, unknown>
}

type AdminAuditLog = AdminAuditEntry[]

const globalState = globalThis as typeof globalThis & {
  __openStellarPassportAdminAuditLog__?: AdminAuditLog
}

function getAdminAuditLog(): AdminAuditLog {
  if (!globalState.__openStellarPassportAdminAuditLog__) {
    globalState.__openStellarPassportAdminAuditLog__ = []
  }
  return globalState.__openStellarPassportAdminAuditLog__
}

/**
 * Appends a new admin audit entry. Auto-generates id and timestamp.
 */
export function appendAdminAuditEntry(
  entry: Omit<AdminAuditEntry, "id" | "timestamp"> & { id?: string; timestamp?: number }
): AdminAuditEntry {
  const newEntry: AdminAuditEntry = {
    id: entry.id || randomUUID(),
    action: entry.action,
    actor: entry.actor,
    target: entry.target,
    timestamp: entry.timestamp ?? Date.now(),
    metadata: entry.metadata,
  }

  const log = getAdminAuditLog()
  log.push(newEntry)

  // Bound at 10,000 entries
  if (log.length > 10_000) {
    log.splice(0, log.length - 10_000)
  }

  return newEntry
}

export interface AdminAuditQueryOptions {
  action?: AdminAuditAction
  actor?: string
  target?: string
  since?: string   // ISO 8601 timestamp
  limit?: number   // default 100, max 1000
}

/**
 * Returns admin audit entries newest-first, with optional filters.
 */
export function listAdminAuditEntries(opts?: AdminAuditQueryOptions): AdminAuditEntry[] {
  const log = getAdminAuditLog()
  let entries = [...log]

  if (opts?.action) {
    entries = entries.filter(e => e.action === opts.action)
  }

  if (opts?.actor) {
    const actor = opts.actor.toLowerCase().trim()
    entries = entries.filter(e => e.actor.toLowerCase().trim() === actor)
  }

  if (opts?.target) {
    const target = opts.target.toLowerCase().trim()
    entries = entries.filter(e => e.target.toLowerCase().trim() === target)
  }

  if (opts?.since) {
    const sinceMs = new Date(opts.since).getTime()
    if (!Number.isNaN(sinceMs)) {
      entries = entries.filter(e => e.timestamp >= sinceMs)
    }
  }

  // Newest first
  entries.reverse()

  // Apply limit (default 100, max 1000)
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 1000)
  return entries.slice(0, limit)
}

/**
 * Clears the admin audit store. For test isolation.
 */
export function resetAdminAuditStore(): void {
  const log = getAdminAuditLog()
  log.splice(0, log.length)
}
