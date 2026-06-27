/**
 * Revocation registry for agent passports.
 *
 * Keys are agentId strings normalized to lower-case trimmed form so that
 * revocations are case-insensitive and whitespace-tolerant.
 *
 * The registry is module-level (singleton) so it is shared across all
 * API route handlers in the same process.  Tests must call `_reset()`
 * in `beforeEach` / `afterEach` to prevent cross-test pollution.
 */

import { DEFAULT_SERVICE_CONTEXT } from "../passport-store";

const revokedPassports = new Set<string>();

function normalizeAgentId(agentId: string): string {
  return agentId.trim().toLowerCase();
}

function normalizeContext(serviceContext: string): string {
  return serviceContext.trim();
}

function revocationKey(
  agentId: string,
  serviceContext = DEFAULT_SERVICE_CONTEXT,
): string {
  return `${normalizeAgentId(agentId)}::${normalizeContext(serviceContext)}`;
}

/**
 * Marks a passport as revoked.  Safe to call more than once (idempotent).
 */
export function revokePassport(
  agentId: string,
  serviceContext = DEFAULT_SERVICE_CONTEXT,
): void {
  revokedPassports.add(revocationKey(agentId, serviceContext));
}

/**
 * Returns `true` if the passport has been explicitly revoked.
 * The check is case-insensitive and trims surrounding whitespace.
 */
export function isRevoked(
  agentId: string,
  serviceContext = DEFAULT_SERVICE_CONTEXT,
): boolean {
  return revokedPassports.has(revocationKey(agentId, serviceContext));
}

/** Clears the registry.  Intended for test isolation only. */
export function _reset(): void {
  revokedPassports.clear();
}
