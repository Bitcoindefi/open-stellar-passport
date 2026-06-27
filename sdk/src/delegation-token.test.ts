import { describe, it, expect, beforeEach } from 'vitest';
import { validateDelegationToken, DelegationToken } from './delegation-token.js';
import { delegationStore } from './delegation-store.js';

describe('Delegation Token Validation', () => {
  beforeEach(() => {
    // Reset the store before each test. Since it's a singleton without a clear method,
    // we just use a token id specific to each test to isolate them.
  });

  it('validates a valid token', () => {
    const token: DelegationToken = {
      tokenId: 'test-valid-token',
      expiresAt: Date.now() + 10000,
      maxClaims: 2,
    };

    const result = validateDelegationToken(token);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('rejects an expired token', () => {
    const token: DelegationToken = {
      tokenId: 'test-expired-token',
      expiresAt: Date.now() - 10000,
      maxClaims: 2,
    };

    const result = validateDelegationToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('token_expired');
  });

  it('rejects a token that has reached its claim limit', () => {
    const tokenId = 'test-limit-token';
    const token: DelegationToken = {
      tokenId,
      expiresAt: Date.now() + 10000,
      maxClaims: 2,
    };

    delegationStore.recordClaim(tokenId);
    delegationStore.recordClaim(tokenId);

    const result = validateDelegationToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('claim_limit_reached');
  });

  it('rejects a revoked token', () => {
    const tokenId = 'test-revoked-token';
    const token: DelegationToken = {
      tokenId,
      expiresAt: Date.now() + 10000,
      maxClaims: 2,
    };

    delegationStore.revokeToken(tokenId);

    const result = validateDelegationToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('revoked');
  });
});
