import { delegationStore } from "./delegation-store.js";

export interface DelegationToken {
  tokenId: string;
  expiresAt: number;
  maxClaims: number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateDelegationToken(token: DelegationToken): ValidationResult {
  if (token.expiresAt < Date.now()) {
    return { valid: false, reason: "token_expired" };
  }

  const claims = delegationStore.getClaims(token.tokenId);
  if (claims >= token.maxClaims) {
    return { valid: false, reason: "claim_limit_reached" };
  }

  if (delegationStore.isRevoked(token.tokenId)) {
    return { valid: false, reason: "revoked" };
  }

  return { valid: true };
}
