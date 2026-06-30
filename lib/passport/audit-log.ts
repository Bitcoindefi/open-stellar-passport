// lib/passport/audit-log.ts
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type PassportAuditEventType =
  | "issued"
  | "authorized"
  | "revoked"
  | "expired"
  | "batch_verified"

export interface PassportAuditEvent {
  id: string
  agentId: string
  type: PassportAuditEventType
  at: string // ISO-8601
  amount?: number
  quoteId?: string
  reason?: string
  ok?: boolean
}

const DATA_DIR = join(process.cwd(), ".data")
const AUDIT_FILE = join(DATA_DIR, "passport-audit.jsonl")
const MAX_EVENTS = 1000

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readAllEvents(): PassportAuditEvent[] {
  if (!existsSync(AUDIT_FILE)) return []
  const raw = readFileSync(AUDIT_FILE, "utf-8")
  const lines = raw.split("\n").filter((l) => l.trim().length > 0)
  return lines.map((line) => JSON.parse(line) as PassportAuditEvent)
}

/**
 * Append an event to the JSONL audit log.
 * Maintains a cap of MAX_EVENTS by trimming oldest when exceeded.
 */
export function appendAuditEvent(
  event: Omit<PassportAuditEvent, "id" | "at"> & { id?: string; at?: string }
): PassportAuditEvent {
  const fullEvent: PassportAuditEvent = {
    id: event.id || randomUUID(),
    agentId: event.agentId,
    type: event.type,
    at: event.at || new Date().toISOString(),
    amount: event.amount,
    quoteId: event.quoteId,
    reason: event.reason,
    ok: event.ok,
  }

  ensureDataDir()
  appendFileSync(AUDIT_FILE, JSON.stringify(fullEvent) + "\n")

  // Enforce cap: if over limit, rewrite file with last N events
  const all = readAllEvents()
  if (all.length > MAX_EVENTS) {
    const trimmed = all.slice(all.length - MAX_EVENTS)
    const rewrite = trimmed.map((e) => JSON.stringify(e)).join("\n") + "\n"
    const { writeFileSync } = require("node:fs")
    writeFileSync(AUDIT_FILE, rewrite)
  }

  return fullEvent
}

export interface AuditQueryOptions {
  agentId: string
  limit?: number // default 50
}

/**
 * Return last N events for an agent, newest-first.
 */
export function listAuditEvents(opts: AuditQueryOptions): PassportAuditEvent[] {
  const all = readAllEvents()
  const filtered = all.filter((e) => e.agentId === opts.agentId)
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_EVENTS)
  return filtered.slice(-limit).reverse()
}

/** For test isolation. */
export function resetAuditFile(): void {
  const { writeFileSync } = require("node:fs")
  if (existsSync(AUDIT_FILE)) {
    writeFileSync(AUDIT_FILE, "")
  }
}