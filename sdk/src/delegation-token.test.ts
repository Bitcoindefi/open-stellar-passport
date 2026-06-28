import { describe, expect, it, beforeEach } from "vitest";
import {
  createDelegationToken,
  authorizeDelegatedPayment,
  revokeDelegatorTokens,
  resetDelegationState,
} from "./delegation-token";

const SECRET = "test-secret-123";

beforeEach(() => {
  resetDelegationState();
});

describe("delegation tokens", () => {
  it("creates a signed delegation token", () => {
    const token = createDelegationToken(
      {
        delegatorAgentId: "parent-1",
        delegateeAgentId: "child-a",
        maxAmountXlm: 500,
        expiresAt: "2099-12-31T23:59:59Z",
      },
      SECRET,
    );

    expect(token.tokenId).toBeDefined();
    expect(token.delegatorAgentId).toBe("parent-1");
    expect(token.delegateeAgentId).toBe("child-a");
    expect(token.maxAmountXlm).toBe(500);
    expect(token.signature).toBeDefined();
    expect(token.signature.length).toBe(64);
  });

  it("child authorizes payment within maxAmountXlm", () => {
    const token = createDelegationToken(
      {
        delegatorAgentId: "parent-1",
        delegateeAgentId: "child-a",
        maxAmountXlm: 500,
        expiresAt: "2099-12-31T23:59:59Z",
      },
      SECRET,
    );

    const result = authorizeDelegatedPayment(token, 300, SECRET);
    expect(result.authorized).toBe(true);
  });

  it("rejects payment exceeding maxAmountXlm", () => {
    const token = createDelegationToken(
      {
        delegatorAgentId: "parent-1",
        delegateeAgentId: "child-a",
        maxAmountXlm: 500,
        expiresAt: "2099-12-31T23:59:59Z",
      },
      SECRET,
    );

    const result = authorizeDelegatedPayment(token, 501, SECRET);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("exceeds_delegation_max");
  });

  it("rejects expired delegation token", () => {
    const token = createDelegationToken(
      {
        delegatorAgentId: "parent-1",
        delegateeAgentId: "child-a",
        maxAmountXlm: 500,
        expiresAt: "2020-01-01T00:00:00Z",
      },
      SECRET,
    );

    const result = authorizeDelegatedPayment(token, 100, SECRET);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("delegation_expired");
  });

  it("rejects authorization after parent passport revoked", () => {
    const token = createDelegationToken(
      {
        delegatorAgentId: "parent-1",
        delegateeAgentId: "child-a",
        maxAmountXlm: 500,
        expiresAt: "2099-12-31T23:59:59Z",
      },
      SECRET,
    );

    revokeDelegatorTokens("parent-1");

    const result = authorizeDelegatedPayment(token, 100, SECRET);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("delegation_revoked");
  });

  it("rejects tampered signature", () => {
    const token = createDelegationToken(
      {
        delegatorAgentId: "parent-1",
        delegateeAgentId: "child-a",
        maxAmountXlm: 500,
        expiresAt: "2099-12-31T23:59:59Z",
      },
      SECRET,
    );

    token.signature = "f".repeat(64);

    const result = authorizeDelegatedPayment(token, 100, SECRET);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("invalid_signature");
  });
});
