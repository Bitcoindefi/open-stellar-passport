import { randomUUID, createHmac } from "node:crypto";

export interface DelegationToken {
  tokenId: string;
  delegatorAgentId: string;
  delegateeAgentId: string;
  maxAmountXlm: number;
  expiresAt: string | null;
  signature: string;
}

const revokedTokens = new Set<string>();
const revokedDelegators = new Set<string>();

function payload(
  delegator: string,
  delegatee: string,
  maxAmount: number,
  expiresAt: string | null,
): string {
  return `${delegator}+${delegatee}+${maxAmount}+${expiresAt ?? ""}`;
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("hex");
}

export function createDelegationToken(
  token: {
    delegatorAgentId: string;
    delegateeAgentId: string;
    maxAmountXlm: number;
    expiresAt: string | null;
  },
  secret: string,
): DelegationToken {
  const p = payload(
    token.delegatorAgentId,
    token.delegateeAgentId,
    token.maxAmountXlm,
    token.expiresAt,
  );
  return {
    tokenId: randomUUID(),
    ...token,
    signature: sign(p, secret),
  };
}

export function verifyDelegationToken(
  token: DelegationToken,
  secret: string,
): { ok: boolean; reason?: string } {
  if (revokedTokens.has(token.tokenId)) {
    return { ok: false, reason: "delegation_revoked" };
  }
  if (revokedDelegators.has(token.delegatorAgentId)) {
    return { ok: false, reason: "delegation_revoked" };
  }
  if (token.expiresAt && Date.now() > new Date(token.expiresAt).getTime()) {
    return { ok: false, reason: "delegation_expired" };
  }
  const expected = sign(
    payload(
      token.delegatorAgentId,
      token.delegateeAgentId,
      token.maxAmountXlm,
      token.expiresAt,
    ),
    secret,
  );
  if (token.signature !== expected) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true };
}

export function authorizeDelegatedPayment(
  token: DelegationToken,
  amount: number,
  secret: string,
): { authorized: boolean; reason?: string } {
  const v = verifyDelegationToken(token, secret);
  if (!v.ok) return { authorized: false, reason: v.reason };
  if (amount > token.maxAmountXlm) {
    return { authorized: false, reason: "exceeds_delegation_max" };
  }
  return { authorized: true };
}

export function revokeDelegationToken(tokenId: string): void {
  revokedTokens.add(tokenId);
}

export function revokeDelegatorTokens(delegatorAgentId: string): void {
  revokedDelegators.add(delegatorAgentId);
}

export function resetDelegationState(): void {
  revokedTokens.clear();
  revokedDelegators.clear();
}
