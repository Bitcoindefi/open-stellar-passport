import { describe, it, expect, beforeEach } from "vitest"
import {
  setXPMultiplier,
  clearXPMultiplier,
  getActiveMultiplier,
  getActiveMultiplierInfo,
  resetMultiplierStore,
} from "@/lib/gamification/xp-multiplier"

describe("XP multiplier", () => {
  beforeEach(() => {
    resetMultiplierStore()
  })

  // ─── getActiveMultiplier ──────────────────────────────────────
  it("returns 1 when no multiplier is set", () => {
    expect(getActiveMultiplier()).toBe(1)
  })

  it("returns 1 when multiplier has expired", () => {
    setXPMultiplier({
      multiplier: 3,
      validUntil: Date.now() - 1,
      reason: "expired event",
    })

    expect(getActiveMultiplier()).toBe(1)
  })

  it("returns the multiplier when active and valid", () => {
    setXPMultiplier({
      multiplier: 2,
      validUntil: Date.now() + 60_000,
      reason: "double XP weekend",
    })

    expect(getActiveMultiplier()).toBe(2)
  })

  // ─── clearXPMultiplier ────────────────────────────────────────
  it("clearing resets multiplier to 1", () => {
    setXPMultiplier({
      multiplier: 5,
      validUntil: Date.now() + 60_000,
      reason: "boost event",
    })

    clearXPMultiplier()

    expect(getActiveMultiplier()).toBe(1)
    expect(getActiveMultiplierInfo()).toBeNull()
  })

  // ─── getActiveMultiplierInfo ──────────────────────────────────
  it("returns null when no multiplier active", () => {
    expect(getActiveMultiplierInfo()).toBeNull()
  })

  it("returns full info when active", () => {
    const validUntil = Date.now() + 60_000
    setXPMultiplier({
      multiplier: 3,
      validUntil,
      reason: "community event",
    })

    const info = getActiveMultiplierInfo()
    expect(info).not.toBeNull()
    expect(info!.multiplier).toBe(3)
    expect(info!.validUntil).toBe(validUntil)
    expect(info!.reason).toBe("community event")
  })

  // ─── quest completion integration ─────────────────────────────
  it("set 3x → complete quest → XP === baseXP * 3", () => {
    setXPMultiplier({
      multiplier: 3,
      validUntil: Date.now() + 60_000,
      reason: "triple XP event",
    })

    const baseXP = 100
    const xpAwarded = baseXP * getActiveMultiplier()

    expect(xpAwarded).toBe(300)
  })

  it("set 2x → complete quest → XP === baseXP * 2", () => {
    setXPMultiplier({
      multiplier: 2,
      validUntil: Date.now() + 60_000,
      reason: "double XP weekend",
    })

    const baseXP = 50
    const xpAwarded = baseXP * getActiveMultiplier()

    expect(xpAwarded).toBe(100)
  })

  it("no multiplier → complete quest → XP === baseXP * 1", () => {
    const baseXP = 75
    const xpAwarded = baseXP * getActiveMultiplier()

    expect(xpAwarded).toBe(75)
  })

  it("expired multiplier → complete quest → XP === baseXP * 1", () => {
    setXPMultiplier({
      multiplier: 10,
      validUntil: Date.now() - 1,
      reason: "already ended",
    })

    const baseXP = 100
    const xpAwarded = baseXP * getActiveMultiplier()

    expect(xpAwarded).toBe(100)
  })
})
