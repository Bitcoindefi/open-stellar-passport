export interface XPMultiplier {
  multiplier: number
  validUntil: number
  reason: string
}

let activeMultiplier: XPMultiplier | null = null

export function setXPMultiplier(m: XPMultiplier): void {
  activeMultiplier = m
}

export function clearXPMultiplier(): void {
  activeMultiplier = null
}

export function getActiveMultiplier(): number {
  if (!activeMultiplier || Date.now() > activeMultiplier.validUntil) return 1
  return activeMultiplier.multiplier
}

export function getActiveMultiplierInfo(): XPMultiplier | null {
  if (!activeMultiplier || Date.now() > activeMultiplier.validUntil) return null
  return activeMultiplier
}

export function resetMultiplierStore(): void {
  activeMultiplier = null
}
