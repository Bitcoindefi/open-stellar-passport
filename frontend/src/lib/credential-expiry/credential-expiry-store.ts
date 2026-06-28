export interface CredentialEntry {
  id: string;
  passportId: string;
  expiresAt: number; // Unix timestamp ms
}

export interface WarnEntry {
  credentialId: string;
  warnedAt: number; // Unix timestamp ms
}

// In-memory store for credentials (keyed by credentialId)
const credentialStore = new Map<string, CredentialEntry>();

// Tracks the last time a warning was emitted for a credential
const warnStore = new Map<string, WarnEntry>();

// ── Credentials ──────────────────────────────────────────────────────────────

export function addCredential(entry: CredentialEntry): CredentialEntry {
  credentialStore.set(entry.id, { ...entry });
  return entry;
}

/**
 * Returns credentials whose expiresAt is strictly between `after` and `before`.
 * Excludes already-expired credentials (expiresAt <= after).
 */
export function findExpiringSoon(after: number, before: number): CredentialEntry[] {
  return [...credentialStore.values()].filter(
    (c) => c.expiresAt > after && c.expiresAt <= before,
  );
}

// ── Warn tracking ─────────────────────────────────────────────────────────────

export function getLastWarned(credentialId: string): WarnEntry | undefined {
  return warnStore.get(credentialId);
}

export function setLastWarned(credentialId: string, warnedAt: number): void {
  warnStore.set(credentialId, { credentialId, warnedAt });
}

/** For testing only. */
export function _reset(): void {
  credentialStore.clear();
  warnStore.clear();
}
