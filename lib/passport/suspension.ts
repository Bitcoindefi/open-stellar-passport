import { appendAuditEntry } from "./audit"
import { appendAdminAuditEntry } from "./audit-log"
import { getPassport, setPassport, type PassportRecord } from "./passport"

export interface SuspensionRecord {
  passportId: string
  reason: string
  suspendedAt: string
  suspendedBy?: string
}

export interface UnsuspensionRecord {
  passportId: string
  reason: string
  unsuspendedAt: string
  unsuspendedBy?: string
}

export interface SuspensionWebhookPayload {
  type: "passport.suspended"
  passportId: string
  reason: string
  suspendedAt: string
}

export interface UnsuspensionWebhookPayload {
  type: "passport.unsuspended"
  passportId: string
  reason: string
  unsuspendedAt: string
}

type SuspensionDb = Map<string, SuspensionRecord>

const globalState = globalThis as typeof globalThis & {
  __openStellarPassportSuspensionDb__?: SuspensionDb
}

function getDb(): SuspensionDb {
  if (!globalState.__openStellarPassportSuspensionDb__) {
    globalState.__openStellarPassportSuspensionDb__ = new Map()
  }
  return globalState.__openStellarPassportSuspensionDb__
}

export function resetSuspensionStore(): void {
  getDb().clear()
}

export function suspendPassport(
  passportId: string,
  reason: string,
  actor: string = "admin"
): SuspensionRecord {
  if (!reason || !reason.trim()) {
    throw new Error("Missing required field: 'reason'")
  }

  const record = getPassport(passportId)
  if (!record) {
    throw new Error("passport_not_found")
  }

  if (record.status === "revoked") {
    throw new Error("cannot_suspend_revoked")
  }

  const suspendedAt = new Date().toISOString()
  const suspensionRecord: SuspensionRecord = {
    passportId: record.id,
    reason: reason.trim(),
    suspendedAt,
    suspendedBy: actor,
  }

  record.status = "suspended"
  setPassport(record)
  getDb().set(record.id, suspensionRecord)

  appendAuditEntry({
    passportId: record.id,
    action: "suspended",
    actor,
    reason: reason.trim(),
  })

  appendAdminAuditEntry({
    action: "suspend",
    actor,
    target: record.id,
    metadata: { reason: reason.trim() },
  })

  return suspensionRecord
}

export function unsuspendPassport(
  passportId: string,
  reason: string,
  actor: string = "admin"
): UnsuspensionRecord {
  if (!reason || !reason.trim()) {
    throw new Error("Missing required field: 'reason'")
  }

  const record = getPassport(passportId)
  if (!record) {
    throw new Error("passport_not_found")
  }

  if (record.status === "revoked") {
    throw new Error("cannot_unsuspend_revoked")
  }

  if (record.status === "expired") {
    throw new Error("cannot_unsuspend_expired")
  }

  const unsuspendedAt = new Date().toISOString()
  const unsuspensionRecord: UnsuspensionRecord = {
    passportId: record.id,
    reason: reason.trim(),
    unsuspendedAt,
    unsuspendedBy: actor,
  }

  record.status = "active"
  setPassport(record)
  getDb().delete(record.id)

  appendAuditEntry({
    passportId: record.id,
    action: "reactivated",
    actor,
    reason: reason.trim(),
  })

  appendAdminAuditEntry({
    action: "unsuspend",
    actor,
    target: record.id,
    metadata: { reason: reason.trim() },
  })

  return unsuspensionRecord
}

export function validatePassportForAction(
  passportId: string
): { ok: true; record: PassportRecord } | { ok: false; error: string; status: number } {
  const record = getPassport(passportId)
  if (!record) {
    return { ok: false, error: "passport_not_found", status: 404 }
  }

  if (record.status === "suspended") {
    return { ok: false, error: "passport_suspended", status: 403 }
  }

  if (record.status === "revoked") {
    return { ok: false, error: "passport_revoked", status: 403 }
  }

  if (record.status === "expired") {
    return { ok: false, error: "passport_expired", status: 403 }
  }

  return { ok: true, record }
}

export function buildSuspensionWebhookPayload(record: SuspensionRecord): SuspensionWebhookPayload {
  return {
    type: "passport.suspended",
    passportId: record.passportId,
    reason: record.reason,
    suspendedAt: record.suspendedAt,
  }
}

export function buildUnsuspensionWebhookPayload(
  record: UnsuspensionRecord
): UnsuspensionWebhookPayload {
  return {
    type: "passport.unsuspended",
    passportId: record.passportId,
    reason: record.reason,
    unsuspendedAt: record.unsuspendedAt,
  }
}
