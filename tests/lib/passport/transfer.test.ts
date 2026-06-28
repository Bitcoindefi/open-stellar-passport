import { describe, it, expect, beforeEach } from "vitest"
import {
  isValidStellarPublicKey,
  validateTransferInput,
  transferPassport,
  getTransferRecord,
  buildTransferWebhookPayload,
  listTransferAuditLog,
  resetTransferStore,
  type TransferRecord,
} from "@/lib/passport/transfer"
import {
  setPassport,
  getPassport,
  getPassportByAgentId,
  isPassportTransferable,
  resetPassportStore,
  type PassportRecord,
} from "@/lib/passport/passport"

const OLD_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const NEW_ADDR = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW"
const INVALID_ADDR = "not-a-stellar-key"
const THIRD_PARTY_ADDR = "GCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const PASSPORT_ID = "passport-transfer-1"

function createActivePassport(agentId: string, allowTransfer = true): PassportRecord {
  return {
    id: PASSPORT_ID,
    agentId,
    status: "active",
    config: { allowTransfer },
    createdAt: new Date().toISOString(),
  }
}

describe("passport transfer", () => {
  beforeEach(() => {
    resetTransferStore()
    resetPassportStore()
  })

  // ─── Stellar public key validation ────────────────────────────
  describe("isValidStellarPublicKey", () => {
    it("accepts valid G... key", () => {
      expect(isValidStellarPublicKey(OLD_ADDR)).toBe(true)
    })

    it("rejects non-string input", () => {
      expect(isValidStellarPublicKey(123)).toBe(false)
      expect(isValidStellarPublicKey(null)).toBe(false)
      expect(isValidStellarPublicKey(undefined)).toBe(false)
    })

    it("rejects short key", () => {
      expect(isValidStellarPublicKey("G12345")).toBe(false)
    })

    it("rejects key starting with wrong letter", () => {
      const fake = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
      expect(isValidStellarPublicKey(fake)).toBe(false)
    })
  })

  // ─── validateTransferInput ─────────────────────────────────────
  describe("validateTransferInput", () => {
    it("returns valid for correct input", () => {
      const result = validateTransferInput({ newOwnerAddress: NEW_ADDR, reason: "wallet_rotation" })
      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.input.newOwnerAddress).toBe(NEW_ADDR)
        expect(result.input.reason).toBe("wallet_rotation")
      }
    })

    it("allows reason to be optional", () => {
      const result = validateTransferInput({ newOwnerAddress: NEW_ADDR })
      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.input.reason).toBeUndefined()
      }
    })

    it("returns error when newOwnerAddress is missing", () => {
      const result = validateTransferInput({ reason: "wallet_rotation" })
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain("newOwnerAddress")
      }
    })

    it("returns error when newOwnerAddress is invalid", () => {
      const result = validateTransferInput({ newOwnerAddress: INVALID_ADDR })
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain("Stellar public key")
      }
    })

    it("returns error for non-object body", () => {
      const result = validateTransferInput("invalid")
      expect(result.valid).toBe(false)
    })

    it("truncates long reason", () => {
      const longReason = "a".repeat(500)
      const result = validateTransferInput({ newOwnerAddress: NEW_ADDR, reason: longReason })
      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.input.reason!.length).toBe(200)
      }
    })
  })

  // ─── transferPassport ──────────────────────────────────────────
  describe("transferPassport", () => {
    it("transfers passport to new address", () => {
      setPassport(createActivePassport(OLD_ADDR))

      const record = transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR, reason: "wallet_rotation" })

      expect(record.passportId).toBe(PASSPORT_ID)
      expect(record.fromAddress).toBe(OLD_ADDR)
      expect(record.toAddress).toBe(NEW_ADDR)
      expect(record.reason).toBe("wallet_rotation")
      expect(record.transferredAt).toBeDefined()

      const updated = getPassport(PASSPORT_ID)
      expect(updated?.agentId).toBe(NEW_ADDR)
    })

    it("old address can no longer act as passport holder", () => {
      setPassport(createActivePassport(OLD_ADDR))

      transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR })

      expect(getPassportByAgentId(OLD_ADDR)).toBeNull()
      expect(getPassportByAgentId(NEW_ADDR)?.agentId).toBe(NEW_ADDR)
    })

    it("throws transfer_to_self when addresses match", () => {
      setPassport(createActivePassport(OLD_ADDR))

      expect(() =>
        transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: OLD_ADDR }),
      ).toThrow("transfer_to_self")
    })

    it("throws when passport is revoked", () => {
      setPassport({
        id: PASSPORT_ID,
        agentId: OLD_ADDR,
        status: "revoked",
        config: { allowTransfer: true },
        createdAt: new Date().toISOString(),
      })

      expect(() =>
        transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR }),
      ).toThrow("passport_revoked")
    })

    it("throws when passport is expired", () => {
      setPassport({
        id: PASSPORT_ID,
        agentId: OLD_ADDR,
        status: "expired",
        config: { allowTransfer: true },
        createdAt: new Date().toISOString(),
      })

      expect(() =>
        transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR }),
      ).toThrow("passport_expired")
    })

    it("throws when passport is suspended", () => {
      setPassport({
        id: PASSPORT_ID,
        agentId: OLD_ADDR,
        status: "suspended",
        config: { allowTransfer: true },
        createdAt: new Date().toISOString(),
      })

      expect(() =>
        transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR }),
      ).toThrow("passport_suspended")
    })

    it("throws transfer_not_allowed when config flag is false", () => {
      setPassport(createActivePassport(OLD_ADDR, false))

      expect(() =>
        transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR }),
      ).toThrow("transfer_not_allowed")
    })

    it("throws not_passport_holder when caller does not own passport", () => {
      setPassport(createActivePassport(OLD_ADDR))
      expect(() =>
        transferPassport(PASSPORT_ID, THIRD_PARTY_ADDR, { newOwnerAddress: NEW_ADDR }),
      ).toThrow("not_passport_holder")
    })

    it("status remains active after transfer", () => {
      setPassport(createActivePassport(OLD_ADDR))

      transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR })

      const passport = getPassport(PASSPORT_ID)
      expect(passport?.status).toBe("active")
    })
  })

  // ─── audit log ─────────────────────────────────────────────────
  describe("audit log", () => {
    it("creates audit entry on transfer", () => {
      setPassport(createActivePassport(OLD_ADDR))

      transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR, reason: "wallet_rotation" })

      const auditLog = listTransferAuditLog()
      expect(auditLog).toHaveLength(1)
      expect(auditLog[0]).toMatchObject({
        action: "transfer",
        passportId: PASSPORT_ID,
        actor: OLD_ADDR,
        target: NEW_ADDR,
        reason: "wallet_rotation",
      })
      expect(auditLog[0].transferredAt).toBeDefined()
    })

    it("stores null reason in audit log when not provided", () => {
      setPassport(createActivePassport(OLD_ADDR))

      transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR })

      const auditLog = listTransferAuditLog()
      expect(auditLog[0].reason).toBeNull()
    })
  })

  // ─── webhook payload ───────────────────────────────────────────
  describe("buildTransferWebhookPayload", () => {
    it("builds correct webhook payload", () => {
      setPassport(createActivePassport(OLD_ADDR))
      const record = transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR, reason: "wallet_rotation" })

      const payload = buildTransferWebhookPayload(record)

      expect(payload).toEqual({
        type: "passport.transferred",
        passportId: PASSPORT_ID,
        fromAddress: OLD_ADDR,
        toAddress: NEW_ADDR,
        reason: "wallet_rotation",
        transferredAt: record.transferredAt,
      })
    })
  })

  // ─── getTransferRecord ─────────────────────────────────────────
  describe("getTransferRecord", () => {
    it("returns transfer record for transferred passport", () => {
      setPassport(createActivePassport(OLD_ADDR))
      transferPassport(PASSPORT_ID, OLD_ADDR, { newOwnerAddress: NEW_ADDR })

      const record = getTransferRecord(PASSPORT_ID)
      expect(record).not.toBeNull()
      expect(record?.fromAddress).toBe(OLD_ADDR)
      expect(record?.toAddress).toBe(NEW_ADDR)
    })

    it("returns null for non-transferred passport", () => {
      expect(getTransferRecord("nonexistent")).toBeNull()
    })
  })

  // ─── isPassportTransferable ────────────────────────────────────
  describe("isPassportTransferable", () => {
    it("returns ok for active passport with allowTransfer", () => {
      setPassport(createActivePassport(OLD_ADDR))
      const result = isPassportTransferable(PASSPORT_ID)
      expect(result.ok).toBe(true)
    })

    it("returns error for revoked passport", () => {
      setPassport({ ...createActivePassport(OLD_ADDR), status: "revoked" })
      const result = isPassportTransferable(PASSPORT_ID)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe("passport_revoked")
    })

    it("returns error when allowTransfer is false", () => {
      setPassport(createActivePassport(OLD_ADDR, false))
      const result = isPassportTransferable(PASSPORT_ID)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe("transfer_not_allowed")
    })
  })
})
