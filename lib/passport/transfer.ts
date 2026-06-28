import {
  getPassport,
  updatePassportAgentId,
  isPassportTransferable,
} from "./passport"
import { appendAuditEntry } from "./audit"


export const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/

export interface TransferInput {
  newOwnerAddress: string
  reason?: string
}

export interface TransferRecord {
  passportId: string
  fromAddress: string
  toAddress: string
  reason: string | null
  transferredAt: string
}

export interface TransferAuditEntry {
  action: "transfer"
  passportId: string
  actor: string
  target: string
  reason: string | null
  transferredAt: string
}

export interface TransferWebhookPayload {
  type: "passport.transferred"
  passportId: string
  fromAddress: string
  toAddress: string
  reason: string | null
  transferredAt: string
}

type TransferDb = Map<string, TransferRecord>
type TransferAuditLog = TransferAuditEntry[]

const globalState = globalThis as typeof globalThis & {
  __openStellarPassportTransferDb__?: TransferDb
  __openStellarPassportTransferAuditLog__?: TransferAuditLog
}

function getDb(): TransferDb {
  if (!globalState.__openStellarPassportTransferDb__) {
    globalState.__openStellarPassportTransferDb__ = new Map()
  }
  return globalState.__openStellarPassportTransferDb__
}

function getAuditLog(): TransferAuditLog {
  if (!globalState.__openStellarPassportTransferAuditLog__) {
    globalState.__openStellarPassportTransferAuditLog__ = []
  }
  return globalState.__openStellarPassportTransferAuditLog__
}

function normalizeId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) throw new Error("passportId must not be empty")
  return trimmed.slice(0, 200)
}

export function isValidStellarPublicKey(address: unknown): address is string {
  if (typeof address !== "string") return false
  return STELLAR_PUBLIC_KEY_REGEX.test(address)
}

export function validateTransferInput(body: unknown): { valid: true; input: TransferInput } | { valid: false; error: string; status?: number } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be an object with { newOwnerAddress }" }
  }

  const obj = body as Record<string, unknown>

  if (!("newOwnerAddress" in obj)) {
    return { valid: false, error: "Missing required field: 'newOwnerAddress'" }
  }

  if (!isValidStellarPublicKey(obj.newOwnerAddress)) {
    return { valid: false, error: "newOwnerAddress must be a valid Stellar public key (G... format, 56 characters)" }
  }

  const reason = typeof obj.reason === "string" ? obj.reason.trim().slice(0, 200) : null

  return {
    valid: true,
    input: {
      newOwnerAddress: obj.newOwnerAddress as string,
      reason: reason ?? undefined,
    },
  }
}

export function transferPassport(
  passportId: string,
  currentOwnerAddress: string,
  input: TransferInput,
): TransferRecord {
  const cleanId = normalizeId(passportId)
  const db = getDb()
  const auditLog = getAuditLog()
  const now = new Date().toISOString()

  const check = isPassportTransferable(cleanId)
  if (!check.ok) {
    throw new Error(check.error)
  }

  const passport = getPassport(cleanId)
  if (!passport) {
    throw new Error("passport_not_found")
  }

  if (passport.agentId !== currentOwnerAddress) {
    throw new Error("not_passport_holder")
  }

  if (passport.agentId === input.newOwnerAddress) {
    throw new Error("transfer_to_self")
  }

  const reason = input.reason ?? null

  updatePassportAgentId(cleanId, input.newOwnerAddress)

  const record: TransferRecord = {
    passportId: cleanId,
    fromAddress: currentOwnerAddress,
    toAddress: input.newOwnerAddress,
    reason,
    transferredAt: now,
  }

  db.set(cleanId, record)

  const auditEntry: TransferAuditEntry = {
    action: "transfer",
    passportId: cleanId,
    actor: currentOwnerAddress,
    target: input.newOwnerAddress,
    reason,
    transferredAt: now,
  }
  auditLog.push(auditEntry)

  appendAuditEntry({
    passportId: cleanId,
    action: "transferred",
    actor: currentOwnerAddress,
    target: input.newOwnerAddress,
    reason: reason ?? undefined,
  })

  if (auditLog.length > 10_000) {
    auditLog.splice(0, auditLog.length - 10_000)
  }

  return record
}

export function getTransferRecord(passportId: string): TransferRecord | null {
  const cleanId = normalizeId(passportId)
  return getDb().get(cleanId) ?? null
}

export function buildTransferWebhookPayload(record: TransferRecord): TransferWebhookPayload {
  return {
    type: "passport.transferred",
    passportId: record.passportId,
    fromAddress: record.fromAddress,
    toAddress: record.toAddress,
    reason: record.reason,
    transferredAt: record.transferredAt,
  }
}

export function listTransferAuditLog(limit = 100): TransferAuditEntry[] {
  return getAuditLog().slice(-limit).reverse()
}

export function resetTransferStore(): void {
  getDb().clear()
  getAuditLog().splice(0, getAuditLog().length)
}
